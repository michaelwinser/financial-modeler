import type {
  AccountNode,
  AssetClass,
  BracketTable,
  BracketTablesByStatus,
  FieldValue,
  FilingStatus,
  Household,
  IrmaaTier,
  IrmaaTiersByStatus,
  TimelineEvent,
  YearlyProjection,
  ActionTemplate,
} from './types';
import {
  computeIrmaaSurcharge,
  computeTax,
  marginalRate,
  resolveTaxTreatment,
  uniformLifetimeDivisor,
} from './tax';
import { actorById, ownerActor, primaryActor } from './household';

// =====================================================================
// Tree resolution helpers
// =====================================================================

type AccountMap = Map<string, AccountNode>;

const parentChain = (map: AccountMap, id: string): AccountNode[] => {
  const chain: AccountNode[] = [];
  let cur: AccountNode | undefined = map.get(id);
  while (cur) {
    chain.push(cur);
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
  }
  return chain;
};

// Resolve a field via inheritance. Walk the chain, find the first node
// where the field is set; apply override semantics if encountered.
function resolveField(
  map: AccountMap,
  id: string,
  field: keyof AccountNode,
): number | undefined {
  const chain = parentChain(map, id);
  // Walk root → leaf so we can apply child overrides on top of parent values.
  let value: number | undefined;
  for (let i = chain.length - 1; i >= 0; i--) {
    const v = chain[i][field] as FieldValue;
    if (v === undefined) continue;
    if (typeof v === 'number') value = v;
    else if (v.mode === 'absolute') value = v.value;
    else if (v.mode === 'delta') value = (value ?? 0) + v.value;
  }
  return value;
}

// Find the appropriate ambient yield for a holding by asset class —
// walks the parent chain looking for the typed yield field on an
// ancestor (typically US Economy).
function ambientYield(
  map: AccountMap,
  fromId: string,
  ac: AssetClass | undefined,
): number {
  if (!ac) return 0;
  const field: keyof AccountNode | undefined =
    ac === 'equity'
      ? 'equity_yield'
      : ac === 'bond'
        ? 'bond_yield'
        : ac === 'cash'
          ? 'cash_yield'
          : ac === 'real_estate'
            ? 'real_estate_yield'
            : undefined;
  if (!field) return 0;
  return resolveField(map, fromId, field) ?? 0;
}

// Effective yield for an asset = inherited typed yield + own override.
function effectiveYield(map: AccountMap, node: AccountNode): number {
  const ambient = ambientYield(map, node.id, node.asset_class);
  const own = node.yield_rate;
  if (own === undefined) return ambient;
  if (typeof own === 'number') return own;
  if (own.mode === 'absolute') return own.value;
  return ambient + own.value;
}

function jurisdictionTaxRate(
  map: AccountMap,
  jurisdictionId: string,
): number {
  return resolveField(map, jurisdictionId, 'effective_tax_rate') ?? 0;
}

// =====================================================================
// Bracket-aware tax context
// =====================================================================
//
// Phase 3.0: bracket walking when jurisdiction tables are present, with a
// single-bracket fallback synthesized from the legacy `effective_tax_rate`
// when they aren't. Pre-3.0 fixtures and tests using only effective_tax_rate
// continue to work; new scenarios (the seed) use real brackets.

interface ResolvedTaxTables {
  federalOrdinary: BracketTable;
  federalLtcg: BracketTable;
  stateOrdinary: BracketTable;
  stateLtcg: BracketTable;
  irmaa: IrmaaTier[];
  // True if we found at least one real bracket table (not the synthetic
  // fallback). Lets us decide whether IRMAA should fire (only meaningful
  // with bracket math).
  hasBrackets: boolean;
}

