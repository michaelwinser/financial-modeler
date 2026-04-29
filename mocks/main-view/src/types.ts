// =====================================================================
// Unified-ledger schema. Every node in the financial model is an account
// in a single tree. Inheritance follows the parent chain.
// =====================================================================

export type AccountKind =
  | 'category' // structural grouping; no balance of its own
  | 'ambient' // ambient/economic value (e.g., equity_yield, inflation, jurisdiction)
  | 'asset' // holds value that grows; e.g., stock lot, cash, house
  | 'liability' // debt; negative balance; grows by interest_rate
  | 'income' // produces cash into a sink
  | 'expense'; // consumes cash from a sink

export type AssetClass = 'equity' | 'bond' | 'cash' | 'real_estate' | 'other';
export type TaxTreatment = 'taxable' | 'tax_deferred' | 'tax_free';

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
  tax_treatment?: TaxTreatment;
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
  effective_tax_rate?: FieldValue; // for income / withdrawals
  // For income/expense streams:
  start_age?: number;
  end_age?: number;
  annual_amount?: number; // base amount at start_age (nominal)
  growth_rate?: FieldValue; // annual nominal growth applied to annual_amount
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
  | 'end_account'; // mark account inactive at this age

export interface ActionTemplate {
  type: ActionType;
  field?: string;
  value?: number; // can reference a parameter via name
  param_ref?: string; // name of an event parameter to use as value
  target_account?: string; // for transfer/liquidate; the destination
  new_parent?: string; // for reparent
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
}

// =====================================================================
// Actor (the user)
// =====================================================================

export interface Actor {
  current_age: number;
  horizon_age: number;
  cash_account_id: string; // the sink for income/expenses/withdrawals
  jurisdiction_account_id: string; // currently-active jurisdiction node
  scenario_name: string;
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
}
