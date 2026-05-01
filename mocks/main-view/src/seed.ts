import type { AccountNode, Actor, TimelineEvent } from './types';

// ---------------------------------------------------------------------
// Account tree.
//
// US Economy is the root ambient parent: its yields and inflation are
// scalar fields, edited in its inspector. Personal accounts hang
// directly off it. Custodian (Schwab/Fidelity/Vanguard) is a tag, not
// a tree level — different accounts at the same custodian could in
// principle inherit from different economies.
// ---------------------------------------------------------------------

export const seedAccounts: AccountNode[] = [
  {
    id: 'us_economy',
    name: 'US Economy',
    kind: 'ambient',
    parent_id: null,
    equity_yield: 0.07,
    bond_yield: 0.04,
    cash_yield: 0.035,
    real_estate_yield: 0.035,
    inflation_rate: 0.03,
  },

  // Investment lots (taxable brokerage)
  {
    id: 'schwab_msft',
    name: 'MSFT lot',
    kind: 'asset',
    parent_id: 'us_economy',
    asset_class: 'equity',
    account_type: 'taxable_brokerage',
    custodian: 'Schwab',
    start_value: 420000,
    cost_basis: 90000,
  },
  {
    id: 'schwab_vti',
    name: 'VTI (broad equity)',
    kind: 'asset',
    parent_id: 'us_economy',
    asset_class: 'equity',
    account_type: 'taxable_brokerage',
    custodian: 'Schwab',
    start_value: 430000,
    cost_basis: 250000,
  },
  {
    id: 'schwab_bnd',
    name: 'BND (bond fund)',
    kind: 'asset',
    parent_id: 'us_economy',
    asset_class: 'bond',
    account_type: 'taxable_brokerage',
    custodian: 'Schwab',
    start_value: 250000,
    cost_basis: 240000,
  },

  // 401(k) holdings
  {
    id: 'fidelity_company_stock',
    name: 'Company stock (NUA candidate)',
    kind: 'asset',
    parent_id: 'us_economy',
    asset_class: 'equity',
    account_type: 'traditional_401k',
    custodian: 'Fidelity 401(k)',
    start_value: 400000,
    cost_basis: 80000,
  },
  {
    id: 'fidelity_index',
    name: 'Index funds',
    kind: 'asset',
    parent_id: 'us_economy',
    asset_class: 'equity',
    account_type: 'traditional_401k',
    custodian: 'Fidelity 401(k)',
    start_value: 850000,
  },
  {
    id: 'fidelity_bonds',
    name: 'Bond allocation',
    kind: 'asset',
    parent_id: 'us_economy',
    asset_class: 'bond',
    account_type: 'traditional_401k',
    custodian: 'Fidelity 401(k)',
    start_value: 350000,
  },

  // Roth IRA
  {
    id: 'roth_vtsax',
    name: 'VTSAX',
    kind: 'asset',
    parent_id: 'us_economy',
    asset_class: 'equity',
    account_type: 'roth_account',
    custodian: 'Vanguard Roth',
    start_value: 320000,
  },

  // Cash / reserves
  {
    id: 'cash_reserves',
    name: 'Cash & reserves',
    kind: 'asset',
    parent_id: 'us_economy',
    asset_class: 'cash',
    account_type: 'cash',
    custodian: 'Schwab',
    start_value: 180000,
  },

  // Real assets
  {
    id: 'house',
    name: 'Primary residence (Palo Alto)',
    kind: 'asset',
    parent_id: 'us_economy',
    asset_class: 'real_estate',
    account_type: 'primary_residence',
    start_value: 2400000,
    cost_basis: 1100000,
  },

  // Income & expense streams
  {
    id: 'salary',
    name: 'Salary',
    kind: 'income',
    parent_id: 'us_economy',
    annual_amount: 320000,
    start_age: 62,
    end_age: 67,
    growth_rate: 0.03, // 3% annual raises
  },
  {
    id: 'social_security',
    name: 'Social Security',
    kind: 'income',
    parent_id: 'us_economy',
    annual_amount: 52000,
    start_age: 70,
    end_age: 95,
    growth_rate: 0.025, // SS COLA
  },
  {
    id: 'living_expenses',
    name: 'Living expenses',
    kind: 'expense',
    parent_id: 'us_economy',
    annual_amount: 180000,
    start_age: 62,
    end_age: 95,
    growth_rate: 0.03, // grows with inflation
  },
  {
    id: 'healthcare',
    name: 'Healthcare (post-65)',
    kind: 'expense',
    parent_id: 'us_economy',
    annual_amount: 28000,
    start_age: 65,
    end_age: 95,
    growth_rate: 0.05, // medical inflation
  },

  // Tax jurisdictions form their own subtree. Federal Tax is the parent;
  // states are children that inherit federal brackets and add state-level
  // brackets of their own. The actor references the *state* node, and the
  // engine walks up to find federal brackets.
  //
  // Numbers below are rounded approximations of 2025 IRS / state tables.
  // They're shipped as defaults; users can edit per scenario.
  {
    id: 'tax_federal',
    name: 'Federal Tax',
    kind: 'ambient',
    parent_id: null,
    federal_brackets_ordinary: {
      single: [
        { from: 0, rate: 0.10 },
        { from: 11_925, rate: 0.12 },
        { from: 48_475, rate: 0.22 },
        { from: 103_350, rate: 0.24 },
        { from: 197_300, rate: 0.32 },
        { from: 250_525, rate: 0.35 },
        { from: 626_350, rate: 0.37 },
      ],
      mfj: [
        { from: 0, rate: 0.10 },
        { from: 23_850, rate: 0.12 },
        { from: 96_950, rate: 0.22 },
        { from: 206_700, rate: 0.24 },
        { from: 394_600, rate: 0.32 },
        { from: 501_050, rate: 0.35 },
        { from: 751_600, rate: 0.37 },
      ],
    },
    federal_brackets_ltcg: {
      single: [
        { from: 0, rate: 0.0 },
        { from: 48_350, rate: 0.15 },
        { from: 533_400, rate: 0.20 },
      ],
      mfj: [
        { from: 0, rate: 0.0 },
        { from: 96_700, rate: 0.15 },
        { from: 600_050, rate: 0.20 },
      ],
    },
    irmaa_tiers: {
      // Approximate per-couple annual Medicare Part B + D surcharges by MAGI tier (MFJ).
      mfj: [
        { from: 0, surcharge_annual: 0 },
        { from: 212_000, surcharge_annual: 1_872 },
        { from: 266_000, surcharge_annual: 4_680 },
        { from: 334_000, surcharge_annual: 7_488 },
        { from: 400_000, surcharge_annual: 10_296 },
        { from: 750_000, surcharge_annual: 13_104 },
      ],
      single: [
        { from: 0, surcharge_annual: 0 },
        { from: 106_000, surcharge_annual: 936 },
        { from: 133_000, surcharge_annual: 2_340 },
        { from: 167_000, surcharge_annual: 3_744 },
        { from: 200_000, surcharge_annual: 5_148 },
        { from: 500_000, surcharge_annual: 6_552 },
      ],
    },
  },
  {
    id: 'tax_california',
    name: 'California (resident)',
    kind: 'ambient',
    parent_id: 'tax_federal',
    // Legacy fallback if anyone unsets the bracket tables.
    effective_tax_rate: 0.32,
    // CA state ordinary brackets, simplified to the headline tiers (actual schedule has 9).
    state_brackets_ordinary: {
      single: [
        { from: 0, rate: 0.01 },
        { from: 10_756, rate: 0.02 },
        { from: 25_499, rate: 0.04 },
        { from: 40_245, rate: 0.06 },
        { from: 55_866, rate: 0.08 },
        { from: 70_606, rate: 0.093 },
        { from: 360_659, rate: 0.103 },
        { from: 432_787, rate: 0.113 },
        { from: 721_314, rate: 0.123 },
      ],
      mfj: [
        { from: 0, rate: 0.01 },
        { from: 21_512, rate: 0.02 },
        { from: 50_998, rate: 0.04 },
        { from: 80_490, rate: 0.06 },
        { from: 111_732, rate: 0.08 },
        { from: 141_212, rate: 0.093 },
        { from: 721_318, rate: 0.103 },
        { from: 865_574, rate: 0.113 },
        { from: 1_442_628, rate: 0.123 },
      ],
    },
    // CA taxes LTCG as ordinary income — same brackets.
    state_brackets_ltcg: {
      single: [
        { from: 0, rate: 0.01 },
        { from: 10_756, rate: 0.02 },
        { from: 25_499, rate: 0.04 },
        { from: 40_245, rate: 0.06 },
        { from: 55_866, rate: 0.08 },
        { from: 70_606, rate: 0.093 },
        { from: 360_659, rate: 0.103 },
        { from: 432_787, rate: 0.113 },
        { from: 721_314, rate: 0.123 },
      ],
      mfj: [
        { from: 0, rate: 0.01 },
        { from: 21_512, rate: 0.02 },
        { from: 50_998, rate: 0.04 },
        { from: 80_490, rate: 0.06 },
        { from: 111_732, rate: 0.08 },
        { from: 141_212, rate: 0.093 },
        { from: 721_318, rate: 0.103 },
        { from: 865_574, rate: 0.113 },
        { from: 1_442_628, rate: 0.123 },
      ],
    },
  },
  {
    id: 'tax_florida',
    name: 'Florida',
    kind: 'ambient',
    parent_id: 'tax_federal',
    // FL has no state income tax; state_brackets_* fields intentionally absent.
    effective_tax_rate: 0.22, // legacy fallback; engine prefers brackets when present
  },
];

