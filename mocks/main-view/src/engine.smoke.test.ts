// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { project } from './engine';
import { seedAccounts, seedHousehold, seedEvents } from './seed';
import { primaryActor } from './household';

// Smoke tests for the test infrastructure itself. Phase 2 replaces these
// with the full engine snapshot suite + the UC integration suite, both
// derived from docs/USE_CASES.md and the seed.

describe('engine smoke', () => {
  it('projects the seed without throwing', () => {
    const result = project(seedAccounts, seedHousehold, seedEvents);
    const primary = primaryActor(seedHousehold);
    expect(result.length).toBe(seedHousehold.horizon_age - primary.current_age + 1);
    expect(result[0].age).toBe(primary.current_age);
    expect(result[result.length - 1].age).toBe(seedHousehold.horizon_age);
  });

  it('is deterministic for identical inputs', () => {
    const a = project(seedAccounts, seedHousehold, seedEvents);
    const b = project(seedAccounts, seedHousehold, seedEvents);
    expect(a[0].total_baseline).toBe(b[0].total_baseline);
    expect(a[10].total_baseline).toBe(b[10].total_baseline);
  });

  it('produces a non-trivial baseline trajectory', () => {
    const result = project(seedAccounts, seedHousehold, seedEvents);
    expect(Number.isFinite(result[0].total_baseline)).toBe(true);
    expect(result[0].total_baseline).toBeGreaterThan(0);
  });
});