// Look up a per-filing-status field value walking the chain. Returns the
// inner BracketTable for the active filing status, or undefined.
function resolveBracketTable(
  map: AccountMap,
  fromId: string,
  field: keyof AccountNode,
  status: FilingStatus,
): BracketTable | undefined {
  // Walk up the chain leaf-to-root and return the first defined entry.
  const chain = parentChain(map, fromId);
  for (const node of chain) {
    const v = node[field] as BracketTablesByStatus | undefined;
    if (v && v[status]) return v[status];
  }
  return undefined;
}

function resolveIrmaaTiers(
  map: AccountMap,
  fromId: string,
  status: FilingStatus,
): IrmaaTier[] {
  const chain = parentChain(map, fromId);
  for (const node of chain) {
    const v = node.irmaa_tiers as IrmaaTiersByStatus | undefined;
    if (v && v[status]) return v[status]!;
  }
  return [];
}

function buildTaxTables(
  map: AccountMap,
  jurisdictionId: string,
  filingStatus: FilingStatus,
): ResolvedTaxTables {
  const fedOrd = resolveBracketTable(map, jurisdictionId, 'federal_brackets_ordinary', filingStatus);
  const fedLtcg = resolveBracketTable(map, jurisdictionId, 'federal_brackets_ltcg', filingStatus);
  const stOrd = resolveBracketTable(map, jurisdictionId, 'state_brackets_ordinary', filingStatus);
  const stLtcg = resolveBracketTable(map, jurisdictionId, 'state_brackets_ltcg', filingStatus);
  const irmaa = resolveIrmaaTiers(map, jurisdictionId, filingStatus);

  if (fedOrd) {
    // Real brackets. State tables default to empty (no-tax states like FL).
    return {
      federalOrdinary: fedOrd,
      federalLtcg: fedLtcg ?? [],
      stateOrdinary: stOrd ?? [],
      stateLtcg: stLtcg ?? [],
      irmaa,
      hasBrackets: true,
    };
  }
  // Fallback for fixtures using the legacy effective_tax_rate field. We
  // synthesize a single-bracket table at that flat rate so the year-end
  // bracket-walk produces the same numbers the legacy code did. LTCG falls
  // back to the 0.6× proxy.
  const flat = jurisdictionTaxRate(map, jurisdictionId);
  return {
    federalOrdinary: [{ from: 0, rate: flat }],
    federalLtcg: [{ from: 0, rate: flat * 0.6 }],
    stateOrdinary: [],
    stateLtcg: [],
    irmaa: [],
    hasBrackets: false,
  };
}

// =====================================================================
// Year accumulator — every taxable activity within a year goes here, and
// year-end computes the tax bill in one shot via bracket walks.
// =====================================================================

interface YearAccumulator {
  ordinary_income: number;       // salaries, SS (taxable portion ignored for V1), pensions, conversions, basis-portion of NUA, tax-deferred withdrawals
  ltcg_income: number;           // taxable gains (less exclusions), NUA gain portion
  tax_exempt_interest: number;   // muni bond interest — not taxed federally; reserved (V1: not yet computed)
  deductible_expenses: number;   // expense streams flagged tax_deductible
}

function emptyYearAccumulator(): YearAccumulator {
  return {
    ordinary_income: 0,
    ltcg_income: 0,
    tax_exempt_interest: 0,
    deductible_expenses: 0,
  };
}

interface YearTax {
  ordinary: number; // federal + state ordinary
  ltcg: number;     // federal + state LTCG
  irmaa: number;    // federal IRMAA premium surcharge
  total: number;    // sum
}

