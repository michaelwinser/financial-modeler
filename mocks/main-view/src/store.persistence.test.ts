// Tests for the JSON export/import round-trip.
//
// USE_CASES.md UC29 asserts that exporting JSON and re-importing it
// preserves the model state. This file verifies the shape of the
// payload, the round-trip, the v1→v2 migration on import, and the
// defensive clamping that importScenarioJson applies.

import { beforeEach, describe, expect, it } from 'vitest';
import { exportScenarioJson, importScenarioJson, useStore } from './store';

describe('exportScenarioJson / importScenarioJson', () => {
  beforeEach(() => {
    useStore.getState().resetToSeed();
  });

  it('produces a JSON string containing schemaVersion 2 and the household + arrays', () => {
    const json = exportScenarioJson();
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(2);
    expect(typeof parsed.exportedAt).toBe('string');
    expect(new Date(parsed.exportedAt).getTime()).toBeGreaterThan(0);
    expect(Array.isArray(parsed.accounts)).toBe(true);
    expect(parsed.accounts.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.events)).toBe(true);
    expect(typeof parsed.household).toBe('object');
    expect(Array.isArray(parsed.household.actors)).toBe(true);
    expect(parsed.household.actors.length).toBeGreaterThanOrEqual(1);
  });

  it('round-trips: export → mutate → import restores original state', () => {
    const before = useStore.getState();
    const original = {
      accounts: structuredClone(before.accounts),
      household: structuredClone(before.household),
      events: structuredClone(before.events),
    };
    const json = exportScenarioJson();

    useStore.getState().newBlankScenario();
    expect(useStore.getState().accounts.length).toBeLessThan(original.accounts.length);
    expect(useStore.getState().events.length).toBe(0);

    const result = importScenarioJson(json);
    expect(result.ok).toBe(true);

    const after = useStore.getState();
    expect(after.accounts).toEqual(original.accounts);
    expect(after.household).toEqual(original.household);
    expect(after.events).toEqual(original.events);
  });

  it('rejects non-JSON input', () => {
    const result = importScenarioJson('not json {{{');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not valid JSON/i);
  });

  it('rejects a payload with no accounts array', () => {
    const result = importScenarioJson('{"household":{},"events":[]}');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/accounts/);
  });

  it('rejects a payload with no events array', () => {
    const result = importScenarioJson('{"accounts":[],"household":{}}');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/events/);
  });

  it('rejects a payload with neither household nor actor', () => {
    const result = importScenarioJson('{"accounts":[],"events":[]}');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/household|actor/i);
  });

  it('rejects a payload with a schemaVersion newer than this app supports', () => {
    const result = importScenarioJson(
      JSON.stringify({
        schemaVersion: 999,
        accounts: [],
        household: {
          scenario_name: 't',
          horizon_age: 95,
          cash_account_id: 'x',
          jurisdiction_account_id: 'y',
          actors: [{ id: 'primary', name: 'P', current_age: 60, alive: true }],
          primary_actor_id: 'primary',
        },
        events: [],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/schema version/i);
  });

  it('migrates a v1 payload (actor instead of household) on import', () => {
    const v1Payload = {
      schemaVersion: 1,
      accounts: [],
      actor: {
        current_age: 62,
        horizon_age: 95,
        cash_account_id: 'cash',
        jurisdiction_account_id: 'tax',
        scenario_name: 'Migrated v1',
        filing_status: 'mfj',
      },
      events: [],
    };
    const result = importScenarioJson(JSON.stringify(v1Payload));
    expect(result.ok).toBe(true);

    const h = useStore.getState().household;
    expect(h.scenario_name).toBe('Migrated v1');
    expect(h.horizon_age).toBe(95);
    expect(h.filing_status).toBe('mfj');
    expect(h.actors).toHaveLength(1);
    expect(h.actors[0].current_age).toBe(62);
    expect(h.actors[0].alive).toBe(true);
    expect(h.primary_actor_id).toBe(h.actors[0].id);
  });

  it('clamps account and household fields on import (defense in depth)', () => {
    const payload = {
      schemaVersion: 2,
      accounts: [
        {
          id: 'evil',
          name: 'evil income',
          kind: 'income',
          parent_id: null,
          start_age: -50,
          end_age: 999,
          annual_amount: -1000,
        },
      ],
      household: {
        scenario_name: 'evil',
        horizon_age: 0, // less than primary's current_age
        cash_account_id: 'evil',
        jurisdiction_account_id: 'evil',
        actors: [{ id: 'primary', name: 'Primary', current_age: 1000, alive: true }],
        primary_actor_id: 'primary',
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
    expect(acc!.end_age!).toBeGreaterThanOrEqual(acc!.start_age!);
    expect(acc!.annual_amount).toBeGreaterThanOrEqual(0);

    const h = useStore.getState().household;
    const primary = h.actors[0];
    expect(primary.current_age).toBeLessThanOrEqual(130);
    expect(h.horizon_age).toBeGreaterThan(primary.current_age);
  });

  it('import resets selection and hover (ephemeral fields are cleared)', () => {
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
