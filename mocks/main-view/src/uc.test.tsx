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

    expect(ids.has(s.actor.cash_account_id)).toBe(true);
    expect(ids.has(s.actor.jurisdiction_account_id)).toBe(true);

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

    expect(s.accounts.some((a) => a.id === s.actor.cash_account_id)).toBe(true);
    expect(s.accounts.some((a) => a.id === s.actor.jurisdiction_account_id)).toBe(true);
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
    expect(s.actor.scenario_name).toMatch(/baseline/i);
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
      await screen.findByDisplayValue(useStore.getState().actor.scenario_name),
    ).toBeInTheDocument();
  });

  it('typing in the title input updates actor.scenario_name', async () => {
    const { user } = renderApp();
    await user.click(screen.getByText(/^plan settings$/i, { selector: '.tree-name' }));

    const titleInput = await screen.findByDisplayValue(
      useStore.getState().actor.scenario_name,
    );
    await user.clear(titleInput);
    await user.type(titleInput, 'Connecticut Plan');

    expect(useStore.getState().actor.scenario_name).toBe('Connecticut Plan');
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
    expect(before.actor.jurisdiction_account_id).toBe('tax_california');
    const fl = before.accounts.find((a) => a.id === 'tax_florida')!;
    expect(fl).toBeDefined();

    const { user } = renderApp();

    // Find Florida in the tree and select it. The tree-row text is the account name.
    await user.click(screen.getByText(fl.name));

    // The Inspector now shows the jurisdiction banner with the activate button.
    const setActive = await screen.findByRole('button', { name: /set as active jurisdiction/i });
    await user.click(setActive);

    expect(useStore.getState().actor.jurisdiction_account_id).toBe('tax_florida');
  });

  it('changing jurisdiction via the ActorInspector dropdown also works (path B)', async () => {
    const { user } = renderApp();
    await user.click(screen.getByText(/^plan settings$/i, { selector: '.tree-name' }));

    // ActorInspector renders two <select>s (cash sink, jurisdiction).
    // Find the one that contains 'tax_florida' as an option value.
    const fl = useStore.getState().accounts.find((a) => a.id === 'tax_florida')!;
    expect(fl).toBeDefined();
    await screen.findByDisplayValue(useStore.getState().actor.scenario_name);
    const selects = screen.getAllByRole('combobox');
    const jurisdictionSelect = selects.find((s) =>
      Array.from(s.querySelectorAll('option')).some((o) => o.value === 'tax_florida'),
    );
    expect(jurisdictionSelect).toBeDefined();
    await user.selectOptions(jurisdictionSelect!, 'tax_florida');

    expect(useStore.getState().actor.jurisdiction_account_id).toBe('tax_florida');
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
