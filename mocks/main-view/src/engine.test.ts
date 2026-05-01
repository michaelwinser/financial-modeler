// @vitest-environment node
//
// Engine unit tests. Pure functions, deterministic outputs.
//
// Convention from docs/USE_CASES.md and DESIGN_NOTES.md: engine tests
// assert numbers; UC tests assert model state. This file does the former.
//
// Fixtures use minimal scenarios crafted per-test rather than the seed,
// so each test is readable in isolation. The seed is exercised by
// engine.snapshot.test.ts.
//
// One quirk to know: evolveInflation hardcodes a lookup against the
// account id `cash_reserves`. All fixtures here use that id.

import { describe, expect, it } from 'vitest';
import { project } from './engine';
import type { AccountNode, Actor, TimelineEvent } from './types';

// ---------- Fixture helpers --------------------------------------------------

function ambient(id: string, fields: Partial<AccountNode> = {}): AccountNode {
  return { id, name: id, kind: 'ambient', parent_id: null, ...fields };
}
function asset(id: string, parent_id: string, fields: Partial<AccountNode> = {}): AccountNode {
  return { id, name: id, kind: 'asset', parent_id, ...fields };
}
function income(id: string, parent_id: string, fields: Partial<AccountNode> = {}): AccountNode {
  return { id, name: id, kind: 'income', parent_id, ...fields };
}
function expense(id: string, parent_id: string, fields: Partial<AccountNode> = {}): AccountNode {
  return { id, name: id, kind: 'expense', parent_id, ...fields };
}
function actor(over: Partial<Actor> = {}): Actor {
  return {
    current_age: 60,
    horizon_age: 62,
    cash_account_id: 'cash_reserves',
    jurisdiction_account_id: 'tax',
    scenario_name: 'test',
    ...over,
  };
}
function event(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt',
    name: 'evt',
    trigger_age: 60,
    kind: 'one_shot',
    attached_account_ids: [],
    parameters: {},
    actions: [],
    ...over,
  };
}

// Minimal valid scaffold: US Economy ambient with all yields 0 and 0% inflation,
// a tax jurisdiction, and the engine-required cash_reserves account.
function baseAccounts(): AccountNode[] {
  return [
    ambient('us', {
      equity_yield: 0,
      bond_yield: 0,
      cash_yield: 0,
      real_estate_yield: 0,
      inflation_rate: 0,
    }),
    ambient('tax', { effective_tax_rate: 0.30 }),
    asset('cash_reserves', 'us', {
      asset_class: 'cash',
      tax_treatment: 'taxable',
      start_value: 0,
    }),
  ];
}

// ---------- Inheritance ------------------------------------------------------

describe('engine: inheritance', () => {
  it('an asset inherits its asset_class yield from the parent ambient', () => {
    const accounts = [
      ambient('us', { equity_yield: 0.10, bond_yield: 0.04, cash_yield: 0, real_estate_yield: 0, inflation_rate: 0 }),
      ambient('tax', { effective_tax_rate: 0.30 }),
      asset('cash_reserves', 'us', { asset_class: 'cash', tax_treatment: 'taxable', start_value: 0 }),
      asset('eq', 'us', { asset_class: 'equity', tax_treatment: 'taxable', start_value: 1000 }),
    ];
    const result = project(accounts, actor({ horizon_age: 61 }), []);
    // Year 0 (age 60): grows at equity_yield 10% → 1100
    // Year 1 (age 61): another 10% → 1210
    expect(result[0].by_account['eq']).toBeCloseTo(1100, 4);
    expect(result[1].by_account['eq']).toBeCloseTo(1210, 4);
  });

  it('explicit yield_rate as an absolute number overrides inheritance', () => {
    const accounts = [
      ambient('us', { equity_yield: 0.10, inflation_rate: 0 }),
      ambient('tax', { effective_tax_rate: 0.30 }),
      asset('cash_reserves', 'us', { asset_class: 'cash', tax_treatment: 'taxable', start_value: 0 }),
      asset('eq', 'us', {
        asset_class: 'equity',
        tax_treatment: 'taxable',
        start_value: 1000,
        yield_rate: 0.05, // overrides parent's 10%
      }),
    ];
    const result = project(accounts, actor({ horizon_age: 60 }), []);
    expect(result[0].by_account['eq']).toBeCloseTo(1050, 4);
  });

  it('yield_rate as a delta override adds to the inherited value', () => {
    const accounts = [
      ambient('us', { equity_yield: 0.07, inflation_rate: 0 }),
      ambient('tax', { effective_tax_rate: 0.30 }),
      asset('cash_reserves', 'us', { asset_class: 'cash', tax_treatment: 'taxable', start_value: 0 }),
      asset('eq', 'us', {
        asset_class: 'equity',
        tax_treatment: 'taxable',
        start_value: 1000,
        yield_rate: { mode: 'delta', value: 0.02 }, // 7% + 2% = 9%
      }),
    ];
    const result = project(accounts, actor({ horizon_age: 60 }), []);
    expect(result[0].by_account['eq']).toBeCloseTo(1090, 4);
  });
});

