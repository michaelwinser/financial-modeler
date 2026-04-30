// Tests for the JSON export/import round-trip.
//
// USE_CASES.md UC29 asserts that exporting JSON and re-importing it
// preserves the model state. This file verifies the shape of the
// payload, the round-trip, and the defensive clamping that
// importScenarioJson applies.
//
// UC30 (localStorage round-trip across page refresh) is out of scope
// here — it requires simulating module unload/reload, which is a UC
// integration concern. The persist middleware itself is well-tested
// upstream by Zustand.

import { beforeEach, describe, expect, it } from 'vitest';
import { exportScenarioJson, importScenarioJson, useStore } from './store';

describe('exportScenarioJson / importScenarioJson', () => {
  beforeEach(() => {
    // Reset to a known starting state for each test. resetToSeed pulls
    // the demo data and clears caches.
    useStore.getState().resetToSeed();
  });

  it('produces a JSON string containing schemaVersion, exportedAt, and the three arrays/objects', () => {
    const json = exportScenarioJson();
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe('string');
    expect(new Date(parsed.exportedAt).getTime()).toBeGreaterThan(0);
    expect(Array.isArray(parsed.accounts)).toBe(true);
    expect(parsed.accounts.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.events)).toBe(true);
    expect(typeof parsed.actor).toBe('object');
  });

  it('round-trips: export → mutate → import restores original state', () => {
    // Capture original (deep-clone so later mutation doesn't poison).
    const before = useStore.getState();
    const original = {
      accounts: structuredClone(before.accounts),
      actor: structuredClone(before.actor),
      events: structuredClone(before.events),
    };
    const json = exportScenarioJson();

    // Mutate to a different state.
    useStore.getState().newBlankScenario();
    expect(useStore.getState().accounts.length).toBeLessThan(original.accounts.length);
    expect(useStore.getState().events.length).toBe(0);

    // Import the captured payload.
    const result = importScenarioJson(json);
    expect(result.ok).toBe(true);

    // State should match the originals.
    const after = useStore.getState();
    expect(after.accounts).toEqual(original.accounts);
    expect(after.actor).toEqual(original.actor);
    expect(after.events).toEqual(original.events);
  });

  it('rejects non-JSON input', () => {
    const result = importScenarioJson('not json {{{');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not valid JSON/i);
  });

  it('rejects a payload with no accounts array', () => {
    const result = importScenarioJson('{"actor":{},"events":[]}');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/accounts/);
  });

  it('rejects a payload with no events array', () => {
    const result = importScenarioJson('{"accounts":[],"actor":{}}');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/events/);
  });

  it('rejects a payload with no actor', () => {
    const result = importScenarioJson('{"accounts":[],"events":[]}');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/actor/);
  });

  it('rejects a payload with a schemaVersion newer than this app supports', () => {
    const result = importScenarioJson(
      JSON.stringify({
        schemaVersion: 999,
        accounts: [],
        actor: { current_age: 60, horizon_age: 95, cash_account_id: 'x', jurisdiction_account_id: 'y', scenario_name: 't' },
        events: [],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/schema version/i);
  });

  it('clamps account and actor fields on import (defense in depth)', () => {
    const payload = {
      schemaVersion: 1,
      accounts: [
        {
          id: 'evil',
          name: 'evil income',
          kind: 'income',
          parent_id: null,
          start_age: -50,         // out of range
          end_age: 999,           // out of range
          annual_amount: -1000,   // negative
        },
      ],
      actor: {
        current_age: 1000,        // out of range
        horizon_age: 0,           // less than current_age
        cash_account_id: 'evil',
        jurisdiction_account_id: 'evil',
        scenario_name: 'evil',
      },
      events: [],
    };
    const result = importScenarioJson(JSON.stringify(payload));
    expect(result.ok).toBe(true);

    const acc = useStore.getState().accounts.find((a) => a.id === 'evil');
    expect(acc).toBeDefined();
    expect(acc!.start_age).toBeGreaterThanOrEqual(0);
    expect(acc!.start_age).toBeLessThanOrEqual(130);
    expect(acc!.end_age).toBeLessThanOrEqual(130);
    // end_age must not precede start_age post-clamp.
    expect(acc!.end_age!).toBeGreaterThanOrEqual(acc!.start_age!);
    expect(acc!.annual_amount).toBeGreaterThanOrEqual(0);

    const a = useStore.getState().actor;
    expect(a.current_age).toBeLessThanOrEqual(130);
    expect(a.horizon_age).toBeGreaterThan(a.current_age);
  });

  it('import resets selection and hover (ephemeral fields are cleared)', () => {
    // Simulate user selection prior to import.
    useStore.setState({
      selection: { kind: 'account', id: 'fidelity_index' },
      hoveredEventId: 'evt_roth_ladder',
    });
    expect(useStore.getState().selection.kind).toBe('account');

    const json = exportScenarioJson();
    const result = importScenarioJson(json);
    expect(result.ok).toBe(true);

    expect(useStore.getState().selection).toEqual({ kind: 'none' });
    expect(useStore.getState().hoveredEventId).toBeNull();
  });
});
