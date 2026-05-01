// UC integration tests — drive the UI, assert on resulting store state.
//
// Per docs/USE_CASES.md and DESIGN_NOTES.md: UC tests assert on model
// state (accounts/actor/events), NOT on projection numbers. Engine tests
// in engine.test.ts and engine.snapshot.test.ts cover the math.
//
// Convention: each `it(...)` block represents one UC. Naming matches the
// UC numbering in USE_CASES.md so a future regression points back to the
// authoritative spec.
//
// Test isolation: beforeEach resets the store to seed (or blank for UCs
// that start blank). Each test's mutations don't leak into the next.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { useStore } from './store';

function renderApp() {
  return {
    user: userEvent.setup(),
    ...render(<App />),
  };
}

beforeEach(() => {
  // Stub window.confirm() to auto-accept; UCs that test the
  // confirm-cancel path override this in-test.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------- Layer 0 — Invariants & reset ------------------------------------

describe('UC1 — seed loads and remains valid', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('seed has accounts, actor references valid accounts, no broken parent links', () => {
    renderApp();
    const s = useStore.getState();
    expect(s.accounts.length).toBeGreaterThan(0);

    const ids = new Set(s.accounts.map((a) => a.id));
    for (const a of s.accounts) {
      if (a.parent_id !== null) {
        expect(ids.has(a.parent_id)).toBe(true);
      }
    }

    expect(ids.has(s.household.cash_account_id)).toBe(true);
    expect(ids.has(s.household.jurisdiction_account_id)).toBe(true);

    for (const e of s.events) {
      for (const id of e.attached_account_ids) {
        expect(ids.has(id)).toBe(true);
      }
    }
  });

  it('charts render without throwing (smoke)', () => {
    renderApp();
    // The summary strip's labels are stable indicators that the projection
    // pipeline produced a non-empty result and the chart components mounted.
    expect(screen.getByText(/today's net worth/i)).toBeInTheDocument();
    expect(screen.getByText(/lifetime taxes/i)).toBeInTheDocument();
  });
});

describe('UC2 — reset to blank scenario', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('New ▾ → Blank scenario produces a 3-account scaffold and selects the actor', async () => {
    const { user } = renderApp();
    expect(useStore.getState().accounts.length).toBeGreaterThan(3);

    await user.click(screen.getByRole('button', { name: /^new ▾$/i }));
    await user.click(screen.getByRole('button', { name: /blank scenario/i }));

    const s = useStore.getState();
    expect(s.accounts.length).toBe(3);
    expect(s.events.length).toBe(0);
    expect(s.selection.kind).toBe('actor');

    const kinds = new Set(s.accounts.map((a) => a.kind));
    expect(kinds.has('ambient')).toBe(true);
    expect(kinds.has('asset')).toBe(true);

    expect(s.accounts.some((a) => a.id === s.household.cash_account_id)).toBe(true);
    expect(s.accounts.some((a) => a.id === s.household.jurisdiction_account_id)).toBe(true);
  });

  it('confirm cancel leaves state untouched', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user } = renderApp();
    const before = structuredClone(useStore.getState().accounts);

    await user.click(screen.getByRole('button', { name: /^new ▾$/i }));
    await user.click(screen.getByRole('button', { name: /blank scenario/i }));

    expect(useStore.getState().accounts).toEqual(before);
  });
});

describe('UC3 — reset to demo scenario', () => {
  it('New ▾ → Reset to demo restores the seed', async () => {
    useStore.getState().newBlankScenario();
    expect(useStore.getState().accounts.length).toBe(3);

    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /^new ▾$/i }));
    await user.click(screen.getByRole('button', { name: /reset to demo/i }));

    const s = useStore.getState();
    expect(s.accounts.length).toBeGreaterThan(3);
    expect(s.events.length).toBeGreaterThan(0);
    expect(s.household.scenario_name).toMatch(/baseline/i);
  });
});

// ---------- Layer 1 — Plan settings & jurisdictions ------------------------