function computeYearEndTax(
  acc: YearAccumulator,
  tables: ResolvedTaxTables,
  age: number,
): YearTax {
  // Taxable ordinary income after deducting deductible expenses (V1: simple
  // dollar-for-dollar reduction; doesn't model itemize-vs-standard).
  const taxableOrdinary = Math.max(0, acc.ordinary_income - acc.deductible_expenses);
  const fedOrd = computeTax(taxableOrdinary, tables.federalOrdinary);
  const stOrd = computeTax(taxableOrdinary, tables.stateOrdinary);
  // LTCG taxed in its own bracket schedule. Some states (CA) tax LTCG as
  // ordinary; we use whatever state_brackets_ltcg specifies (CA mirrors).
  const fedLtcg = computeTax(acc.ltcg_income, tables.federalLtcg);
  const stLtcg = computeTax(acc.ltcg_income, tables.stateLtcg);
  // IRMAA only applies on/after Medicare eligibility (65). Use MAGI proxy
  // = ordinary + LTCG + tax-exempt interest. Real MAGI has subtleties we
  // skip in V1.
  let irmaa = 0;
  if (age >= 65 && tables.irmaa.length > 0) {
    const magi = acc.ordinary_income + acc.ltcg_income + acc.tax_exempt_interest;
    irmaa = computeIrmaaSurcharge(magi, tables.irmaa);
  }
  const ordinary = fedOrd + stOrd;
  const ltcg = fedLtcg + stLtcg;
  return { ordinary, ltcg, irmaa, total: ordinary + ltcg + irmaa };
}

// Marginal rate for ordinary income at the current accumulator level —
// federal + state combined. Used to gross up forced-sale withdrawals.
function ordinaryMarginalRate(acc: YearAccumulator, tables: ResolvedTaxTables): number {
  const taxable = Math.max(0, acc.ordinary_income - acc.deductible_expenses);
  return (
    marginalRate(taxable, tables.federalOrdinary) +
    marginalRate(taxable, tables.stateOrdinary)
  );
}

// =====================================================================
// Mutable simulation state — a clone of the seed accounts plus runtime
// fields like current balance, basis, and active flags.
// =====================================================================

interface SimAccount {
  node: AccountNode;
  balance: number;
  basis: number;
  active: boolean;
  parent_id: string | null;
}

interface SimState {
  accounts: Map<string, SimAccount>;
  jurisdiction_id: string;
  inflation_index: number;
}

function initSim(accounts: AccountNode[], household: Household): SimState {
  const m = new Map<string, SimAccount>();
  for (const node of accounts) {
    m.set(node.id, {
      node: { ...node },
      balance: node.start_value ?? 0,
      basis: node.cost_basis ?? node.start_value ?? 0,
      active: true,
      parent_id: node.parent_id,
    });
  }
  return {
    accounts: m,
    jurisdiction_id: household.jurisdiction_account_id,
    inflation_index: 1,
  };
}

function snapshotMap(sim: SimState): AccountMap {
  const m: AccountMap = new Map();
  for (const [id, sa] of sim.accounts) {
    m.set(id, { ...sa.node, parent_id: sa.parent_id, start_value: sa.balance });
  }
  return m;
}

// =====================================================================
// Event application
// =====================================================================

function paramValue(event: TimelineEvent, action: ActionTemplate): number {
  if (action.param_ref !== undefined) return event.parameters[action.param_ref] ?? 0;
  return action.value ?? 0;
}

interface ActionResult {
  liquidationProceeds: number; // for the cash-flow chart's "event liquidation" bar
}

function emptyActionResult(): ActionResult {
  return { liquidationProceeds: 0 };
}

