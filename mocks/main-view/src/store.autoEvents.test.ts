// Tests for the auto-event synthesizer. Per DESIGN_NOTES.md and
// USE_CASES.md UC11, the engine derives `end_account` events from
// declarative `end_age` fields on income/expense streams at projection
// time — they aren't materialized into the user's events array.

import { describe, expect, it } from 'vitest';
import { synthesizeAutoEvents } from './store';
import type { AccountNode, Actor } from './types';

function actor(over: Partial<Actor> = {}): Actor {
  return {
    current_age: 60,
    horizon_age: 95,
    cash_account_id: 'cash',
    jurisdiction_account_id: 'tax',
    scenario_name: 'test',
    ...over,
  };
}

function income(over: Partial<AccountNode> & Pick<AccountNode, 'id'>): AccountNode {
  return {
    name: over.id,
    kind: 'income',
    parent_id: 'us',
    annual_amount: 100_000,
    start_age: 60,
    growth_rate: 0,
    ...over,
  };
}

function expense(over: Partial<AccountNode> & Pick<AccountNode, 'id'>): AccountNode {
  return {
    name: over.id,
    kind: 'expense',
    parent_id: 'us',
    annual_amount: 100_000,
    start_age: 60,
    growth_rate: 0,
    ...over,
  };
}

describe('synthesizeAutoEvents', () => {
  it('generates an end_account event for an income stream with end_age < horizon', () => {
    const accounts: AccountNode[] = [income({ id: 'salary', end_age: 67 })];
    const auto = synthesizeAutoEvents(accounts, actor({ horizon_age: 95 }));
    expect(auto).toHaveLength(1);
    expect(auto[0].auto_generated).toBe(true);
    expect(auto[0].attached_account_ids).toEqual(['salary']);
    expect(auto[0].trigger_age).toBe(67);
    expect(auto[0].kind).toBe('one_shot');
    expect(auto[0].actions).toEqual([{ type: 'end_account' }]);
  });

  it('generates one for an expense stream too', () => {
    const accounts: AccountNode[] = [expense({ id: 'mortgage', end_age: 90 })];
    const auto = synthesizeAutoEvents(accounts, actor({ horizon_age: 95 }));
    expect(auto).toHaveLength(1);
    expect(auto[0].attached_account_ids).toEqual(['mortgage']);
    expect(auto[0].trigger_age).toBe(90);
  });

  it('does NOT generate one when end_age equals horizon_age', () => {
    // A stream that runs through the horizon doesn't need an explicit
    // end-event; the engine's start_age/end_age window already enforces it.
    const accounts: AccountNode[] = [income({ id: 'ss', end_age: 95 })];
    const auto = synthesizeAutoEvents(accounts, actor({ horizon_age: 95 }));
    expect(auto).toHaveLength(0);
  });

  it('does NOT generate one when end_age is undefined', () => {
    const accounts: AccountNode[] = [income({ id: 'pension', end_age: undefined })];
    const auto = synthesizeAutoEvents(accounts, actor());
    expect(auto).toHaveLength(0);
  });

  it('does NOT generate events for asset or ambient kinds', () => {
    const accounts: AccountNode[] = [
      {
        id: 'roth',
        name: 'Roth',
        kind: 'asset',
        parent_id: 'us',
        asset_class: 'equity',
        tax_treatment: 'tax_free',
        start_value: 100_000,
        end_age: 80,
      } as AccountNode,
      {
        id: 'us',
        name: 'US',
        kind: 'ambient',
        parent_id: null,
        equity_yield: 0.07,
      },
    ];
    const auto = synthesizeAutoEvents(accounts, actor());
    expect(auto).toHaveLength(0);
  });

  it('generates one auto-event per qualifying stream', () => {
    const accounts: AccountNode[] = [
      income({ id: 'salary', end_age: 67 }),
      income({ id: 'consulting', end_age: 72 }),
      expense({ id: 'mortgage', end_age: 80 }),
    ];
    const auto = synthesizeAutoEvents(accounts, actor());
    expect(auto.map((e) => e.attached_account_ids[0]).sort()).toEqual([
      'consulting',
      'mortgage',
      'salary',
    ]);
  });

  it('synthesized event id is stable so selection survives re-derivation', () => {
    const accounts: AccountNode[] = [income({ id: 'salary', end_age: 67 })];
    const a = synthesizeAutoEvents(accounts, actor());
    const b = synthesizeAutoEvents(accounts, actor());
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toBe('auto_end_salary');
  });

  it('auto_generated flag is true so the UI can mark the event as derived', () => {
    const accounts: AccountNode[] = [income({ id: 'salary', end_age: 67 })];
    const auto = synthesizeAutoEvents(accounts, actor());
    expect(auto[0].auto_generated).toBe(true);
  });
});