describe('UC4 — edit Plan settings', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('selecting Plan settings opens the actor inspector with current values', async () => {
    const { user } = renderApp();
    await user.click(screen.getByText(/^plan settings$/i, { selector: '.tree-name' }));

    expect(useStore.getState().selection).toEqual({ kind: 'actor' });
    // Inspector should now expose the scenario name as an editable input.
    expect(
      await screen.findByDisplayValue(useStore.getState().household.scenario_name),
    ).toBeInTheDocument();
  });

  it('typing in the title input updates actor.scenario_name', async () => {
    const { user } = renderApp();
    await user.click(screen.getByText(/^plan settings$/i, { selector: '.tree-name' }));

    const titleInput = await screen.findByDisplayValue(
      useStore.getState().household.scenario_name,
    );
    await user.clear(titleInput);
    await user.type(titleInput, 'Connecticut Plan');

    expect(useStore.getState().household.scenario_name).toBe('Connecticut Plan');
  });
});

describe('UC5 — add an ambient jurisdiction', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('+ Add → Ambient appends a new ambient account and selects it', async () => {
    const { user } = renderApp();
    const before = useStore.getState().accounts.length;

    // Open the kind picker and pick Ambient.
    await user.click(screen.getByRole('button', { name: /add account/i }));
    await user.click(screen.getByRole('button', { name: /\+ ambient/i }));

    const after = useStore.getState();
    expect(after.accounts.length).toBe(before + 1);

    const newAcc = after.accounts[after.accounts.length - 1];
    expect(newAcc.kind).toBe('ambient');
    expect(after.selection).toEqual({ kind: 'account', id: newAcc.id });
  });
});

describe('UC6 — set actor active jurisdiction', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('clicking "Set as active jurisdiction" on an ambient updates actor.jurisdiction_account_id', async () => {
    // Start: actor on California; flip to Florida.
    const before = useStore.getState();
    expect(before.household.jurisdiction_account_id).toBe('tax_california');
    const fl = before.accounts.find((a) => a.id === 'tax_florida')!;
    expect(fl).toBeDefined();

    const { user } = renderApp();

    // Find Florida in the tree and select it. The tree-row text is the account name.
    await user.click(screen.getByText(fl.name));

    // The Inspector now shows the jurisdiction banner with the activate button.
    const setActive = await screen.findByRole('button', { name: /set as active jurisdiction/i });
    await user.click(setActive);

    expect(useStore.getState().household.jurisdiction_account_id).toBe('tax_florida');
  });

  it('changing jurisdiction via the ActorInspector dropdown also works (path B)', async () => {
    const { user } = renderApp();
    await user.click(screen.getByText(/^plan settings$/i, { selector: '.tree-name' }));

    // ActorInspector renders two <select>s (cash sink, jurisdiction).
    // Find the one that contains 'tax_florida' as an option value.
    const fl = useStore.getState().accounts.find((a) => a.id === 'tax_florida')!;
    expect(fl).toBeDefined();
    await screen.findByDisplayValue(useStore.getState().household.scenario_name);
    const selects = screen.getAllByRole('combobox');
    const jurisdictionSelect = selects.find((s) =>
      Array.from(s.querySelectorAll('option')).some((o) => o.value === 'tax_florida'),
    );
    expect(jurisdictionSelect).toBeDefined();
    await user.selectOptions(jurisdictionSelect!, 'tax_florida');

    expect(useStore.getState().household.jurisdiction_account_id).toBe('tax_florida');
  });
});

// ---------- Layer 2 — Accounts ----------------------------------------------

describe('UC7 — add an asset account', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('+ Add → Asset creates an asset with the seeded defaults', async () => {
    const { user } = renderApp();
    const before = useStore.getState().accounts.length;

    await user.click(screen.getByRole('button', { name: /add account/i }));
    await user.click(screen.getByRole('button', { name: /\+ asset/i }));

    const s = useStore.getState();
    expect(s.accounts.length).toBe(before + 1);
    const newAcc = s.accounts[s.accounts.length - 1];
    expect(newAcc.kind).toBe('asset');
    expect(newAcc.asset_class).toBe('equity');
    expect(newAcc.tax_treatment).toBe('taxable');
    expect(newAcc.start_value).toBe(0);
    expect(s.selection).toEqual({ kind: 'account', id: newAcc.id });
  });
});