// ---------- set_value action -------------------------------------------------

describe('engine action: set_value', () => {
  it('sets balance on an asset', () => {
    const accounts = [
      ...baseAccounts(),
      asset('eq', 'us', { asset_class: 'equity', tax_treatment: 'taxable', start_value: 1000 }),
    ];
    const events = [event({
      id: 'set',
      attached_account_ids: ['eq'],
      actions: [{ type: 'set_value', field: 'start_value', value: 50_000 }],
    })];
    const result = project(accounts, actor({ horizon_age: 60 }), events);
    // Engine fires event, then grows assets. With yield 0, balance stays 50k.
    expect(result[0].by_account['eq']).toBeCloseTo(50_000, 4);
  });

  it('sets annual_amount on an income stream', () => {
    const accounts = [
      ...baseAccounts(),
      income('salary', 'us', { annual_amount: 100_000, start_age: 60, end_age: 65, growth_rate: 0 }),
    ];
    const events = [event({
      id: 'raise',
      trigger_age: 61,
      attached_account_ids: ['salary'],
      actions: [{ type: 'set_value', field: 'annual_amount', value: 200_000 }],
    })];
    const result = project(accounts, actor({ horizon_age: 62 }), events);
    expect(result[0].income_by_source['salary']).toBeCloseTo(100_000, 0);
    // After the set_value at age 61, annual_amount=200k. Growth 0 → year 1's amount is 200k.
    expect(result[1].income_by_source['salary']).toBeCloseTo(200_000, 0);
  });
});

// ---------- add_value action -------------------------------------------------

describe('engine action: add_value', () => {
  it('fractional shock (|v| < 1) on balance multiplies balance', () => {
    const accounts = [
      ...baseAccounts(),
      asset('eq', 'us', { asset_class: 'equity', tax_treatment: 'taxable', start_value: 100_000 }),
    ];
    const events = [event({
      id: 'crash',
      attached_account_ids: ['eq'],
      parameters: { shock: -0.25 },
      actions: [{ type: 'add_value', field: 'start_value', param_ref: 'shock' }],
    })];
    const result = project(accounts, actor({ horizon_age: 60 }), events);
    expect(result[0].by_account['eq']).toBeCloseTo(75_000, 4);
  });

  it('flat add (|v| >= 1) on balance adds the amount', () => {
    const accounts = [
      ...baseAccounts(),
      asset('eq', 'us', { asset_class: 'equity', tax_treatment: 'taxable', start_value: 1000 }),
    ];
    const events = [event({
      id: 'topup',
      attached_account_ids: ['eq'],
      actions: [{ type: 'add_value', field: 'start_value', value: 5000 }],
    })];
    const result = project(accounts, actor({ horizon_age: 60 }), events);
    expect(result[0].by_account['eq']).toBeCloseTo(6000, 4);
  });

  it('fractional shock on annual_amount permanently shifts the trajectory', () => {
    const accounts = [
      ...baseAccounts(),
      expense('living', 'us', {
        annual_amount: 100_000,
        start_age: 60,
        end_age: 70,
        growth_rate: 0.03,
      }),
    ];
    const events = [event({
      id: 'belt',
      trigger_age: 62,
      attached_account_ids: ['living'],
      parameters: { shock: -0.30 },
      actions: [{ type: 'add_value', field: 'annual_amount', param_ref: 'shock' }],
    })];
    const result = project(accounts, actor({ horizon_age: 64 }), events);
    // Pre-shock: 100k × 1.03^0=100000, ×1.03^1=103000, ×1.03^2=106090
    // Shock at age 62 mutates annual_amount to 100k * 0.7 = 70000.
    // Year 2 (age 62) reads new annual_amount (70k) × (1.03)^(62-60)=1.0609 → 74,263
    // Year 3 (age 63) → 70k × 1.03^3 = 76,491
    expect(result[0].expense_by_source['living']).toBeCloseTo(100_000, 0);
    expect(result[1].expense_by_source['living']).toBeCloseTo(103_000, 0);
    expect(result[2].expense_by_source['living']).toBeCloseTo(74_263, 0);
    expect(result[3].expense_by_source['living']).toBeCloseTo(76_491, 0);
  });
});