function applyAction(
  sim: SimState,
  event: TimelineEvent,
  attachedId: string,
  action: ActionTemplate,
  acc_tax: YearAccumulator,
  yi: number,
  household: Household,
): ActionResult {
  const r = emptyActionResult();

  // Reparent acts on the actor (jurisdiction reference), not on an
  // attached account, so it runs even when attachedId is empty.
  if (action.type === 'reparent') {
    if (action.new_parent) sim.jurisdiction_id = action.new_parent;
    return r;
  }

  // Death runs at the household level. Mutates the household-clone's
  // actor.alive flag, transfers account ownership from the decedent to
  // surviving spouse(s), and flips filing status. Streams owned by a
  // dead actor stop producing income (handled in applyIncomeAndExpenses
  // via the alive check).
  if (action.type === 'death') {
    const id = action.actor_id ?? household.primary_actor_id;
    const target = household.actors.find((a) => a.id === id);
    if (target) target.alive = false;
    if (household.filing_status === 'mfj') household.filing_status = 'single';
    // Transfer ownership of decedent's ASSET accounts to the surviving
    // spouse (first remaining alive actor; falls back to primary).
    // Joint assets collapse to surviving-spouse ownership; spousal
    // rollover/step-up is tax-free, so no event accumulator updates.
    // Income/expense streams are NOT transferred — a decedent's salary
    // doesn't continue posthumously. The ownership stays as-is and the
    // stream filter in applyIncomeAndExpenses skips streams whose owner
    // is no longer alive.
    const survivors = household.actors.filter((a) => a.alive && a.id !== id);
    const heir = survivors[0] ?? household.actors.find((a) => a.id === household.primary_actor_id);
    if (heir) {
      for (const sa of sim.accounts.values()) {
        if (sa.node.kind !== 'asset' && sa.node.kind !== 'liability') continue;
        const owners = sa.node.owners ?? [household.primary_actor_id];
        if (!owners.includes(id)) continue;
        const next = owners.filter((o) => o !== id);
        if (!next.includes(heir.id)) next.push(heir.id);
        sa.node = { ...sa.node, owners: next };
      }
    }
    return r;
  }

  const acc = sim.accounts.get(attachedId);
  if (!acc) return r;

  if (action.type === 'end_account') {
    acc.active = false;
  } else if (action.type === 'set_value') {
    const v = paramValue(event, action);
    if (action.field === 'start_value' || action.field === 'balance') {
      acc.balance = v;
    } else if (action.field === 'annual_amount') {
      // Permanent shift on the stream's trajectory; subsequent years
      // compound from the new base via the existing growth_rate math.
      acc.node = { ...acc.node, annual_amount: v };
    }
  } else if (action.type === 'add_value') {
    const v = paramValue(event, action);
    if (action.field === 'start_value' || action.field === 'balance') {
      if (Math.abs(v) < 1) acc.balance *= 1 + v;
      else acc.balance += v;
    } else if (action.field === 'annual_amount') {
      const cur = acc.node.annual_amount ?? 0;
      const next = Math.abs(v) < 1 ? cur * (1 + v) : cur + v;
      acc.node = { ...acc.node, annual_amount: next };
    }
  } else if (action.type === 'transfer') {
    const dst = action.target_account ? sim.accounts.get(action.target_account) : undefined;
    const amt = Math.min(paramValue(event, action), acc.balance);
    acc.balance -= amt;
    if (dst) dst.balance += amt;
    // Tax-deferred → Roth conversion: gross amount adds to ordinary income.
    // Tax bill is computed at year-end via bracket walking.
    if (resolveTaxTreatment(acc.node) === 'tax_deferred') {
      acc_tax.ordinary_income += amt;
    }
  } else if (action.type === 'liquidate') {
    const proceeds = acc.balance;
    const basis = acc.basis;
    const gain = Math.max(0, proceeds - basis);
    const tt = resolveTaxTreatment(acc.node);
    if (tt === 'tax_deferred') {
      // NUA: basis-portion is ordinary income, gain-portion is LTCG.
      acc_tax.ordinary_income += basis;
      acc_tax.ltcg_income += gain;
    } else if (tt === 'taxable' || tt === undefined) {
      // Primary-residence sale gets the $500k MFJ / $250k single
      // exclusion. V1: always use the MFJ figure (the seed actor is
      // MFJ); refining to use actor.filing_status is small follow-up.
      const exclusion = acc.node.account_type === 'primary_residence' ? 500_000
        : acc.node.asset_class === 'real_estate' ? 500_000 // legacy
        : 0;
      const taxableGain = Math.max(0, gain - exclusion);
      acc_tax.ltcg_income += taxableGain;
    }
    // tax_free → no tax contribution. Net proceeds = full balance, since
    // tax for THIS year (including this liquidation's contribution) is
    // settled at year end.
    r.liquidationProceeds += proceeds;
    const cash = sim.accounts.get('cash_reserves');
    if (cash) cash.balance += proceeds;
    acc.balance = 0;
    acc.basis = 0;
    acc.active = false;
  } else if (action.type === 'rmd') {
    // Required Minimum Distribution: divide prior-end balance by the IRS
    // Uniform Lifetime Table divisor for the OWNER's current age. With
    // two-actor households, each spouse's age 73 starts their own RMD
    // schedule; we read it off the account's first owner.
    const ownerAge = ownerActor(household, acc.node).current_age + yi;
    const divisor = uniformLifetimeDivisor(ownerAge);
    if (divisor !== undefined && acc.balance > 0) {
      const amt = Math.min(acc.balance / divisor, acc.balance);
      acc.balance -= amt;
      const cash = sim.accounts.get('cash_reserves');
      if (cash) cash.balance += amt;
      acc_tax.ordinary_income += amt;
    }
  }
  // reparent is handled above the `if (!acc) return r` early return so
  // that attached_account_ids === [] events still take effect.
  return r;
}