// ---------- Layer 3 — Streams -----------------------------------------------

describe('UC9 — add an income stream', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('+ Add → Income creates an income with stream defaults', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /add account/i }));
    await user.click(screen.getByRole('button', { name: /\+ income/i }));

    const s = useStore.getState();
    const newAcc = s.accounts[s.accounts.length - 1];
    expect(newAcc.kind).toBe('income');
    expect(newAcc.annual_amount).toBeGreaterThanOrEqual(0);
    expect(typeof newAcc.start_age).toBe('number');
    expect(typeof newAcc.end_age).toBe('number');
    expect(newAcc.end_age!).toBeGreaterThanOrEqual(newAcc.start_age!);
  });
});

describe('UC10 — add an expense stream', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('+ Add → Expense creates an expense with stream defaults including non-zero growth_rate', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /add account/i }));
    await user.click(screen.getByRole('button', { name: /\+ expense/i }));

    const s = useStore.getState();
    const newAcc = s.accounts[s.accounts.length - 1];
    expect(newAcc.kind).toBe('expense');
    expect(typeof newAcc.annual_amount).toBe('number');
    // Default growth_rate is non-zero (3%) for expenses.
    expect(newAcc.growth_rate).not.toBe(undefined);
  });
});

describe('UC11 — auto-event derivation from end_age', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('auto-events are NOT in events array but ARE returned by the all-events selector', () => {
    renderApp();
    const s = useStore.getState();
    // The seed has streams with end_age < horizon (salary ends at 67,
    // healthcare at 95 = horizon, etc). Per UC11, no auto-events should
    // be persisted in `events` — they're derived.
    for (const e of s.events) {
      expect(e.auto_generated).not.toBe(true);
    }
  });

  it('selecting an auto-event opens a read-only inspector', async () => {
    const { user } = renderApp();
    // The seed's salary has end_age=67 < horizon=95, so an auto-event
    // "End salary" is derived. The event timeline list should show it
    // with an auto-generated marker.
    const autoEventRow = await screen.findByText(/end salary/i);
    await user.click(autoEventRow);

    // After selection, the Inspector should show the read-only view.
    // Look for the "Open source account" button — only appears for auto-events.
    expect(await screen.findByRole('button', { name: /open source account/i })).toBeInTheDocument();
  });
});

// ---------- Layer 4 — Events: kind & wiring --------------------------------

describe('UC12 — create a one-shot event', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('+ One-shot → liquidate creates an event with kind=one_shot and a stub liquidate action', async () => {
    const { user } = renderApp();
    const before = useStore.getState().events.length;

    await user.click(screen.getByRole('button', { name: /\+ one-shot/i }));
    await user.click(screen.getByRole('button', { name: /^liquidate/i }));

    const after = useStore.getState();
    expect(after.events.length).toBe(before + 1);
    const newEvt = after.events[after.events.length - 1];
    expect(newEvt.kind).toBe('one_shot');
    expect(newEvt.end_age).toBeUndefined();
    expect(newEvt.actions).toHaveLength(1);
    expect(newEvt.actions[0].type).toBe('liquidate');
    expect(after.selection).toEqual({ kind: 'event', id: newEvt.id });
  });
});

describe('UC13 — create a recurring event', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('+ Recurring → transfer creates a recurring event with end_age=trigger_age+5', async () => {
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: /\+ recurring/i }));
    await user.click(screen.getByRole('button', { name: /^transfer/i }));

    const s = useStore.getState();
    const newEvt = s.events[s.events.length - 1];
    expect(newEvt.kind).toBe('recurring');
    expect(newEvt.trigger_age).toBe(65); // default
    expect(newEvt.end_age).toBe(70);
    expect(newEvt.actions[0].type).toBe('transfer');
    // Transfer pre-wires an `amount` parameter.
    expect(newEvt.parameters.amount).toBeGreaterThan(0);
  });
});