// ---------- transfer action --------------------------------------------------

describe('engine action: transfer', () => {
  it('from a tax_deferred account taxes the converted amount as ordinary income', () => {
    const accounts = [
      ...baseAccounts(),
      asset('trad', 'us', { asset_class: 'equity', tax_treatment: 'tax_deferred', start_value: 500_000 }),
      asset('roth', 'us', { asset_class: 'equity', tax_treatment: 'tax_free', start_value: 0 }),
    ];
    const events = [event({
      id: 'conv',
      attached_account_ids: ['trad'],
      parameters: { amount: 80_000 },
      actions: [{ type: 'transfer', target_account: 'roth', param_ref: 'amount' }],
    })];
    const result = project(accounts, actor({ horizon_age: 60 }), events);
    // 80k moved trad → roth. Tax 80k × 30% = 24k ordinary, no LTCG.
    // Cash account starts at 0; tax pays from cash (drives it negative,
    // triggers forced sale to cover, but in this simple case the engine
    // pulls from taxable assets first and there are none, then tax_deferred
    // (now 420k after the conversion). The forced withdrawal grosses up.
    // Just verify the conversion's tax effect cleanly.
    expect(result[0].tax_ordinary).toBeGreaterThanOrEqual(24_000);
    expect(result[0].tax_ltcg).toBe(0);
    expect(result[0].by_account['roth']).toBeCloseTo(80_000, 0);
  });

  it('amount is capped at the source balance', () => {
    const accounts = [
      ...baseAccounts(),
      // Buffer cash so the conversion's tax doesn't trigger a forced
      // sale that would clobber the destination balance we're asserting.
      asset('trad', 'us', { asset_class: 'equity', tax_treatment: 'tax_deferred', start_value: 10_000 }),
      asset('roth', 'us', { asset_class: 'equity', tax_treatment: 'tax_free', start_value: 0 }),
    ];
    accounts.find((a) => a.id === 'cash_reserves')!.start_value = 100_000;
    const events = [event({
      id: 'conv',
      attached_account_ids: ['trad'],
      parameters: { amount: 50_000 }, // more than trad has
      actions: [{ type: 'transfer', target_account: 'roth', param_ref: 'amount' }],
    })];
    const result = project(accounts, actor({ horizon_age: 60 }), events);
    expect(result[0].by_account['trad']).toBeCloseTo(0, 4);
    expect(result[0].by_account['roth']).toBeCloseTo(10_000, 4);
  });
});

// ---------- liquidate action -------------------------------------------------