function applyEvent(
  sim: SimState,
  event: TimelineEvent,
  acc_tax: YearAccumulator,
  yi: number,
  household: Household,
): ActionResult {
  const out = emptyActionResult();
  const ids = event.attached_account_ids.length > 0 ? event.attached_account_ids : [''];
  for (const id of ids) {
    for (const a of event.actions) {
      const r = applyAction(sim, event, id, a, acc_tax, yi, household);
      out.liquidationProceeds += r.liquidationProceeds;
    }
  }
  return out;
}

function eventFires(event: TimelineEvent, yi: number, household: Household): boolean {
  // trigger_age is interpreted on the event's actor_id timeline (default
  // = household primary). Lets a partner-anchored event fire at the
  // partner's age 73 even when primary is 75.
  const owner = actorById(household, event.actor_id);
  const age = owner.current_age + yi;
  if (event.kind === 'one_shot') return event.trigger_age === age;
  const end = event.end_age ?? event.trigger_age;
  return age >= event.trigger_age && age <= end;
}

// =====================================================================
// Per-year flows: income, expenses, withdrawals
// =====================================================================

interface FlowResult {
  income: number;
  expenses: number;
  income_by_source: Record<string, number>;
  expense_by_source: Record<string, number>;
}

// Apply income and expense streams. Income flows gross to cash and adds to
// the year's ordinary-income accumulator; expense flows gross out of cash
// and (when tax_deductible) reduces ordinary income. Year-end will compute
// the tax bill once.
//
// Per-stream age comparison reads the OWNER actor's age — partner's
// salary ends at partner's 67, primary's SS starts at primary's 70, etc.
// Streams owned by a non-alive actor are skipped (modelling: when a
// spouse dies, their salary stream stops; survivor SS is handled by the
// death event explicitly assigning the bigger benefit to the survivor).
function applyIncomeAndExpenses(
  sim: SimState,
  yi: number,
  household: Household,
  acc_tax: YearAccumulator,
): FlowResult {
  let income = 0;
  let expenses = 0;
  const incomeBySource: Record<string, number> = {};
  const expenseBySource: Record<string, number> = {};
  const map = snapshotMap(sim);

  for (const sa of sim.accounts.values()) {
    if (!sa.active) continue;
    const n = sa.node;
    const owner = ownerActor(household, n);
    if (!owner.alive && (n.kind === 'income' || n.kind === 'expense')) continue;
    const age = owner.current_age + yi;
    if (n.kind === 'income') {
      if (n.start_age !== undefined && age < n.start_age) continue;
      if (n.end_age !== undefined && age > n.end_age) continue;
      const growth = resolveField(map, n.id, 'growth_rate') ?? 0;
      const yearsSinceStart = age - (n.start_age ?? age);
      const amount = (n.annual_amount ?? 0) * Math.pow(1 + growth, yearsSinceStart);
      income += amount;
      acc_tax.ordinary_income += amount;
      incomeBySource[n.id] = (incomeBySource[n.id] ?? 0) + amount;
      const cash = sim.accounts.get('cash_reserves');
      if (cash) cash.balance += amount;
    } else if (n.kind === 'expense') {
      if (n.start_age !== undefined && age < n.start_age) continue;
      if (n.end_age !== undefined && age > n.end_age) continue;
      const growth = resolveField(map, n.id, 'growth_rate') ?? 0;
      const yearsSinceStart = age - (n.start_age ?? age);
      const amount = (n.annual_amount ?? 0) * Math.pow(1 + growth, yearsSinceStart);
      expenses += amount;
      expenseBySource[n.id] = (expenseBySource[n.id] ?? 0) + amount;
      if (n.tax_deductible) acc_tax.deductible_expenses += amount;
      const cash = sim.accounts.get('cash_reserves');
      if (cash) cash.balance -= amount;
    }
  }
  return {
    income,
    expenses,
    income_by_source: incomeBySource,
    expense_by_source: expenseBySource,
  };
}

