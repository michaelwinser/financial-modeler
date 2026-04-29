// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { project } from './engine';
import { seedAccounts, seedActor, seedEvents } from './seed';

// Smoke tests for the test infrastructure itself. Phase 2 replaces these
// with the full engine snapshot suite + the UC integration suite, both
// derived from docs/USE_CASES.md and the seed.

describe('engine smoke', () => {
  it('projects the seed without throwing', () => {
    const result = project(seedAccounts, seedActor, seedEvents);
    expect(result.length).toBe(seedActor.horizon_age - seedActor.current_age + 1);
    expect(result[0].age).toBe(seedActor.current_age);
    expect(result[result.length - 1].age).toBe(seedActor.horizon_age);
  });

  it('is deterministic for identical inputs', () => {
    const a = project(seedAccounts, seedActor, seedEvents);
    const b = project(seedAccounts, seedActor, seedEvents);
    expect(a[0].total_baseline).toBe(b[0].total_baseline);
    expect(a[10].total_baseline).toBe(b[10].total_baseline);
  });

  it('produces a non-trivial baseline trajectory', () => {
    const result = project(seedAccounts, seedActor, seedEvents);
    // Net worth at age 0 in the projection equals the seeded sum of
    // start_values minus year-0 cashflow effects; we assert only that
    // the number is sensible and finite.
    expect(Number.isFinite(result[0].total_baseline)).toBe(true);
    expect(result[0].total_baseline).toBeGreaterThan(0);
  });
});