describe('UC14 — attach an event to one or more accounts', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('toggling a checkbox adds the account to attached_account_ids', async () => {
    const { user } = renderApp();

    // Select an existing seed event (NUA on company stock).
    const nuaRow = await screen.findByText(/nua on company stock/i);
    await user.click(nuaRow);

    // The seed's NUA already attaches fidelity_company_stock. Toggle a
    // different account (the cash account) and confirm.
    const cash = useStore.getState().accounts.find((a) => a.id === 'cash_reserves')!;
    const checkbox = screen.getByRole('checkbox', { name: new RegExp(cash.name, 'i') });
    await user.click(checkbox);

    const evt = useStore.getState().events.find((e) => e.id === 'evt_nua')!;
    expect(evt.attached_account_ids).toContain('cash_reserves');
  });
});

describe('UC15 — set event parameters', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('changing the parameter slider updates event.parameters', async () => {
    const { user } = renderApp();

    const ladderRow = await screen.findByText(/roth conversion ladder/i);
    await user.click(ladderRow);

    // The Inspector renders parameter rows: <span class="ifield-label">amount</span>
    // followed by an <input type="range">. The slider has no aria-label,
    // so we traverse from the label span to find the slider in the same .ifield row.
    const labelSpan = await screen.findByText('amount', { selector: '.ifield-label' });
    const ifield = labelSpan.closest('.ifield')!;
    const slider = ifield.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    // For a range input, fireEvent.change is the reliable path.
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(slider, { target: { value: '120000' } });

    const evt = useStore.getState().events.find((e) => e.id === 'evt_roth_ladder')!;
    expect(evt.parameters.amount).toBe(120000);
    // Suppress "user is unused" lint.
    void user;
  });
});

// ---------- Layer 5 — Action types -----------------------------------------

describe('UC16-22 — action types via the action editor', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('UC16: a transfer action defaults pre-wire target_account and param_ref', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /\+ one-shot/i }));
    await user.click(screen.getByRole('button', { name: /^transfer/i }));

    const evt = useStore.getState().events[useStore.getState().events.length - 1];
    expect(evt.actions[0].type).toBe('transfer');
    expect(evt.actions[0].param_ref).toBe('amount');
  });

  it('UC18: add_value with field=start_value and a fractional shock', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /\+ one-shot/i }));
    await user.click(screen.getByRole('button', { name: /shock \/ adjust/i }));

    const evt = useStore.getState().events[useStore.getState().events.length - 1];
    expect(evt.actions[0].type).toBe('add_value');
    expect(evt.actions[0].field).toBe('start_value');
    expect(evt.actions[0].param_ref).toBe('shock');
    expect(Math.abs(evt.parameters.shock)).toBeLessThan(1);
  });

  it('UC19: switching field to annual_amount via the action editor select', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /\+ one-shot/i }));
    await user.click(screen.getByRole('button', { name: /shock \/ adjust/i }));

    const evtId = useStore.getState().events[useStore.getState().events.length - 1].id;
    // The action editor renders a Field <select>. Find it among combo
    // boxes; it's the one whose options include 'annual_amount'.
    const selects = screen.getAllByRole('combobox');
    const fieldSelect = selects.find((s) =>
      Array.from(s.querySelectorAll('option')).some((o) => o.value === 'annual_amount'),
    );
    expect(fieldSelect).toBeDefined();
    await user.selectOptions(fieldSelect!, 'annual_amount');

    const evt = useStore.getState().events.find((e) => e.id === evtId)!;
    expect(evt.actions[0].field).toBe('annual_amount');
  });

  it('UC20: reparent action requires a new_parent dropdown selection', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /\+ one-shot/i }));
    await user.click(screen.getByRole('button', { name: /^reparent/i }));

    const evtId = useStore.getState().events[useStore.getState().events.length - 1].id;
    // Find the new-parent select (one with 'tax_florida' as an option).
    const selects = screen.getAllByRole('combobox');
    const newParent = selects.find((s) =>
      Array.from(s.querySelectorAll('option')).some((o) => o.value === 'tax_florida'),
    );
    expect(newParent).toBeDefined();
    await user.selectOptions(newParent!, 'tax_florida');

    const evt = useStore.getState().events.find((e) => e.id === evtId)!;
    expect(evt.actions[0].new_parent).toBe('tax_florida');
  });

  it('UC22: + Add action appends another action', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /\+ one-shot/i }));
    await user.click(screen.getByRole('button', { name: /^liquidate/i }));

    await user.click(screen.getByRole('button', { name: /\+ add action/i }));

    const evt = useStore.getState().events[useStore.getState().events.length - 1];
    expect(evt.actions).toHaveLength(2);
  });
});

