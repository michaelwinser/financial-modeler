import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AccountKind,
  AccountNode,
  ActionTemplate,
  Actor,
  TimelineEvent,
  YearlyProjection,
} from './types';
import { project } from './engine';
import { seedAccounts, seedActor, seedEvents } from './seed';
import { resolveSubjectToRmd } from './tax';

const STORAGE_KEY = 'financial-modeler-v1';
const SCHEMA_VERSION = 1;

export type DollarMode = 'nominal' | 'real';
export type Selection =
  | { kind: 'none' }
  | { kind: 'account'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'actor' };

interface State {
  accounts: AccountNode[];
  actor: Actor;
  events: TimelineEvent[];
  dollarMode: DollarMode;
  selection: Selection;
  hoveredEventId: string | null;
  expandedNodes: Set<string>;
  // mutators
  setEventAge: (id: string, trigger: number, end?: number) => void;
  setEventParam: (id: string, key: string, value: number) => void;
  setEventName: (id: string, name: string) => void;
  toggleEventAttachment: (id: string, accountId: string) => void;
  setAccountField: <K extends keyof AccountNode>(
    id: string,
    key: K,
    value: AccountNode[K],
  ) => void;
  setActorField: <K extends keyof Actor>(key: K, value: Actor[K]) => void;
  resetToSeed: () => void;
  newBlankScenario: () => void;
  // create / delete
  addAccount: (kind: AccountKind, parentId?: string | null) => string;
  removeAccount: (id: string) => { ok: boolean; reason?: string };
  addEvent: (kind: 'one_shot' | 'recurring', actionType: ActionTemplate['type']) => string;
  removeEvent: (id: string) => void;
  // primitives editor
  setActionField: (eventId: string, idx: number, patch: Partial<ActionTemplate>) => void;
  addAction: (eventId: string) => void;
  removeAction: (eventId: string, idx: number) => void;
  addEventParam: (eventId: string, key: string, value: number) => void;
  removeEventParam: (eventId: string, key: string) => void;
  // misc
  toggleDollarMode: () => void;
  select: (sel: Selection) => void;
  setHoveredEvent: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
}