// Cover negative cash by withdrawing from assets in tax-efficient order.
// Updates acc_tax in place so the year-end recompute sees the additional
// ordinary income from tax-deferred withdrawals (and LTCG from taxable
// gain realizations). Returns the net dollars added back to cash.
function applyForcedSales(
  sim: SimState,
  acc_tax: YearAccumulator,
  tables: ResolvedTaxTables,
): number {
  const cash = sim.accounts.get('cash_reserves');
  if (!cash || cash.balance >= 0) return 0;

  let need = -cash.balance;
  cash.balance = 0;
  let totalNetProceeds = 0;
  const map = snapshotMap(sim);
  const order: Array<'taxable' | 'tax_deferred' | 'tax_free'> = [
    'taxable',
    'tax_deferred',
    'tax_free',
  ];
  for (const treatment of order) {
    if (need <= 0) break;
    for (const sa of sim.accounts.values()) {
      if (need <= 0) break;
      if (sa.node.kind !== 'asset' || !sa.active) continue;
      const tt = resolveTaxTreatment(sa.node) ?? inheritedTaxTreatment(map, sa.node.id);
      if (tt !== treatment) continue;
      if (sa.balance <= 0) continue;
      // Bracket-aware gross-up for tax-deferred: take = need / (1 - marg).
      // Approximate (single-bracket assumption); good enough for V1.
      const margRate = treatment === 'tax_deferred' ? ordinaryMarginalRate(acc_tax, tables) : 0;
      const grossNeeded = treatment === 'tax_deferred' ? need / Math.max(0.0001, 1 - margRate) : need;
      const take = Math.min(grossNeeded, sa.balance);
      sa.balance -= take;
      let net: number;
      if (treatment === 'tax_deferred') {
        // Adds ordinary income; year-end recompute will produce the tax.
        acc_tax.ordinary_income += take;
        net = take * (1 - margRate);
      } else if (treatment === 'taxable') {
        // Realize a proportional slice of the gain.
        if (sa.basis > 0 && sa.balance + take > 0) {
          const gainPortion = Math.max(0, 1 - sa.basis / (sa.balance + take));
          acc_tax.ltcg_income += take * gainPortion;
        } else {
          acc_tax.ltcg_income += take; // assume full gain when no basis recorded
        }
        net = take;
      } else {
        // tax_free withdrawal — no tax effect.
        net = take;
      }
      cash.balance += net;
      totalNetProceeds += net;
      need -= net;
    }
  }
  return totalNetProceeds;
}

function inheritedTaxTreatment(map: AccountMap, id: string): string | undefined {
  const chain = parentChain(map, id);
  for (const n of chain) {
    const tt = resolveTaxTreatment(n);
    if (tt) return tt;
  }
  return undefined;
}

// =====================================================================
// Growth on assets
// =====================================================================