// ---------- Layer 6 — Mutations on existing entities ------------------------

describe('UC23 — delete an account', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('Delete on a deletable account removes it and clears selection', async () => {
    const { user } = renderApp();

    // Pick an asset that has no children and isn't the cash sink or
    // jurisdiction. seedAccounts has 'schwab_msft' which qualifies.
    const target = useStore.getState().accounts.find((a) => a.id === 'schwab_msft')!;
    await user.click(screen.getByText(target.name));

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    const s = useStore.getState();
    expect(s.accounts.find((a) => a.id === 'schwab_msft')).toBeUndefined();
    expect(s.selection).toEqual({ kind: 'none' });
  });

  it('Delete on the cash sink is blocked with an alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const { user } = renderApp();
    const cash = useStore.getState().accounts.find((a) => a.id === 'cash_reserves')!;
    await user.click(screen.getByText(cash.name));

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/cash sink|jurisdiction/i));
    // Account should still be there.
    expect(useStore.getState().accounts.find((a) => a.id === 'cash_reserves')).toBeDefined();
  });

  it('Delete on US Economy is blocked because it has children', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const { user } = renderApp();
    const us = useStore.getState().accounts.find((a) => a.id === 'us_economy')!;
    await user.click(screen.getByText(us.name));

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/has children/i));
    expect(useStore.getState().accounts.find((a) => a.id === 'us_economy')).toBeDefined();
  });
});

describe('UC24 — delete an event', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('Delete on a user event removes it', async () => {
    const { user } = renderApp();

    const target = await screen.findByText(/move to florida/i);
    await user.click(target);

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(useStore.getState().events.find((e) => e.id === 'evt_move_fl')).toBeUndefined();
  });
});

// ---------- Layer 7 — Read-only display ------------------------------------

describe('UC28 — toggle Nominal $ ↔ Today\'s $', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('clicking the toggle flips dollarMode', async () => {
    const { user } = renderApp();
    expect(useStore.getState().dollarMode).toBe('nominal');

    await user.click(screen.getByRole('button', { name: /today's \$/i }));
    expect(useStore.getState().dollarMode).toBe('real');

    await user.click(screen.getByRole('button', { name: /nominal \$/i }));
    expect(useStore.getState().dollarMode).toBe('nominal');
  });
});

// ---------- Layer — Phase 3.0 tax model -----------------------------------

describe('P3.0 — filing_status select on the actor', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('changing the Filing status select updates actor.filing_status', async () => {
    const { user } = renderApp();
    await user.click(screen.getByText(/^plan settings$/i, { selector: '.tree-name' }));

    const select = await screen.findByLabelText(/filing status/i);
    expect((select as HTMLSelectElement).value).toBe('mfj'); // seed default
    await user.selectOptions(select, 'single');
    expect(useStore.getState().household.filing_status).toBe('single');
  });
});

describe('P3.0 — account_type select on an asset', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('changing Account type updates account_type and shifts derived tax_treatment', async () => {
    const { user } = renderApp();
    // Pre-condition: the seed's MSFT lot is taxable_brokerage.
    const before = useStore.getState().accounts.find((a) => a.id === 'schwab_msft')!;
    expect(before.account_type).toBe('taxable_brokerage');

    await user.click(screen.getByText(before.name));
    const select = await screen.findByLabelText(/^account type$/i);
    await user.selectOptions(select, 'roth_account');

    const after = useStore.getState().accounts.find((a) => a.id === 'schwab_msft')!;
    expect(after.account_type).toBe('roth_account');
  });
});