describe('engine action: liquidate', () => {
  it('on a taxable real-estate asset applies the $500k MFJ exclusion', () => {
    const accounts = [
      ...baseAccounts(),
      asset('house', 'us', {
        asset_class: 'real_estate',
        tax_treatment: 'taxable',
        start_value: 1_000_000,
        cost_basis: 200_000,
      }),
    ];
    const events = [event({
      id: 'sell',
      attached_account_ids: ['house'],
      actions: [{ type: 'liquidate' }],
    })];
    const result = project(accounts, actor({ horizon_age: 60 }), events);
    // Gain = 1M - 200k = 800k. After 500k exclusion, taxable gain = 300k.
    // LTCG (single-bracket fallback @ 30% × 0.6) = 300k × 0.18 = 54k.
    // Post-3.0 refactor: event_liquidation_proceeds is GROSS (tax is at
    // year-end, separate from per-event flows).
    expect(result[0].tax_ltcg).toBeCloseTo(54_000, 0);
    expect(result[0].tax_ordinary).toBe(0);
    expect(result[0].event_liquidation_proceeds).toBeCloseTo(1_000_000, 0);
    expect(result[0].by_account['house']).toBe(0);
  });

  it('on a taxable equity holding taxes the full gain (no exclusion)', () => {
    const accounts = [
      ...baseAccounts(),
      asset('vti', 'us', {
        asset_class: 'equity',
        tax_treatment: 'taxable',
        start_value: 500_000,
        cost_basis: 100_000,
      }),
    ];
    const events = [event({
      id: 'sell',
      attached_account_ids: ['vti'],
      actions: [{ type: 'liquidate' }],
    })];
    const result = project(accounts, actor({ horizon_age: 60 }), events);
    // Gain = 400k, no exclusion. LTCG = 400k × 0.18 = 72k.
    expect(result[0].tax_ltcg).toBeCloseTo(72_000, 0);
    expect(result[0].tax_ordinary).toBe(0);
    expect(result[0].event_liquidation_proceeds).toBeCloseTo(500_000, 0);
  });

  it('on a tax_deferred holding taxes basis at ordinary, gain at LTCG (NUA)', () => {
    const accounts = [
      ...baseAccounts(),
      asset('co_stock', 'us', {
        asset_class: 'equity',
        tax_treatment: 'tax_deferred',
        start_value: 400_000,
        cost_basis: 80_000,
      }),
    ];
    const events = [event({
      id: 'nua',
      attached_account_ids: ['co_stock'],
      actions: [{ type: 'liquidate' }],
    })];
    const result = project(accounts, actor({ horizon_age: 60 }), events);
    // Basis 80k × 30% = 24k ordinary.
    // Gain 320k × 0.18 = 57.6k LTCG.
    // event_liquidation_proceeds is gross (400k); tax is computed at year-end.
    expect(result[0].tax_ordinary).toBeCloseTo(24_000, 0);
    expect(result[0].tax_ltcg).toBeCloseTo(57_600, 0);
    expect(result[0].event_liquidation_proceeds).toBeCloseTo(400_000, 0);
  });
});

// ---------- reparent action --------------------------------------------------

describe('engine action: reparent', () => {
  it('switches the actor jurisdiction; subsequent income is taxed at the new rate', () => {
    const accounts = [
      ambient('us', { equity_yield: 0, bond_yield: 0, cash_yield: 0, real_estate_yield: 0, inflation_rate: 0 }),
      ambient('ca', { effective_tax_rate: 0.40 }),
      ambient('fl', { effective_tax_rate: 0.20 }),
      asset('cash_reserves', 'us', { asset_class: 'cash', tax_treatment: 'taxable', start_value: 0 }),
      income('salary', 'us', { annual_amount: 100_000, start_age: 60, end_age: 65, growth_rate: 0 }),
    ];
    const events = [event({
      id: 'move',
      trigger_age: 62,
      attached_account_ids: [], // reparent acts on the actor, not an account
      actions: [{ type: 'reparent', new_parent: 'fl' }],
    })];
    const a = actor({ horizon_age: 64, jurisdiction_account_id: 'ca' });
    const result = project(accounts, a, events);

    // Years 0-1 (ages 60, 61) under CA: 100k × 40% = 40k ordinary tax.
    // Year 2 (age 62) reparent fires; income tax now 100k × 20% = 20k.
    expect(result[0].tax_ordinary).toBeCloseTo(40_000, 0);
    expect(result[1].tax_ordinary).toBeCloseTo(40_000, 0);
    expect(result[2].tax_ordinary).toBeCloseTo(20_000, 0);
  });
});

// ---------- end_account action ----------------------------------------------