// ---------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------

export const seedActor: Actor = {
  current_age: 62,
  horizon_age: 95,
  cash_account_id: 'cash_reserves',
  jurisdiction_account_id: 'tax_california',
  scenario_name: 'Pre-retirement Baseline 2026',
  filing_status: 'mfj',
};

// ---------------------------------------------------------------------
// Events. Each is parameterized; the engine resolves params per attachment.
// ---------------------------------------------------------------------

export const seedEvents: TimelineEvent[] = [
  {
    id: 'evt_nua',
    name: 'NUA on company stock',
    description:
      'Liquidate company-stock 401(k) lot, pay ordinary tax on cost basis only, move appreciation to a new taxable holding at LTCG.',
    trigger_age: 64,
    kind: 'one_shot',
    attached_account_ids: ['fidelity_company_stock'],
    parameters: {},
    actions: [{ type: 'liquidate' }],
  },
  {
    id: 'evt_roth_ladder',
    name: 'Roth conversion ladder',
    description:
      'Convert $80k/yr from Traditional 401(k) holdings to Roth IRA, ages 65–72. Taxed as ordinary income each year.',
    trigger_age: 65,
    end_age: 72,
    kind: 'recurring',
    attached_account_ids: ['fidelity_index'],
    parameters: { amount: 80000 },
    actions: [
      { type: 'transfer', param_ref: 'amount', target_account: 'roth_vtsax' },
    ],
  },
  {
    id: 'evt_move_fl',
    name: 'Move to Florida',
    description: 'Establish FL residency — drop state income tax.',
    trigger_age: 70,
    kind: 'one_shot',
    attached_account_ids: [],
    parameters: {},
    actions: [{ type: 'reparent', new_parent: 'tax_florida' }],
  },
  {
    id: 'evt_house_sale',
    name: 'Downsize house',
    description:
      'Sell Palo Alto home, capture LTCG above $500k MFJ exclusion, deposit proceeds to cash.',
    trigger_age: 75,
    kind: 'one_shot',
    attached_account_ids: ['house'],
    parameters: {},
    actions: [{ type: 'liquidate' }],
  },
  {
    id: 'evt_market_dip',
    name: 'Market downturn',
    description: 'Hypothetical −25% shock on all equity holdings.',
    trigger_age: 72,
    kind: 'one_shot',
    attached_account_ids: [
      'schwab_msft',
      'schwab_vti',
      'fidelity_index',
      'roth_vtsax',
    ],
    parameters: { shock: -0.25 },
    actions: [{ type: 'add_value', field: 'start_value', param_ref: 'shock' }],
  },
];
