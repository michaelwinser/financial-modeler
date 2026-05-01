// =====================================================================
// Unified-ledger schema. Every node in the financial model is an account
// in a single tree. Inheritance follows the parent chain.
// =====================================================================

// Tax-table data types. Logic (compute/walk/IRMAA) lives in tax.ts.
export interface Bracket {
  from: number;
  rate: number;
}

export type BracketTable = Bracket[];

// Per-filing-status bracket tables. A jurisdiction ambient publishes one
// of these for each tax kind it supports. The engine selects the right
// inner array via actor.filing_status.
export interface BracketTablesByStatus {
  single?: BracketTable;
  mfj?: BracketTable;
}

export interface IrmaaTier {
  from: number;
  surcharge_annual: number;
}

export interface IrmaaTiersByStatus {
  single?: IrmaaTier[];
  mfj?: IrmaaTier[];
}

export type AccountKind =
  | 'category' // structural grouping; no balance of its own
  | 'ambient' // ambient/economic value (e.g., equity_yield, inflation, jurisdiction)
  | 'asset' // holds value that grows; e.g., stock lot, cash, house
  | 'liability' // debt; negative balance; grows by interest_rate
  | 'income' // produces cash into a sink
  | 'expense'; // consumes cash from a sink

export type AssetClass = 'equity' | 'bond' | 'cash' | 'real_estate' | 'other';
export type TaxTreatment = 'taxable' | 'tax_deferred' | 'tax_free';

// Granular account taxonomy. Drives default tax_treatment, RMD eligibility,
// and special handling (e.g., MFJ home-sale exclusion, muni-bond federal
// exemption). Users can override the derived tax_treatment / subject_to_rmd
// fields on a specific account if needed; this enum is the typical case.
//
// Mapping ⇒ derived defaults (see deriveTaxTreatment / deriveSubjectToRmd):
//
// taxable_brokerage    → taxable     · no RMD
// traditional_401k     → tax_deferred · RMD at 73 (covers 401k/403b/457b/IRA/SEP/SIMPLE)
// roth_account         → tax_free    · no RMD (Roth IRA + Roth 401k post-SECURE 2.0)
// municipal_bond       → taxable     · no RMD · federal interest exempt
// cash                 → taxable     · no RMD
// pension              → (n/a; flow only — modeled as kind='income')
// primary_residence    → taxable     · $500k MFJ home-sale exclusion
// investment_property  → taxable     · no exclusion on sale
export type AccountType =
  | 'taxable_brokerage'
  | 'traditional_401k'
  | 'roth_account'
  | 'municipal_bond'
  | 'cash'
  | 'pension'
  | 'primary_residence'
  | 'investment_property';

// Filing status for tax-table selection. Phase 3.0 ships single + mfj;
// 3.5 will add survivor (single after death-of-spouse) and possibly mfs.
export type FilingStatus = 'single' | 'mfj';

export interface Override {
  mode: 'absolute' | 'delta';
  value: number;
}

// A field can be inherited (undefined → walk to parent), or explicitly set,
// or expressed as a delta on the inherited value.
export type FieldValue = number | Override | undefined;

export interface AccountNode {
  id: string;
  name: string;
  kind: AccountKind;
  parent_id: string | null;
  // Optional descriptive metadata
  asset_class?: AssetClass;
  account_type?: AccountType; // granular taxonomy; tax_treatment + subject_to_rmd derived from this
  tax_treatment?: TaxTreatment; // override of derived default
  subject_to_rmd?: boolean; // override of derived default (typical: true iff account_type='traditional_401k')
  custodian?: string; // tag for grouping (Schwab, Fidelity 401k, Vanguard, etc.)
  // Per-asset-class yields (lived on ambient parents like US Economy).
  // For asset accounts, an explicit yield_rate overrides the inherited
  // typed-yield lookup.
  equity_yield?: FieldValue;
  bond_yield?: FieldValue;
  cash_yield?: FieldValue;
  real_estate_yield?: FieldValue;
  inflation_rate?: FieldValue;
  // Resolvable values — inherited if undefined
  start_value?: number;
  yield_rate?: FieldValue; // explicit override on a specific asset
  cost_basis?: number; // for taxable assets
  effective_tax_rate?: FieldValue; // legacy single-rate fallback; superseded by bracket tables when present
  // Bracket-based tax tables on jurisdiction ambients. Federal brackets
  // typically live on a Federal-Tax parent ambient and are inherited by
  // state children. State-level fields live on each state ambient. All
  // are optional; engine falls back to effective_tax_rate when missing.
  federal_brackets_ordinary?: BracketTablesByStatus;
  federal_brackets_ltcg?: BracketTablesByStatus;
  state_brackets_ordinary?: BracketTablesByStatus;
  state_brackets_ltcg?: BracketTablesByStatus;
  irmaa_tiers?: IrmaaTiersByStatus;
  // For income/expense streams:
  start_age?: number;
  end_age?: number;
  annual_amount?: number; // base amount at start_age (nominal)
  growth_rate?: FieldValue; // annual nominal growth applied to annual_amount
  tax_deductible?: boolean; // expense streams only: reduces taxable income by their amount
  // Phase 3.5 ownership. Array of Actor.id values. Defaults to
  // [Household.primary_actor_id] when undefined. For asset accounts,
  // length > 1 means joint ownership; on death of one owner the
  // surviving spouse inherits. For income/expense streams, owners[0]
  // determines whose age drives start_age/end_age and whose RMD
  // obligations apply.
  owners?: string[];
}

