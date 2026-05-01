import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AccountKind,
  AccountNode,
  ActionTemplate,
  Actor,
  Household,
  TimelineEvent,
  YearlyProjection,
} from './types';
import { project } from './engine';
import { seedAccounts, seedHousehold, seedEvents } from './seed';
import { resolveSubjectToRmd } from './tax';
import { ownerActor, primaryActor } from './household';

const STORAGE_KEY = 'financial-modeler-v1';
// Bumped to 2 in Phase 3.5 (Actor → Household + Person split). The
// persist middleware backs up v1 localStorage as a JSON download before
// resetting; importScenarioJson migrates v1 payloads inline.
const SCHEMA_VERSION = 2;

export type DollarMode = 'nominal' | 'real';
export type Selection =
  | { kind: 'none' }
  | { kind: 'account'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'actor' }
  | { kind: 'person'; id: string };

interface State {
  accounts: AccountNode[];
  household: Household;
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
  setHouseholdField: <K extends keyof Household>(key: K, value: Household[K]) => void;
  setActorField: <K extends keyof Actor>(actorId: string, key: K, value: Actor[K]) => void;
  addActor: (name?: string, current_age?: number) => string;
  removeActor: (id: string) => { ok: boolean; reason?: string };
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
  if (next.start_age !== undefined)
    next.start_age = Math.max(0, Math.min(130, Math.round(next.start_age)));
  if (next.end_age !== undefined)
    next.end_age = Math.max(0, Math.min(130, Math.round(next.end_age)));
  if (
    next.start_age !== undefined &&
    next.end_age !== undefined &&
    next.end_age < next.start_age
  )
    next.end_age = next.start_age;
  if (next.kind === 'asset' && next.start_value !== undefined && next.start_value < 0)
    next.start_value = 0;
  if (
    (next.kind === 'income' || next.kind === 'expense') &&
    next.annual_amount !== undefined &&
    next.annual_amount < 0
  )
    next.annual_amount = 0;
  if (next.cost_basis !== undefined && next.cost_basis < 0) next.cost_basis = 0;
  return next;
}

function clampActor(p: Actor): Actor {
  return {
    ...p,
    current_age: Math.max(0, Math.min(130, Math.round(p.current_age))),
  };
}

