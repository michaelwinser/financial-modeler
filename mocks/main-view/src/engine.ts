import type {
  AccountNode,
  Actor,
  AssetClass,
  FieldValue,
  TimelineEvent,
  YearlyProjection,
  ActionTemplate,
} from './types';

// =====================================================================
// Tree resolution helpers
// =====================================================================

type AccountMap = Map<string, AccountNode>;

const buildMap = (accounts: AccountNode[]): AccountMap =>
  new Map(accounts.map((a) => [a.id, a]));

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

function initSim(accounts: AccountNode[], actor: Actor): SimState {
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
    jurisdiction_id: actor.jurisdiction_account_id,
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
  tax_ordinary: number;
  tax_ltcg: number;
  liquidationProceeds: number;
}

function emptyActionResult(): ActionResult {
  return { tax_ordinary: 0, tax_ltcg: 0, liquidationProceeds: 0 };
}

function applyAction(
  sim: SimState,
  event: TimelineEvent,
  attachedId: string,
  action: ActionTemplate,
): ActionResult {
  const acc = sim.accounts.get(attachedId);
  const r = emptyActionResult();
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
    // Tax-deferred → Roth conversion is fully ordinary income.
    if (acc.node.tax_treatment === 'tax_deferred') {
      const rate = jurisdictionTaxRate(snapshotMap(sim), sim.jurisdiction_id);
      const tax = amt * rate;
      r.tax_ordinary += tax;
      const cash = sim.accounts.get('cash_reserves');
      if (cash) cash.balance -= tax;
    }
  } else if (action.type === 'liquidate') {
    const map = snapshotMap(sim);
    const rate = jurisdictionTaxRate(map, sim.jurisdiction_id);
    const proceeds = acc.balance;
    const basis = acc.basis;
    const gain = Math.max(0, proceeds - basis);
    let tax = 0;
    if (acc.node.tax_treatment === 'tax_deferred') {
      // NUA: basis at ordinary, gain at LTCG (0.6 × ordinary as proxy).
      const ord = basis * rate;
      const ltcg = gain * rate * 0.6;
      r.tax_ordinary += ord;
      r.tax_ltcg += ltcg;
      tax = ord + ltcg;
    } else if (acc.node.tax_treatment === 'taxable' || acc.node.tax_treatment === undefined) {
      const exclusion = acc.node.asset_class === 'real_estate' ? 500000 : 0;
      const taxableGain = Math.max(0, gain - exclusion);
      const ltcg = taxableGain * rate * 0.6;
      r.tax_ltcg += ltcg;
      tax = ltcg;
    }
    const net = proceeds - tax;
    r.liquidationProceeds += net;
    const cash = sim.accounts.get('cash_reserves');
    if (cash) cash.balance += net;
    acc.balance = 0;
    acc.basis = 0;
    acc.active = false;
  } else if (action.type === 'reparent') {
    if (action.new_parent) sim.jurisdiction_id = action.new_parent;
  }
  return r;
}

function applyEvent(sim: SimState, event: TimelineEvent): ActionResult {
  const out = emptyActionResult();
  const ids = event.attached_account_ids.length > 0 ? event.attached_account_ids : [''];
  for (const id of ids) {
    for (const a of event.actions) {
      const r = applyAction(sim, event, id, a);
      out.tax_ordinary += r.tax_ordinary;
      out.tax_ltcg += r.tax_ltcg;
      out.liquidationProceeds += r.liquidationProceeds;
    }
  }
  return out;
}

function eventFires(event: TimelineEvent, age: number): boolean {
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
  tax_ordinary: number;
  tax_ltcg: number;
  income_by_source: Record<string, number>;
  expense_by_source: Record<string, number>;
  forced_sale_proceeds: number;
}