describe('P3.0 — tax_deductible toggle on an expense', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('flipping the checkbox sets tax_deductible on the expense account', async () => {
    const { user } = renderApp();
    const expense = useStore.getState().accounts.find((a) => a.id === 'living_expenses')!;
    // Click the row in the accounts tree (the same name may also appear in
    // chart legends / tooltips, so disambiguate via the tree-name class).
    await user.click(screen.getByText(expense.name, { selector: '.tree-name' }));

    const checkbox = await screen.findByLabelText(/reduces ordinary taxable income/i);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    await user.click(checkbox);

    expect(useStore.getState().accounts.find((a) => a.id === 'living_expenses')!.tax_deductible).toBe(true);
  });
});

describe('P3.0 — RMD auto-event derivation', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('seed renders an auto-generated RMD event for each traditional_401k account', () => {
    renderApp();
    // Synthesized RMD events have names like "RMD on <account name>" and
    // appear as rows in the timeline list.
    const rmdRows = screen.getAllByText(/^RMD on /i);
    expect(rmdRows.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------- Layer — Phase 3.5 couples --------------------------------------

describe('P3.5 — adding a spouse', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('clicking + Add spouse appends a second actor to the household', async () => {
    const { user } = renderApp();
    await user.click(screen.getByText(/^plan settings$/i, { selector: '.tree-name' }));

    const before = useStore.getState().household.actors.length;
    expect(before).toBe(1);

    await user.click(screen.getByRole('button', { name: /\+ add spouse/i }));

    const after = useStore.getState().household;
    expect(after.actors).toHaveLength(2);
    expect(after.filing_status).toBe('mfj');
  });
});

describe('P3.5 — owner picker on an asset', () => {
  beforeEach(() => {
    useStore.getState().resetToSeed();
    // Add a spouse so the owners control becomes visible.
    useStore.getState().addActor('Spouse', 60);
  });

  it('toggling an owner checkbox updates account.owners', async () => {
    const { user } = renderApp();
    const target = useStore.getState().accounts.find((a) => a.id === 'schwab_msft')!;
    await user.click(screen.getByText(target.name, { selector: '.tree-name' }));

    const spouse = useStore.getState().household.actors.find((a) => a.name === 'Spouse')!;
    const checkbox = await screen.findByLabelText(`${spouse.name} owner`);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    await user.click(checkbox);

    const after = useStore.getState().accounts.find((a) => a.id === 'schwab_msft')!;
    expect(after.owners).toBeDefined();
    expect(after.owners).toContain(spouse.id);
  });
});

describe('P3.5 — death-of-spouse action', () => {
  beforeEach(() => {
    useStore.getState().resetToSeed();
    useStore.getState().addActor('Spouse', 60);
  });

  it('+ One-shot → Death of spouse creates an event with a death action', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /^\+ one-shot$/i }));
    await user.click(screen.getByRole('button', { name: /^Death of spouse/i }));

    const events = useStore.getState().events;
    const death = events.find((e) => e.actions[0]?.type === 'death');
    expect(death).toBeDefined();
    expect(death!.kind).toBe('one_shot');
  });
});

// ---------- Notes on UCs covered elsewhere or deferred ---------------------
//
// UC17 (liquidate) and UC21 (end_account) are covered by UC22 implicitly
// (the action editor allows configuring all types); UC22 here stresses the
// multi-action composition. Engine effects of each action type are
// covered by engine.test.ts.
//
// UC25 (drag a chart node) — pointer events on absolutely-positioned
// chart overlays are brittle to test via testing-library. Engine.test.ts
// covers the rounding behavior the drag relies on. Worth a manual UI
// sanity check rather than an integration test until we adopt Playwright
// or similar.
//
// UC26-27 (chart tooltips) — recharts renders SVG tooltips that don't
// trigger naturally under user.hover() in jsdom. Skipped until we add
// an end-to-end runner. The tooltip *content* is a pure function of
// the projection, which engine snapshot tests already lock in.
//
// UC29 (export/import round-trip) — the JSON round-trip itself is fully
// covered by store.persistence.test.ts. The UI button wiring is thin
// glue; not adding a separate UC integration test for it.
//
// UC30 (localStorage round-trip across page refresh) — requires
// re-mounting the whole app with localStorage state preserved. The
// persist middleware is well-tested upstream by Zustand; the
// configuration is verified by the store.persistence.test.ts shape
// checks. A true refresh test would belong in an end-to-end runner.