function growAssets(sim: SimState, shift: number): void {
  const map = snapshotMap(sim);
  for (const sa of sim.accounts.values()) {
    if (!sa.active) continue;
    if (sa.node.kind !== 'asset') continue;
    const baseY = effectiveYield(map, sa.node);
    const adj = sa.node.asset_class === 'equity' ? shift : shift * 0.4;
    sa.balance *= 1 + baseY + adj;
  }
}

function evolveInflation(sim: SimState): void {
  const map = snapshotMap(sim);
  // Inflation lives on the topmost ambient ancestor of any account; we
  // resolve it via the cash account's chain (the cash account is always
  // present and parented under the active economy).
  const i = resolveField(map, 'cash_reserves', 'inflation_rate') ?? 0;
  sim.inflation_index *= 1 + i;
}

// =====================================================================
// Main projection
// =====================================================================

export function project(
  accounts: AccountNode[],
  household: Household,
  events: TimelineEvent[],
): YearlyProjection[] {
  const startYear = new Date().getFullYear();
  // Horizon is anchored to the household primary's age timeline. Other
  // actors may be older or younger; their per-year ages are computed via
  // (their.current_age + yi) wherever per-actor reasoning is needed.
  const primary = primaryActor(household);
  const horizon = household.horizon_age - primary.current_age;

  const scenarios: Array<['baseline' | 'best' | 'worst', number]> = [
    ['baseline', 0],
    ['best', 0.02],
    ['worst', -0.02],
  ];

  const series: Record<'baseline' | 'best' | 'worst', number[]> = {
    baseline: [],
    best: [],
    worst: [],
  };
  const taxOrdinaryPerYear: number[] = [];
  const taxLtcgPerYear: number[] = [];
  const incomePerYear: number[] = [];
  const expensesPerYear: number[] = [];
  const incomeBySourcePerYear: Record<string, number>[] = [];
  const expenseBySourcePerYear: Record<string, number>[] = [];
  const eventLiquidationPerYear: number[] = [];
  const forcedSalePerYear: number[] = [];
  const embeddedGainPerYear: number[] = [];
  const byAccountSeries: Record<string, number>[] = [];
  const inflationSeries: number[] = [];
  const eventsPerYear: TimelineEvent[][] = Array.from({ length: horizon + 1 }, () => []);

  for (const [label, shift] of scenarios) {
    const sim = initSim(accounts, household);
    // The death action mutates household.actors[i].alive AND filing_status
    // during projection; we work on a deep clone per scenario so the cone
    // (best/baseline/worst) replays cleanly without sticky state from a
    // prior run, and so the caller's input household isn't mutated.
    const hh: Household = {
      ...household,
      actors: household.actors.map((a) => ({ ...a })),
    };

    for (let yi = 0; yi <= horizon; yi++) {
      const primaryAge = primary.current_age + yi;
      if (yi > 0) evolveInflation(sim);

      const acc_tax = emptyYearAccumulator();

      const triggered = events.filter((e) => eventFires(e, yi, hh));
      if (label === 'baseline') eventsPerYear[yi] = triggered;
      let yearLiquidation = 0;
      for (const e of triggered) {
        const r = applyEvent(sim, e, acc_tax, yi, hh);
        yearLiquidation += r.liquidationProceeds;
      }

      const flow = applyIncomeAndExpenses(sim, yi, hh, acc_tax);

      // Build tax tables AFTER events have fired — a reparent event may
      // have switched the active jurisdiction (e.g., Move to Florida),
      // and a death event may have flipped MFJ → single.
      const filingStatus: FilingStatus = hh.filing_status ?? 'single';
      const tables = buildTaxTables(snapshotMap(sim), sim.jurisdiction_id, filingStatus);

      // Initial year-end tax based on income/event/conversion activity.
      // Use primary's age for IRMAA eligibility (≥ 65); a more refined
      // model would per-actor IRMAA, but that's overkill for V1.
      let yearTax = computeYearEndTax(acc_tax, tables, primaryAge);
      const cash = sim.accounts.get('cash_reserves');
      if (cash) cash.balance -= yearTax.total;

      // Forced sales to cover any cash deficit. Tax-deferred withdrawals
      // gross up via marginal-rate approximation and add to ordinary
      // income. Recompute year-end tax to reflect that incremental
      // ordinary income; deduct the delta. One pass usually suffices for
      // single-bracket cases; bracket transitions may slightly under-pay.
      const forcedSaleProceeds = applyForcedSales(sim, acc_tax, tables);
      const yearTax2 = computeYearEndTax(acc_tax, tables, primaryAge);
      const taxDelta = yearTax2.total - yearTax.total;
      if (taxDelta !== 0 && cash) cash.balance -= taxDelta;
      yearTax = yearTax2;

      growAssets(sim, shift);

      const portfolio = portfolioTotal(sim);
      series[label].push(portfolio);

      if (label === 'baseline') {
        // IRMAA is an income-based Medicare-premium surcharge, so we
        // bucket it with ordinary tax for display in the cash-flow chart.
        // The arithmetic of total taxes is unaffected.
        taxOrdinaryPerYear.push(yearTax.ordinary + yearTax.irmaa);
        taxLtcgPerYear.push(yearTax.ltcg);
        incomePerYear.push(flow.income);
        expensesPerYear.push(flow.expenses);
        incomeBySourcePerYear.push(flow.income_by_source);
        expenseBySourcePerYear.push(flow.expense_by_source);
        eventLiquidationPerYear.push(yearLiquidation);
        forcedSalePerYear.push(forcedSaleProceeds);
        const byAcc: Record<string, number> = {};
        let embeddedGain = 0;
        for (const sa of sim.accounts.values()) {
          if (sa.node.kind !== 'asset') continue;
          byAcc[sa.node.id] = sa.balance;
          if (!sa.active) continue;
          // Step-up only applies to assets whose unrealized gain would
          // otherwise be subject to capital-gains tax: taxable brokerage,
          // primary residence, investment property — anything with the
          // 'taxable' tax_treatment. Tax-deferred (401k/IRA) gets no
          // step-up; Roth has no embedded gain to step up.
          const tt = resolveTaxTreatment(sa.node);
          if (tt && tt !== 'taxable') continue;
          embeddedGain += Math.max(0, sa.balance - sa.basis);
        }
        byAccountSeries.push(byAcc);
        embeddedGainPerYear.push(embeddedGain);
        inflationSeries.push(sim.inflation_index);
      }
    }
  }

  const out: YearlyProjection[] = [];
  for (let yi = 0; yi <= horizon; yi++) {
    out.push({
      age: primary.current_age + yi,
      year: startYear + yi,
      total_baseline: series.baseline[yi],
      total_best: series.best[yi],
      total_worst: series.worst[yi],
      by_account: byAccountSeries[yi],
      taxes_paid: taxOrdinaryPerYear[yi] + taxLtcgPerYear[yi],
      tax_ordinary: taxOrdinaryPerYear[yi],
      tax_ltcg: taxLtcgPerYear[yi],
      events_this_year: eventsPerYear[yi],
      cumulative_inflation_index: inflationSeries[yi],
      income_received: incomePerYear[yi],
      expenses_paid: expensesPerYear[yi],
      income_by_source: incomeBySourcePerYear[yi],
      expense_by_source: expenseBySourcePerYear[yi],
      event_liquidation_proceeds: eventLiquidationPerYear[yi],
      forced_sale_proceeds: forcedSalePerYear[yi],
      embedded_gain: embeddedGainPerYear[yi],
    });
  }
  return out;
}

function portfolioTotal(sim: SimState): number {
  let s = 0;
  for (const sa of sim.accounts.values())
    if (sa.node.kind === 'asset' && sa.active) s += sa.balance;
  return s;
}