function clampHousehold(h: Household): Household {
  const youngest = Math.min(...h.actors.map((a) => a.current_age));
  return {
    ...h,
    horizon_age: Math.max(youngest + 1, Math.min(130, Math.round(h.horizon_age))),
    actors: h.actors.map(clampActor),
  };
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

// One-time auto-backup: when the persist middleware sees a v1 blob, it
// writes a JSON file to the user's downloads before resetting state.
// Wrapped in try/catch so jsdom (tests) doesn't blow up — file download
// machinery is browser-only.
function downloadV1Backup(persisted: unknown): void {
  try {
    const blob = new Blob([JSON.stringify(persisted, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financial-modeler-v1-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    // Best effort. If we can't trigger a download (e.g., test env), the
    // user just loses v1 state — same outcome as if migration weren't
    // attempted at all.
    console.warn('failed to back up v1 localStorage state:', e);
  }
}

export const useStore = create<State>()(
  persist(
    (set) => ({
  accounts: seedAccounts,
  household: seedHousehold,
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
  setHouseholdField: (key, value) =>
    set((s) => ({
      household: clampHousehold({ ...s.household, [key]: value } as Household),
    })),
  setActorField: (actorId, key, value) =>
    set((s) => ({
      household: clampHousehold({
        ...s.household,
        actors: s.household.actors.map((a) =>
          a.id === actorId ? ({ ...a, [key]: value } as Actor) : a,
        ),
      }),
    })),
  addActor: (name, current_age) => {
    const id = newId('actor');
    const actor: Actor = {
      id,
      name: name ?? 'Spouse',
      current_age: current_age ?? 60,
      alive: true,
    };
    set((s) => ({
      household: { ...s.household, actors: [...s.household.actors, actor] },
      selection: { kind: 'person', id },
    }));
    return id;
  },
  removeActor: (id) => {
    let result: { ok: boolean; reason?: string } = { ok: true };
    set((s) => {
      if (s.household.actors.length <= 1) {
        result = { ok: false, reason: 'cannot remove the last actor' };
        return s;
      }
      if (s.household.primary_actor_id === id) {
        result = { ok: false, reason: 'cannot remove the primary actor' };
        return s;
      }
      // Drop ownership of accounts/streams from the removed actor.
      // Empty owners collapses to default (= primary), which is the
      // right behavior for survivor inheritance.
      const accounts = s.accounts.map((a) => {
        if (!a.owners || !a.owners.includes(id)) return a;
        const next = a.owners.filter((o) => o !== id);
        return { ...a, owners: next.length > 0 ? next : undefined };
      });
      return {
        accounts,
        household: {
          ...s.household,
          actors: s.household.actors.filter((a) => a.id !== id),
        },
        selection: { kind: 'none' as const },
      };
    });
    return result;
  },
  resetToSeed: () =>
    set(() => {
      autoEventsCache = null;
      mergedEventsCache = null;
      projectionCache = null;
      return {
        accounts: seedAccounts,
        household: seedHousehold,
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
      const blankHousehold: Household = {
        scenario_name: 'New scenario',
        horizon_age: 95,
        cash_account_id: cash.id,
        jurisdiction_account_id: jurisdiction.id,
        actors: [{ id: 'primary', name: 'Primary', current_age: 60, alive: true }],
        primary_actor_id: 'primary',
      };
      return {
        accounts: [economy, cash, jurisdiction],
        household: blankHousehold,
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
      const usedByHousehold =
        s.household.cash_account_id === id || s.household.jurisdiction_account_id === id;
      if (usedByHousehold) {
        result = {
          ok: false,
          reason: 'used by household (cash sink or jurisdiction)',
        };
        return s;
      }
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
      partialize: (s) => ({
        accounts: s.accounts,
        household: s.household,
        events: s.events,
        dollarMode: s.dollarMode,
        expandedNodes: Array.from(s.expandedNodes),
      }),
      // v1 → v2 migration: trigger a one-time download of the v1 blob so
      // the user can re-import it via the Import button if desired, then
      // return undefined to let Zustand fall back to the seed defaults.
      // We do NOT silently rewrite the v1 state into v2 — keeping the
      // migration in importScenarioJson keeps it testable in one place.
      migrate: (persisted, version) => {
        if (version < SCHEMA_VERSION) {
          downloadV1Backup(persisted);
          return undefined; // signals "use defaults"
        }
        return persisted as State;
      },
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
// hook subscribers.

let autoEventsCache: {
  accounts: AccountNode[];
  household: Household;
  result: TimelineEvent[];
} | null = null;

let projectionCache: {
  accounts: AccountNode[];
  household: Household;
  events: TimelineEvent[];
  result: YearlyProjection[];
} | null = null;

// Synthesize "auto-events" derived from declarative fields on accounts.
// Today: end_account events for income/expense streams whose end_age is
// less than the household horizon (anchored to the OWNER's age timeline);
// recurring rmd events on RMD-subject accounts (anchored to the OWNER's
// age 73). Derived on every read so the source account remains the
// single source of truth.
export function synthesizeAutoEvents(
  accounts: AccountNode[],
  household: Household,
): TimelineEvent[] {
  if (
    autoEventsCache &&
    autoEventsCache.accounts === accounts &&
    autoEventsCache.household === household
  ) {
    return autoEventsCache.result;
  }
  const result = computeAutoEvents(accounts, household);
  autoEventsCache = { accounts, household, result };
  return result;
}

function computeAutoEvents(
  accounts: AccountNode[],
  household: Household,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const primary = primaryActor(household);
  for (const a of accounts) {
    if (a.kind !== 'income' && a.kind !== 'expense') continue;
    if (a.end_age === undefined) continue;
    // Compare end_age against the OWNER's age at horizon (so partner
    // streams ending at partner's 67 don't get a synthetic end_account
    // when partner is 5 years younger).
    const owner = ownerActor(household, a);
    const ownerAgeAtHorizon = owner.current_age + (household.horizon_age - primary.current_age);
    if (a.end_age >= ownerAgeAtHorizon) continue;
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
      actor_id: owner.id,
    });
  }
  // RMD events: one recurring event per RMD-subject asset, ages 73 →
  // OWNER's age at household horizon. Anchored to owner so partner's
  // 401k drives RMDs from partner's 73, not primary's.
  const rmdStart = 73;
  for (const a of accounts) {
    if (a.kind !== 'asset') continue;
    if (!resolveSubjectToRmd(a)) continue;
    const owner = ownerActor(household, a);
    const ownerAgeAtHorizon = owner.current_age + (household.horizon_age - primary.current_age);
    if (ownerAgeAtHorizon < rmdStart) continue;
    out.push({
      id: `auto_rmd_${a.id}`,
      name: `RMD on ${a.name.toLowerCase()}`,
      description: `Auto-generated from ${a.name}.subject_to_rmd. IRS Uniform Lifetime Table; starts at ${owner.name}'s age ${rmdStart}.`,
      trigger_age: rmdStart,
      end_age: ownerAgeAtHorizon,
      kind: 'recurring',
      attached_account_ids: [a.id],
      parameters: {},
      actions: [{ type: 'rmd' }],
      auto_generated: true,
      actor_id: owner.id,
    });
  }
  return out;
}

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
  const household = useStore((s) => s.household);
  const events = useStore((s) => s.events);
  return mergedEvents(events, synthesizeAutoEvents(accounts, household));
}

// Import / export the full scenario as JSON. Carries the schema version
// so future migrations can detect old payloads. Selection / hover are
// excluded — they're ephemeral.
export interface ScenarioPayload {
  schemaVersion: number;
  exportedAt: string;
  accounts: AccountNode[];
  household: Household;
  events: TimelineEvent[];
}

// v1 payload shape, kept here for the migration path. Defined as the
// minimum subset we need to read; the engine no longer accepts it.
interface V1ScenarioPayload {
  schemaVersion?: 1;
  accounts: AccountNode[];
  actor: {
    current_age: number;
    horizon_age: number;
    cash_account_id: string;
    jurisdiction_account_id: string;
    scenario_name: string;
    filing_status?: 'single' | 'mfj';
  };
  events: TimelineEvent[];
}

function migrateV1ToV2(p: V1ScenarioPayload): ScenarioPayload {
  const primary: Actor = {
    id: 'primary',
    name: 'Primary',
    current_age: p.actor.current_age,
    alive: true,
  };
  const household: Household = {
    scenario_name: p.actor.scenario_name,
    horizon_age: p.actor.horizon_age,
    cash_account_id: p.actor.cash_account_id,
    jurisdiction_account_id: p.actor.jurisdiction_account_id,
    filing_status: p.actor.filing_status,
    actors: [primary],
    primary_actor_id: primary.id,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    accounts: p.accounts,
    household,
    events: p.events,
  };
}

export function exportScenarioJson(): string {
  const s = useStore.getState();
  const payload: ScenarioPayload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    accounts: s.accounts,
    household: s.household,
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
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.accounts)) return { ok: false, reason: 'missing or invalid `accounts` array' };
  if (!Array.isArray(obj.events)) return { ok: false, reason: 'missing or invalid `events` array' };

  // Detect v1 (has `actor`, no `household`) and migrate inline.
  let payload: ScenarioPayload;
  if (obj.household && typeof obj.household === 'object') {
    if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > SCHEMA_VERSION) {
      return {
        ok: false,
        reason: `schema version ${obj.schemaVersion} is newer than this app supports (${SCHEMA_VERSION}).`,
      };
    }
    payload = obj as unknown as ScenarioPayload;
  } else if (obj.actor && typeof obj.actor === 'object') {
    payload = migrateV1ToV2(obj as unknown as V1ScenarioPayload);
  } else {
    return { ok: false, reason: 'missing `household` (v2) or `actor` (v1) object' };
  }

  useStore.setState({
    accounts: payload.accounts.map(clampAccount),
    household: clampHousehold(payload.household),
    events: payload.events,
    selection: { kind: 'none' },
    hoveredEventId: null,
  });
  autoEventsCache = null;
  mergedEventsCache = null;
  projectionCache = null;
  return { ok: true };
}

export function useProjection(): YearlyProjection[] {
  const accounts = useStore((s) => s.accounts);
  const household = useStore((s) => s.household);
  const events = useStore((s) => s.events);
  const all = mergedEvents(events, synthesizeAutoEvents(accounts, household));
  if (
    projectionCache &&
    projectionCache.accounts === accounts &&
    projectionCache.household === household &&
    projectionCache.events === all
  ) {
    return projectionCache.result;
  }
  const result = project(accounts, household, all);
  projectionCache = { accounts, household, events: all, result };
  return result;
}
