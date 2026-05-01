// @vitest-environment node
//
// Engine snapshot tests against the seed scenario.
//
// Convention: integer-rounded "digest" snapshot rather than the full
// projection. The digest captures the load-bearing fields per year while
// dodging floating-point flake. To intentionally update after a known
// engine change: `npm test -- -u`.
//
// Variant tests (no Roth ladder, no FL move) are scalar `toBeLessThan` /
// `toBeGreaterThan` assertions rather than snapshots, since their value
// is in showing relative behavior, not exact numbers. The full numbers
// come from the seed snapshot.

import { describe, expect, it } from 'vitest';
import { project } from './engine';
import { seedAccounts, seedHousehold, seedEvents } from './seed';
import type { YearlyProjection } from './types';

function digest(p: YearlyProjection[]) {
  return p.map((y) => ({
    age: y.age,
    baseline: Math.round(y.total_baseline),
    best: Math.round(y.total_best),
    worst: Math.round(y.total_worst),
    taxes_paid: Math.round(y.taxes_paid),
    tax_ordinary: Math.round(y.tax_ordinary),
    tax_ltcg: Math.round(y.tax_ltcg),
    income_received: Math.round(y.income_received),
    expenses_paid: Math.round(y.expenses_paid),
    event_liquidation_proceeds: Math.round(y.event_liquidation_proceeds),
    forced_sale_proceeds: Math.round(y.forced_sale_proceeds),
    embedded_gain: Math.round(y.embedded_gain),
    cumulative_inflation_index: Number(y.cumulative_inflation_index.toFixed(6)),
  }));
}

const sumTaxes = (p: YearlyProjection[]) => p.reduce((s, y) => s + y.taxes_paid, 0);

describe('engine: seed projection', () => {
  it('matches the integer-digest snapshot', () => {
    const result = project(seedAccounts, seedHousehold, seedEvents);
    expect(digest(result)).toMatchSnapshot();
  });

  it('produces identical projections across repeated runs (determinism)', () => {
    const a = project(seedAccounts, seedHousehold, seedEvents);
    const b = project(seedAccounts, seedHousehold, seedEvents);
    expect(digest(a)).toEqual(digest(b));
  });

  it('headline numbers stay in sane ranges', () => {
    const result = project(seedAccounts, seedHousehold, seedEvents);
    const start = result[0];
    const end = result[result.length - 1];
    expect(start.age).toBe(seedHousehold.actors[0].current_age);
    expect(end.age).toBe(seedHousehold.horizon_age);
    expect(start.cumulative_inflation_index).toBe(1);
    expect(end.cumulative_inflation_index).toBeGreaterThan(1);
    // The seed household starts with ~$5.9M; over a 33-year horizon
    // with the seeded plan, terminal baseline should be in the $5–15M
    // range. Tighter bounds live in the snapshot.
    expect(start.total_baseline).toBeGreaterThan(4_000_000);
    expect(start.total_baseline).toBeLessThan(8_000_000);
    expect(end.total_baseline).toBeGreaterThan(3_000_000);
    expect(end.total_baseline).toBeLessThan(20_000_000);
    // best > baseline > worst always.
    for (const y of result) {
      expect(y.total_best).toBeGreaterThanOrEqual(y.total_baseline);
      expect(y.total_baseline).toBeGreaterThanOrEqual(y.total_worst);
    }
  });
});

describe('engine: seed variants', () => {
  it('removing the FL move increases lifetime taxes (regression for the reparent fix)', () => {
    const withMove = project(seedAccounts, seedHousehold, seedEvents);
    const noMove = project(
      seedAccounts,
      seedHousehold,
      seedEvents.filter((e) => e.id !== 'evt_move_fl'),
    );
    expect(sumTaxes(noMove)).toBeGreaterThan(sumTaxes(withMove));
    // Year after the move (age 71): with-move tax should be lower
    // because the jurisdiction switch took effect.
    const ageIdx = (a: number) => a - seedHousehold.actors[0].current_age;
    expect(withMove[ageIdx(71)].taxes_paid).toBeLessThan(
      noMove[ageIdx(71)].taxes_paid,
    );
  });

  it('removing the Roth conversion ladder lowers in-conversion-year tax', () => {
    const withLadder = project(seedAccounts, seedHousehold, seedEvents);
    const noLadder = project(
      seedAccounts,
      seedHousehold,
      seedEvents.filter((e) => e.id !== 'evt_roth_ladder'),
    );
    // During the ladder window (ages 65-72), with-ladder should pay
    // more in-year tax than no-ladder. Pick a year inside the window.
    const ageIdx = (a: number) => a - seedHousehold.actors[0].current_age;
    expect(withLadder[ageIdx(67)].taxes_paid).toBeGreaterThan(
      noLadder[ageIdx(67)].taxes_paid,
    );
  });

  it('removing the market downturn raises terminal net worth', () => {
    const withDip = project(seedAccounts, seedHousehold, seedEvents);
    const noDip = project(
      seedAccounts,
      seedHousehold,
      seedEvents.filter((e) => e.id !== 'evt_market_dip'),
    );
    const lastWith = withDip[withDip.length - 1].total_baseline;
    const lastNo = noDip[noDip.length - 1].total_baseline;
    expect(lastNo).toBeGreaterThan(lastWith);
    // The shock is -25% on four equity holdings at age 72; effect is
    // significant, well over $500k difference at horizon.
    expect(lastNo - lastWith).toBeGreaterThan(500_000);
  });
});