function applyIncomeAndExpenses(sim: SimState, age: number): FlowResult {
  let income = 0;
  let expenses = 0;
  let tax_ordinary = 0;
  let tax_ltcg = 0;
  let forcedSaleProceeds = 0;
  const incomeBySource: Record<string, number> = {};
  const expenseBySource: Record<string, number> = {};
  const map = snapshotMap(sim);
  const taxRate = jurisdictionTaxRate(map, sim.jurisdiction_id);

  for (const sa of sim.accounts.values()) {
    if (!sa.active) continue;
    const n = sa.node;
    if (n.kind === 'income') {
      if (n.start_age !== undefined && age < n.start_age) continue;
      if (n.end_age !== undefined && age > n.end_age) continue;
      const growth = resolveField(map, n.id, 'growth_rate') ?? 0;
      const yearsSinceStart = age - (n.start_age ?? age);
      const amount = (n.annual_amount ?? 0) * Math.pow(1 + growth, yearsSinceStart);
      const tax = amount * taxRate;
      const net = amount - tax;
      income += amount;
      tax_ordinary += tax;
      incomeBySource[n.id] = (incomeBySource[n.id] ?? 0) + amount;
      const cash = sim.accounts.get('cash_reserves');
      if (cash) cash.balance += net;
    } else if (n.kind === 'expense') {
      if (n.start_age !== undefined && age < n.start_age) continue;
      if (n.end_age !== undefined && age > n.end_age) continue;
      const growth = resolveField(map, n.id, 'growth_rate') ?? 0;
      const yearsSinceStart = age - (n.start_age ?? age);
      const amount = (n.annual_amount ?? 0) * Math.pow(1 + growth, yearsSinceStart);
      expenses += amount;
      expenseBySource[n.id] = (expenseBySource[n.id] ?? 0) + amount;
      const cash = sim.accounts.get('cash_reserves');
      if (cash) cash.balance -= amount;
    }
  }

  let cash = sim.accounts.get('cash_reserves');
  if (cash && cash.balance < 0) {
    let need = -cash.balance;
    cash.balance = 0;
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
        const tt = sa.node.tax_treatment ?? inheritedTaxTreatment(map, sa.node.id);
        if (tt !== treatment) continue;
        if (sa.balance <= 0) continue;
        const grossNeeded =
          treatment === 'tax_deferred' ? need / (1 - taxRate) : need;
        const take = Math.min(grossNeeded, sa.balance);
        sa.balance -= take;
        const net = treatment === 'tax_deferred' ? take * (1 - taxRate) : take;
        if (treatment === 'tax_deferred') tax_ordinary += take - net;
        if (treatment === 'taxable' && sa.basis > 0) {
          const gainPortion = Math.max(0, 1 - sa.basis / (sa.balance + take));
          const ltcg = take * gainPortion * taxRate * 0.6;
          tax_ltcg += ltcg;
        }
        forcedSaleProceeds += net;
        need -= net;
      }
    }
  }
  return {
    income,
    expenses,
    tax_ordinary,
    tax_ltcg,
    income_by_source: incomeBySource,
    expense_by_source: expenseBySource,
    forced_sale_proceeds: forcedSaleProceeds,
  };
}

function inheritedTaxTreatment(map: AccountMap, id: string): string | undefined {
  const chain = parentChain(map, id);
  for (const n of chain) if (n.tax_treatment) return n.tax_treatment;
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
  actor: Actor,
  events: TimelineEvent[],
): YearlyProjection[] {
  const startYear = new Date().getFullYear();
  const horizon = actor.horizon_age - actor.current_age;

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
  const byAccountSeries: Record<string, number>[] = [];
  const inflationSeries: number[] = [];
  const eventsPerYear: TimelineEvent[][] = Array.from({ length: horizon + 1 }, () => []);

  for (const [label, shift] of scenarios) {
    const sim = initSim(accounts, actor);

    for (let yi = 0; yi <= horizon; yi++) {
      const age = actor.current_age + yi;
      if (yi > 0) evolveInflation(sim);

      const triggered = events.filter((e) => eventFires(e, age));
      if (label === 'baseline') eventsPerYear[yi] = triggered;
      let yearOrd = 0;
      let yearLtcg = 0;
      let yearLiquidation = 0;
      for (const e of triggered) {
        const r = applyEvent(sim, e);
        yearOrd += r.tax_ordinary;
        yearLtcg += r.tax_ltcg;
        yearLiquidation += r.liquidationProceeds;
      }

      const flow = applyIncomeAndExpenses(sim, age);
      yearOrd += flow.tax_ordinary;
      yearLtcg += flow.tax_ltcg;

      growAssets(sim, shift);

      const portfolio = portfolioTotal(sim);
      series[label].push(portfolio);

      if (label === 'baseline') {
        taxOrdinaryPerYear.push(yearOrd);
        taxLtcgPerYear.push(yearLtcg);
        incomePerYear.push(flow.income);
        expensesPerYear.push(flow.expenses);
        incomeBySourcePerYear.push(flow.income_by_source);
        expenseBySourcePerYear.push(flow.expense_by_source);
        eventLiquidationPerYear.push(yearLiquidation);
        forcedSalePerYear.push(flow.forced_sale_proceeds);
        const byAcc: Record<string, number> = {};
        for (const sa of sim.accounts.values())
          if (sa.node.kind === 'asset') byAcc[sa.node.id] = sa.balance;
        byAccountSeries.push(byAcc);
        inflationSeries.push(sim.inflation_index);
      }
    }
  }

  const out: YearlyProjection[] = [];
  for (let yi = 0; yi <= horizon; yi++) {
    out.push({
      age: actor.current_age + yi,
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