let nextIdCounter = 1;
const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(nextIdCounter++).toString(36)}`;

// Sanity bounds at the store boundary. Keeps the engine from seeing
// nonsense states that the existing slider min/max already prevent on
// the happy path, but that imports / direct mutations could otherwise
// inject.
function clampAccount(a: AccountNode): AccountNode {
  const next: AccountNode = { ...a };
  // Ages within a reasonable lifespan.
  if (next.start_age !== undefined)
    next.start_age = Math.max(0, Math.min(130, Math.round(next.start_age)));
  if (next.end_age !== undefined)
    next.end_age = Math.max(0, Math.min(130, Math.round(next.end_age)));
  // end_age must not precede start_age.
  if (
    next.start_age !== undefined &&
    next.end_age !== undefined &&
    next.end_age < next.start_age
  )
    next.end_age = next.start_age;
  // Asset balances never go below zero (use a liability for debt).
  if (next.kind === 'asset' && next.start_value !== undefined && next.start_value < 0)
    next.start_value = 0;
  // Income / expense annual amounts are non-negative.
  if (
    (next.kind === 'income' || next.kind === 'expense') &&
    next.annual_amount !== undefined &&
    next.annual_amount < 0
  )
    next.annual_amount = 0;
  // Cost basis non-negative.
  if (next.cost_basis !== undefined && next.cost_basis < 0) next.cost_basis = 0;
  return next;
}

function clampActor(a: Actor): Actor {
  const next = { ...a };
  next.current_age = Math.max(0, Math.min(130, Math.round(next.current_age)));
  next.horizon_age = Math.max(
    next.current_age + 1,
    Math.min(130, Math.round(next.horizon_age)),
  );
  return next;
}

function defaultAccountForKind(kind: AccountKind, parent_id: string | null): AccountNode {
  const base = { id: newId(kind), parent_id, kind };
  if (kind === 'asset') {
    return {
      ...base,
      name: 'New asset',
      asset_class: 'equity',
      tax_treatment: 'taxable',
      start_value: 0,
      cost_basis: 0,
    } as AccountNode;
  }
  if (kind === 'income') {
    return {
      ...base,
      name: 'New income stream',
      annual_amount: 0,
      start_age: 60,
      end_age: 95,
      growth_rate: 0,
    } as AccountNode;
  }
  if (kind === 'expense') {
    return {
      ...base,
      name: 'New expense',
      annual_amount: 0,
      start_age: 60,
      end_age: 95,
      growth_rate: 0.03,
    } as AccountNode;
  }
  if (kind === 'ambient') {
    return {
      ...base,
      name: 'New ambient',
      equity_yield: 0.07,
      bond_yield: 0.04,
      cash_yield: 0.035,
      inflation_rate: 0.03,
      parent_id: null,
    } as AccountNode;
  }
  if (kind === 'liability') {
    return { ...base, name: 'New liability', start_value: 0 } as AccountNode;
  }
  return { ...base, name: 'New group' } as AccountNode;
}

function defaultEventForAction(
  kind: 'one_shot' | 'recurring',
  actionType: ActionTemplate['type'],
  startAge: number,
): TimelineEvent {
  const id = newId('evt');
  const action: ActionTemplate = { type: actionType };
  const parameters: Record<string, number> = {};
  // Wire common defaults so the stub feels alive immediately.
  if (actionType === 'transfer') {
    action.param_ref = 'amount';
    parameters.amount = 50000;
  } else if (actionType === 'add_value') {
    action.field = 'start_value';
    action.param_ref = 'shock';
    parameters.shock = -0.1;
  } else if (actionType === 'set_value') {
    action.field = 'annual_amount';
    action.param_ref = 'value';
    parameters.value = 0;
  }
  return {
    id,
    name: 'New event',
    trigger_age: startAge,
    end_age: kind === 'recurring' ? startAge + 5 : undefined,
    kind,
    attached_account_ids: [],
    parameters,
    actions: [action],
  };
}

export const useStore = create<State>()(
  persist(
    (set) => ({
  accounts: seedAccounts,
  actor: seedActor,
  events: seedEvents,
  dollarMode: 'nominal',
  selection: { kind: 'none' },
  hoveredEventId: null,
  expandedNodes: new Set([
    'us_economy',
    'tax_federal',
    'personal',
    'schwab',
    'fidelity_401k',
    'vanguard_roth',
  ]),
  setEventAge: (id, trigger, end) =>
    set((s) => ({
      events: s.events.map((e) => {
        if (e.id !== id) return e;
        const t = Math.round(trigger);
        const en = end !== undefined ? Math.round(end) : e.end_age;
        return { ...e, trigger_age: t, end_age: en };
      }),
    })),
  setEventParam: (id, key, value) =>
    set((s) => ({
      events: s.events.map((e) =>
        e.id === id ? { ...e, parameters: { ...e.parameters, [key]: value } } : e,
      ),
    })),
  setEventName: (id, name) =>
    set((s) => ({
      events: s.events.map((e) => (e.id === id ? { ...e, name } : e)),
    })),
  toggleEventAttachment: (id, accountId) =>
    set((s) => ({
      events: s.events.map((e) => {
        if (e.id !== id) return e;
        const has = e.attached_account_ids.includes(accountId);
        return {
          ...e,
          attached_account_ids: has
            ? e.attached_account_ids.filter((x) => x !== accountId)
            : [...e.attached_account_ids, accountId],
        };
      }),
    })),
  setAccountField: (id, key, value) =>
    set((s) => ({
      accounts: s.accounts.map((a) => {
        if (a.id !== id) return a;
        const next = { ...a, [key]: value } as AccountNode;
        return clampAccount(next);
      }),
    })),
  setActorField: (key, value) =>
    set((s) => ({
      actor: clampActor({ ...s.actor, [key]: value } as Actor),
    })),
  resetToSeed: () =>
    set(() => {
      autoEventsCache = null;
      mergedEventsCache = null;
      projectionCache = null;
      return {
        accounts: seedAccounts,
        actor: seedActor,
        events: seedEvents,
        selection: { kind: 'none' as const },
        hoveredEventId: null,
      };
    }),
  newBlankScenario: () =>
    set(() => {
      autoEventsCache = null;
      mergedEventsCache = null;
      projectionCache = null;
      const economy: AccountNode = {
        id: 'us_economy',
        name: 'US Economy',
        kind: 'ambient',
        parent_id: null,
        equity_yield: 0.07,
        bond_yield: 0.04,
        cash_yield: 0.035,
        real_estate_yield: 0.035,
        inflation_rate: 0.03,
      };
      const cash: AccountNode = {
        id: 'cash_reserves',
        name: 'Cash & reserves',
        kind: 'asset',
        parent_id: 'us_economy',
        asset_class: 'cash',
        tax_treatment: 'taxable',
        start_value: 0,
      };
      const jurisdiction: AccountNode = {
        id: 'jurisdiction_default',
        name: 'My jurisdiction',
        kind: 'ambient',
        parent_id: null,
        effective_tax_rate: 0.25,
      };
      return {
        accounts: [economy, cash, jurisdiction],
        actor: {
          current_age: 60,
          horizon_age: 95,
          cash_account_id: cash.id,
          jurisdiction_account_id: jurisdiction.id,
          scenario_name: 'New scenario',
        },
        events: [],
        selection: { kind: 'actor' as const },
        hoveredEventId: null,
      };
    }),
  addAccount: (kind, parentId) => {
    const parent = parentId === undefined ? 'us_economy' : parentId;
    const node = defaultAccountForKind(kind, parent);
    set((s) => ({
      accounts: [...s.accounts, node],
      selection: { kind: 'account', id: node.id },
    }));
    return node.id;
  },
  removeAccount: (id) => {
    let result: { ok: boolean; reason?: string } = { ok: true };
    set((s) => {
      const target = s.accounts.find((a) => a.id === id);
      if (!target) {
        result = { ok: false, reason: 'not found' };
        return s;
      }
      if (s.accounts.some((a) => a.parent_id === id)) {
        result = {
          ok: false,
          reason: 'has children — re-parent or delete children first',
        };
        return s;
      }
      const usedByActor =
        s.actor.cash_account_id === id || s.actor.jurisdiction_account_id === id;
      if (usedByActor) {
        result = {
          ok: false,
          reason: 'used by actor (cash sink or jurisdiction)',
        };
        return s;
      }
      // Drop attachments to this account from any events.
      const events = s.events.map((e) => ({
        ...e,
        attached_account_ids: e.attached_account_ids.filter((x) => x !== id),
      }));
      return {
        accounts: s.accounts.filter((a) => a.id !== id),
        events,
        selection: { kind: 'none' as const },
      };
    });
    return result;
  },
  addEvent: (kind, actionType) => {
    const evt = defaultEventForAction(kind, actionType, 65);
    set((s) => ({
      events: [...s.events, evt],
      selection: { kind: 'event', id: evt.id },
    }));
    return evt.id;
  },
  removeEvent: (id) =>
    set((s) => ({
      events: s.events.filter((e) => e.id !== id),
      selection: { kind: 'none' },
    })),
  setActionField: (eventId, idx, patch) =>
    set((s) => ({
      events: s.events.map((e) => {
        if (e.id !== eventId) return e;
        const actions = e.actions.map((a, i) => (i === idx ? { ...a, ...patch } : a));
        return { ...e, actions };
      }),
    })),
  addAction: (eventId) =>
    set((s) => ({
      events: s.events.map((e) =>
        e.id === eventId
          ? { ...e, actions: [...e.actions, { type: 'set_value' }] }
          : e,
      ),
    })),
  removeAction: (eventId, idx) =>
    set((s) => ({
      events: s.events.map((e) =>
        e.id === eventId
          ? { ...e, actions: e.actions.filter((_, i) => i !== idx) }
          : e,
      ),
    })),
  addEventParam: (eventId, key, value) =>
    set((s) => ({
      events: s.events.map((e) =>
        e.id === eventId
          ? { ...e, parameters: { ...e.parameters, [key]: value } }
          : e,
      ),
    })),
  removeEventParam: (eventId, key) =>
    set((s) => ({
      events: s.events.map((e) => {
        if (e.id !== eventId) return e;
        const params = { ...e.parameters };
        delete params[key];
        return { ...e, parameters: params };
      }),
    })),
  toggleDollarMode: () =>
    set((s) => ({ dollarMode: s.dollarMode === 'nominal' ? 'real' : 'nominal' })),
  select: (sel) => set({ selection: sel }),
  setHoveredEvent: (id) => set({ hoveredEventId: id }),
  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expandedNodes);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedNodes: next };
    }),
}),
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Only persist scenario data and lightweight UI prefs.
      // Selection / hover are ephemeral; don't pollute saved state.
      partialize: (s) => ({
        accounts: s.accounts,
        actor: s.actor,
        events: s.events,
        dollarMode: s.dollarMode,
        expandedNodes: Array.from(s.expandedNodes),
      }),
      // Sets aren't JSON-friendly — convert back on rehydrate.
      merge: (persisted, current) => {
        const p = persisted as Partial<State> & { expandedNodes?: string[] | Set<string> };
        return {
          ...current,
          ...p,
          expandedNodes: Array.isArray(p.expandedNodes)
            ? new Set(p.expandedNodes)
            : (p.expandedNodes ?? current.expandedNodes),
        };
      },
    },
  ),
);

// Module-level memoization caches for derived data shared across all
// hook subscribers. We key on reference identity of the inputs — Zustand
// keeps slice references stable when the underlying value is unchanged,
// so cache hits are common and we avoid re-running the engine 3× per
// render (once per useProjection caller).

let autoEventsCache: {
  accounts: AccountNode[];
  actor: Actor;
  result: TimelineEvent[];
} | null = null;

let projectionCache: {
  accounts: AccountNode[];
  actor: Actor;
  events: TimelineEvent[];
  result: YearlyProjection[];
} | null = null;

// Synthesize "auto-events" derived from declarative fields on accounts.
// Today: end_account events for income/expense streams whose end_age is
// less than the actor's horizon_age. Derived on every read so the source
// account remains the single source of truth.
export function synthesizeAutoEvents(
  accounts: AccountNode[],
  actor: Actor,
): TimelineEvent[] {
  if (
    autoEventsCache &&
    autoEventsCache.accounts === accounts &&
    autoEventsCache.actor === actor
  ) {
    return autoEventsCache.result;
  }
  const result = computeAutoEvents(accounts, actor);
  autoEventsCache = { accounts, actor, result };
  return result;
}

function computeAutoEvents(
  accounts: AccountNode[],
  actor: Actor,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const a of accounts) {
    if (a.kind !== 'income' && a.kind !== 'expense') continue;
    if (a.end_age === undefined) continue;
    if (a.end_age >= actor.horizon_age) continue;
    out.push({
      id: `auto_end_${a.id}`,
      name: `End ${a.name.toLowerCase()}`,
      description: `Auto-generated from ${a.name}.end_age = ${a.end_age}. Edit the source account to change.`,
      trigger_age: a.end_age,
      kind: 'one_shot',
      attached_account_ids: [a.id],
      parameters: {},
      actions: [{ type: 'end_account' }],
      auto_generated: true,
    });
  }
  // RMD events: one recurring event per RMD-subject asset, ages 73 →
  // horizon. The amount is computed dynamically by the engine each year
  // from current balance × Uniform Lifetime Table divisor — we just
  // trigger the action, no parameters. Accounts with subject_to_rmd
  // explicitly false (or derived false from account_type) are skipped.
  const rmdStart = 73;
  if (actor.horizon_age >= rmdStart) {
    for (const a of accounts) {
      if (a.kind !== 'asset') continue;
      if (!resolveSubjectToRmd(a)) continue;
      out.push({
        id: `auto_rmd_${a.id}`,
        name: `RMD on ${a.name.toLowerCase()}`,
        description: `Auto-generated from ${a.name}.subject_to_rmd. IRS Uniform Lifetime Table; starts at age ${rmdStart}.`,
        trigger_age: rmdStart,
        end_age: actor.horizon_age,
        kind: 'recurring',
        attached_account_ids: [a.id],
        parameters: {},
        actions: [{ type: 'rmd' }],
        auto_generated: true,
      });
    }
  }
  return out;
}

// Merged events (user + auto) — memoized so all subscribers share one
// stable array reference when nothing relevant has changed.
let mergedEventsCache: {
  events: TimelineEvent[];
  auto: TimelineEvent[];
  result: TimelineEvent[];
} | null = null;

function mergedEvents(
  events: TimelineEvent[],
  auto: TimelineEvent[],
): TimelineEvent[] {
  if (
    mergedEventsCache &&
    mergedEventsCache.events === events &&
    mergedEventsCache.auto === auto
  ) {
    return mergedEventsCache.result;
  }
  const result = [...events, ...auto];
  mergedEventsCache = { events, auto, result };
  return result;
}

export function useAllEvents(): TimelineEvent[] {
  const accounts = useStore((s) => s.accounts);
  const actor = useStore((s) => s.actor);
  const events = useStore((s) => s.events);
  return mergedEvents(events, synthesizeAutoEvents(accounts, actor));
}

// Import / export the full scenario as JSON. Carries the schema version
// so future migrations can detect old payloads. Selection / hover are
// excluded — they're ephemeral.
export interface ScenarioPayload {
  schemaVersion: number;
  exportedAt: string;
  accounts: AccountNode[];
  actor: Actor;
  events: TimelineEvent[];
}

export function exportScenarioJson(): string {
  const s = useStore.getState();
  const payload: ScenarioPayload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    accounts: s.accounts,
    actor: s.actor,
    events: s.events,
  };
  return JSON.stringify(payload, null, 2);
}

export function importScenarioJson(json: string): { ok: boolean; reason?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: `not valid JSON: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'JSON root is not an object' };
  }
  const p = parsed as Partial<ScenarioPayload>;
  if (!Array.isArray(p.accounts)) return { ok: false, reason: 'missing or invalid `accounts` array' };
  if (!Array.isArray(p.events)) return { ok: false, reason: 'missing or invalid `events` array' };
  if (!p.actor || typeof p.actor !== 'object')
    return { ok: false, reason: 'missing or invalid `actor` object' };
  if (p.schemaVersion !== undefined && p.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `schema version ${p.schemaVersion} is newer than this app supports (${SCHEMA_VERSION}).`,
    };
  }
  // Replace state. Reset selection/hover so the UI doesn't reference stale ids.
  // Defensive: clamp imported values so a bad file can't poison the engine.
  useStore.setState({
    accounts: p.accounts.map(clampAccount),
    actor: clampActor(p.actor as Actor),
    events: p.events,
    selection: { kind: 'none' },
    hoveredEventId: null,
  });
  // Invalidate caches so the next render sees fresh derived data.
  autoEventsCache = null;
  mergedEventsCache = null;
  projectionCache = null;
  return { ok: true };
}

export function useProjection(): YearlyProjection[] {
  const accounts = useStore((s) => s.accounts);
  const actor = useStore((s) => s.actor);
  const events = useStore((s) => s.events);
  const all = mergedEvents(events, synthesizeAutoEvents(accounts, actor));
  if (
    projectionCache &&
    projectionCache.accounts === accounts &&
    projectionCache.actor === actor &&
    projectionCache.events === all
  ) {
    return projectionCache.result;
  }
  const result = project(accounts, actor, all);
  projectionCache = { accounts, actor, events: all, result };
  return result;
}