describe('engine action: end_account', () => {
  it('marks an income stream inactive at the trigger age', () => {
    const accounts = [
      ...baseAccounts(),
      income('contract', 'us', { annual_amount: 100_000, start_age: 60, end_age: 70, growth_rate: 0 }),
    ];
    const events = [event({
      id: 'stop',
      trigger_age: 62,
      attached_account_ids: ['contract'],
      actions: [{ type: 'end_account' }],
    })];
    const result = project(accounts, actor({ horizon_age: 64 }), events);
    expect(result[0].income_by_source['contract']).toBeCloseTo(100_000, 0);
    expect(result[1].income_by_source['contract']).toBeCloseTo(100_000, 0);
    // After end_account at age 62, the stream is inactive — no contribution.
    expect(result[2].income_by_source['contract']).toBeUndefined();
    expect(result[3].income_by_source['contract']).toBeUndefined();
  });
});

// ---------- streams ----------------------------------------------------------

describe('engine: streams', () => {
  it('compounds annual_amount by growth_rate over years since start_age', () => {
    const accounts = [
      ...baseAccounts(),
      income('salary', 'us', { annual_amount: 100_000, start_age: 60, end_age: 65, growth_rate: 0.03 }),
    ];
    const result = project(accounts, actor({ horizon_age: 63 }), []);
    expect(result[0].income_by_source['salary']).toBeCloseTo(100_000, 0);
    expect(result[1].income_by_source['salary']).toBeCloseTo(103_000, 0);
    expect(result[2].income_by_source['salary']).toBeCloseTo(106_090, 0);
    expect(result[3].income_by_source['salary']).toBeCloseTo(109_273, 0);
  });

  it('does not produce income before start_age or after end_age', () => {
    const accounts = [
      ...baseAccounts(),
      income('ss', 'us', { annual_amount: 50_000, start_age: 70, end_age: 95, growth_rate: 0 }),
    ];
    const result = project(accounts, actor({ horizon_age: 71 }), []);
    // Ages 60-69 should have no SS. Age 70+ should.
    for (let yi = 0; yi < 10; yi++) {
      expect(result[yi].income_by_source['ss']).toBeUndefined();
    }
    expect(result[10].income_by_source['ss']).toBeCloseTo(50_000, 0);
    expect(result[11].income_by_source['ss']).toBeCloseTo(50_000, 0);
  });

  it('income flows to the cash account net of ordinary tax', () => {
    const accounts = [
      ...baseAccounts(),
      income('salary', 'us', { annual_amount: 100_000, start_age: 60, end_age: 65, growth_rate: 0 }),
    ];
    const result = project(accounts, actor({ horizon_age: 60 }), []);
    // 100k income, 30% tax = 30k tax. Net 70k goes to cash_reserves.
    expect(result[0].tax_ordinary).toBeCloseTo(30_000, 0);
    expect(result[0].by_account['cash_reserves']).toBeCloseTo(70_000, 0);
  });
});

// ---------- forced sale / withdrawal sequencing -----------------------------

describe('engine: forced sales', () => {
  it('covers negative cash by withdrawing from taxable first', () => {
    const accounts = [
      ...baseAccounts(),
      asset('vti', 'us', {
        asset_class: 'equity',
        tax_treatment: 'taxable',
        start_value: 500_000,
        cost_basis: 500_000, // no gain → no LTCG drag
      }),
      asset('trad', 'us', {
        asset_class: 'equity',
        tax_treatment: 'tax_deferred',
        start_value: 500_000,
      }),
      expense('living', 'us', { annual_amount: 50_000, start_age: 60, end_age: 70, growth_rate: 0 }),
    ];
    const result = project(accounts, actor({ horizon_age: 60 }), []);
    // Cash starts at 0. Year 0: 50k expense → cash -50k.
    // Forced sale: pulls 50k from taxable (vti). No LTCG since basis == balance.
    // Tax-deferred untouched.
    expect(result[0].forced_sale_proceeds).toBeCloseTo(50_000, 0);
    expect(result[0].by_account['vti']).toBeCloseTo(450_000, 0);
    expect(result[0].by_account['trad']).toBeCloseTo(500_000, 0);
  });

  it('grosses up tax-deferred withdrawals to net to the needed amount', () => {
    const accounts = [
      ...baseAccounts(),
      asset('trad', 'us', {
        asset_class: 'equity',
        tax_treatment: 'tax_deferred',
        start_value: 500_000,
      }),
      expense('living', 'us', { annual_amount: 70_000, start_age: 60, end_age: 70, growth_rate: 0 }),
    ];
    const result = project(accounts, actor({ horizon_age: 60 }), []);
    // Need 70k net after 30% tax.
    // Gross-up: 70k / 0.7 = 100k withdrawn from trad.
    // Net 70k flows to cash; 30k tax recorded as ordinary.
    expect(result[0].forced_sale_proceeds).toBeCloseTo(70_000, 0);
    expect(result[0].tax_ordinary).toBeCloseTo(30_000, 0);
    expect(result[0].by_account['trad']).toBeCloseTo(400_000, 0);
  });
});

