// Tax-related derivations and helpers.
//
// This module is the source of truth for:
//   - account_type → derived tax_treatment / subject_to_rmd
//   - bracket-walking math (when bracket tables are present)
//
// Phase 3.0 introduces account_type and bracket tables. The engine still
// reads the existing tax_treatment field (now derived); bracket math is
// behind a feature flag (presence of brackets on the active jurisdiction)
// so scenarios without populated tables fall back to the legacy
// effective_tax_rate × amount path.

import type {
  AccountNode,
  AccountType,
  BracketTable,
  FilingStatus,
  IrmaaTier,
  TaxTreatment,
} from './types';

// Re-export the data types for callers who only want this file.
export type { Bracket, BracketTable, IrmaaTier } from './types';

// ---------- Account-type derivations ---------------------------------------

const TAX_TREATMENT_BY_TYPE: Record<AccountType, TaxTreatment> = {
  taxable_brokerage: 'taxable',
  traditional_401k: 'tax_deferred',
  roth_account: 'tax_free',
  municipal_bond: 'taxable',
  cash: 'taxable',
  // Pensions are flows, not balances — kind='income' in our schema.
  // The mapping is here for completeness; engine code that asks for a
  // pension-account's tax_treatment shouldn't expect a meaningful answer.
  pension: 'taxable',
  primary_residence: 'taxable',
  investment_property: 'taxable',
};

const SUBJECT_TO_RMD_BY_TYPE: Record<AccountType, boolean> = {
  taxable_brokerage: false,
  traditional_401k: true,
  // SECURE 2.0 (effective 2024) eliminated lifetime RMDs for Roth 401(k).
  // Roth IRAs were already exempt. So roth_account is no-RMD across the board.
  roth_account: false,
  municipal_bond: false,
  cash: false,
  pension: false,
  primary_residence: false,
  investment_property: false,
};

// Resolve an account's effective tax_treatment. Explicit override wins;
// otherwise derived from account_type; otherwise undefined (engine treats
// undefined as 'taxable' for asset accounts — see DESIGN_NOTES gotchas).
export function resolveTaxTreatment(node: AccountNode): TaxTreatment | undefined {
  if (node.tax_treatment !== undefined) return node.tax_treatment;
  if (node.account_type !== undefined) return TAX_TREATMENT_BY_TYPE[node.account_type];
  return undefined;
}

// Resolve whether an account is subject to RMDs. Explicit override wins;
// otherwise derived from account_type.
export function resolveSubjectToRmd(node: AccountNode): boolean {
  if (node.subject_to_rmd !== undefined) return node.subject_to_rmd;
  if (node.account_type !== undefined) return SUBJECT_TO_RMD_BY_TYPE[node.account_type];
  return false;
}

// True iff the account's interest/income is exempt from federal taxation
// (today: only municipal_bond). State taxation may still apply; the engine
// checks state-level when computing state tax.
export function isFederallyTaxExempt(node: AccountNode): boolean {
  return node.account_type === 'municipal_bond';
}

// True iff the account qualifies for the $500k MFJ / $250k single
// home-sale exclusion on capital gains.
export function qualifiesForHomeSaleExclusion(node: AccountNode): boolean {
  return node.account_type === 'primary_residence';
}

// ---------- Bracket math ----------------------------------------------------
//
// A tax bracket schedule is an ordered list of breakpoints. Each bracket has
// a `from` (inclusive lower bound of taxable income for that rate) and a
// `rate` applied to income within that bracket. The last bracket extends to
// infinity. Example for federal-2025 single:
//
//   [{ from: 0,      rate: 0.10 },
//    { from: 11_925, rate: 0.12 },
//    { from: 48_475, rate: 0.22 },
//    ...]
//
// Brackets are stored as fields on jurisdiction ambient accounts and selected
// by filing_status when the engine computes tax. The bracket-walking
// computeTax() returns total tax owed on the given taxable amount.

// Apply a bracket schedule to a taxable amount. Standard progressive math:
// each dollar in bracket k pays bracket k's rate.
export function computeTax(taxable: number, brackets: BracketTable): number {
  if (taxable <= 0 || brackets.length === 0) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lower = brackets[i].from;
    const upper = i + 1 < brackets.length ? brackets[i + 1].from : Infinity;
    if (taxable <= lower) break;
    const slice = Math.min(taxable, upper) - lower;
    tax += slice * brackets[i].rate;
  }
  return tax;
}

// Marginal rate at a given taxable amount (rate of the bracket containing
// the next dollar). Useful for "how much room to the next bracket" UI.
export function marginalRate(taxable: number, brackets: BracketTable): number {
  if (brackets.length === 0) return 0;
  for (let i = 0; i < brackets.length; i++) {
    const upper = i + 1 < brackets.length ? brackets[i + 1].from : Infinity;
    if (taxable < upper) return brackets[i].rate;
  }
  return brackets[brackets.length - 1].rate;
}

// Distance to the next bracket boundary (for the bracket-placement view in
// Phase 4). Returns Infinity if already in the top bracket.
export function dollarsToNextBracket(taxable: number, brackets: BracketTable): number {
  if (brackets.length === 0) return Infinity;
  for (let i = 0; i < brackets.length; i++) {
    const upper = i + 1 < brackets.length ? brackets[i + 1].from : Infinity;
    if (taxable < upper) return upper === Infinity ? Infinity : upper - taxable;
  }
  return Infinity;
}

// ---------- IRMAA tiers ----------------------------------------------------
//
// Income-Related Monthly Adjustment Amount: Medicare Part B & D premium
// surcharges based on MAGI. Single threshold table per filing status, on
// the federal ambient. A tier is { from: MAGI threshold, surcharge: $/yr }.
// Engine adds the surcharge for the tier the actor's MAGI falls into.

export function computeIrmaaSurcharge(magi: number, tiers: IrmaaTier[]): number {
  if (magi <= 0 || tiers.length === 0) return 0;
  let surcharge = 0;
  for (const tier of tiers) {
    if (magi >= tier.from) surcharge = tier.surcharge_annual;
  }
  return surcharge;
}

// Convenience: a "tax context" the engine can pass around when computing
// per-year taxes. Bundles the active jurisdiction's tables and the actor's
// filing status so call sites don't all duplicate the lookup.
export interface TaxContext {
  filingStatus: FilingStatus;
  federalOrdinary: BracketTable;
  federalLtcg: BracketTable;
  stateOrdinary: BracketTable;
  stateLtcg: BracketTable; // many states tax LTCG as ordinary; mirror federal_ordinary if so
  irmaaTiers: IrmaaTier[];
}