// =====================================================================
// Events
// =====================================================================

export type ActionType =
  | 'set_value' // set field on an account
  | 'add_value' // add to a numeric field
  | 'transfer' // move money between two accounts
  | 'liquidate' // sell asset; basis to ordinary tax, gains to LTCG, cash to sink
  | 'reparent' // change an account's parent (e.g., jurisdiction switch)
  | 'end_account' // mark account inactive at this age
  | 'rmd' // dynamically-sized withdrawal from a tax-deferred account using the IRS Uniform Lifetime Table
  | 'death'; // mark an actor inactive; surviving spouse inherits accounts; filing status flips MFJ→single

export interface ActionTemplate {
  type: ActionType;
  field?: string;
  value?: number; // can reference a parameter via name
  param_ref?: string; // name of an event parameter to use as value
  target_account?: string; // for transfer/liquidate; the destination
  new_parent?: string; // for reparent
  actor_id?: string; // for death; which actor dies
}

export interface TimelineEvent {
  id: string;
  name: string;
  description?: string;
  trigger_age: number;
  end_age?: number; // present → ranged/recurring
  kind: 'one_shot' | 'recurring';
  attached_account_ids: string[];
  parameters: Record<string, number>; // shared across all attachments
  actions: ActionTemplate[];
  auto_generated?: boolean; // true if synthesized from declarative fields
  // Phase 3.5: which actor's age timeline drives trigger_age / end_age.
  // Undefined → household primary actor (back-compat for v1 scenarios).
  actor_id?: string;
}

// =====================================================================
// Household — one or two real people sharing a tax filing and a
// portfolio. Phase 3.5 promoted the singleton `Actor` to a household
// container; per-person fields (current_age, alive) live on individual
// `Actor` records.
// =====================================================================

// One human in the household. Has an age timeline and an alive flag
// (toggled by a death event during projection). Income streams, RMDs,
// and account ownership reference an Actor by id.
export interface Actor {
  id: string;
  name: string;
  current_age: number;
  alive: boolean; // false post-death event
}

export interface Household {
  scenario_name: string;
  horizon_age: number; // household-level — projection stops here
  cash_account_id: string; // the sink for income/expenses/withdrawals
  jurisdiction_account_id: string; // currently-active jurisdiction node
  filing_status?: FilingStatus; // default 'single'; bracket-walking selects the right table
  actors: Actor[]; // 1 or 2 people; primary is referenced by primary_actor_id
  primary_actor_id: string; // the lead person (used for fallback/back-compat)
}

// =====================================================================
// Projection output
// =====================================================================

export interface YearlyProjection {
  age: number;
  year: number;
  total_baseline: number;
  total_best: number;
  total_worst: number;
  by_account: Record<string, number>;
  taxes_paid: number;
  tax_ordinary: number;
  tax_ltcg: number;
  events_this_year: TimelineEvent[];
  cumulative_inflation_index: number;
  income_received: number;
  expenses_paid: number;
  // Cashflow breakdowns for the cash-flow chart.
  income_by_source: Record<string, number>; // keyed by income account id
  expense_by_source: Record<string, number>; // keyed by expense account id
  event_liquidation_proceeds: number; // NUA, house sale, etc.
  forced_sale_proceeds: number; // forced withdrawals to cover negative cash
  // Sum of (balance − basis) over taxable assets at year end. Used by
  // analysis views to show the unrealized gain that would step up if the
  // actor died this year (heirs inherit at fair market value, eliminating
  // that gain from future LTCG). Tax-deferred accounts get no step-up;
  // Roth has no embedded gain to step up.
  embedded_gain: number;
}