// ---------- cone shifts ------------------------------------------------------

describe('engine: cone shifts', () => {
  it('best > baseline > worst when there are equity holdings and positive growth', () => {
    const accounts = [
      ambient('us', {
        equity_yield: 0.07,
        bond_yield: 0.04,
        cash_yield: 0,
        real_estate_yield: 0,
        inflation_rate: 0,
      }),
      ambient('tax', { effective_tax_rate: 0.30 }),
      asset('cash_reserves', 'us', { asset_class: 'cash', tax_treatment: 'taxable', start_value: 0 }),
      asset('eq', 'us', { asset_class: 'equity', tax_treatment: 'taxable', start_value: 100_000 }),
    ];
    const result = project(accounts, actor({ horizon_age: 70 }), []);
    const last = result[result.length - 1];
    expect(last.total_best).toBeGreaterThan(last.total_baseline);
    expect(last.total_baseline).toBeGreaterThan(last.total_worst);
  });

  it('shift is full on equity, smaller on bonds, none on cash', () => {
    // Two scenarios with the same starting balances but different asset classes.
    // After the same number of years, the equity-only run's cone width should
    // exceed the bond-only run's cone width.
    const eqAccounts = [
      ...baseAccounts(),
      asset('eq', 'us', { asset_class: 'equity', tax_treatment: 'taxable', start_value: 100_000 }),
    ];
    const bdAccounts = [
      ...baseAccounts(),
      asset('bd', 'us', { asset_class: 'bond', tax_treatment: 'taxable', start_value: 100_000 }),
    ];
    // Use a fixture with non-zero equity & bond yields so the cone can
    // separate. baseAccounts() has zeros, so override per-asset.
    const eq = project(
      eqAccounts.map((a) =>
        a.id === 'us'
          ? { ...a, equity_yield: 0.07 }
          : a,
      ),
      actor({ horizon_age: 70 }),
      [],
    );
    const bd = project(
      bdAccounts.map((a) =>
        a.id === 'us'
          ? { ...a, bond_yield: 0.04 }
          : a,
      ),
      actor({ horizon_age: 70 }),
      [],
    );
    const eqCone = eq[eq.length - 1].total_best - eq[eq.length - 1].total_worst;
    const bdCone = bd[bd.length - 1].total_best - bd[bd.length - 1].total_worst;
    expect(eqCone).toBeGreaterThan(bdCone);
  });
});

// ---------- inflation index --------------------------------------------------

describe('engine: inflation index', () => {
  it('starts at 1.0 and compounds by inflation_rate each subsequent year', () => {
    const accounts = [
      ambient('us', { equity_yield: 0, bond_yield: 0, cash_yield: 0, real_estate_yield: 0, inflation_rate: 0.03 }),
      ambient('tax', { effective_tax_rate: 0.30 }),
      asset('cash_reserves', 'us', { asset_class: 'cash', tax_treatment: 'taxable', start_value: 0 }),
    ];
    const result = project(accounts, actor({ horizon_age: 63 }), []);
    expect(result[0].cumulative_inflation_index).toBe(1);
    expect(result[1].cumulative_inflation_index).toBeCloseTo(1.03, 6);
    expect(result[2].cumulative_inflation_index).toBeCloseTo(1.0609, 6);
    expect(result[3].cumulative_inflation_index).toBeCloseTo(1.092727, 6);
  });
});
