# SCHEMA.md

Reference for the data types and engine contract. Sufficient for someone writing engine tests, an alternative UI, or a future engine implementation without reading the full `DESIGN_NOTES.md`. Schema decisions and rationale live in `DESIGN_NOTES.md`; the testable spec lives in `USE_CASES.md`; user-facing prose lives in `USER_GUIDE.md`.

This document is mechanical. Decisions are stated, not justified. For "why did we choose X," follow the cross-reference to `DESIGN_NOTES.md`.

## Top-level entities

Three arrays plus one singleton make up a complete scenario:

```ts
{
  accounts: AccountNode[];   // the tree (parent_id links nodes)
  actor: Actor;              // the household; one per scenario
  events: TimelineEvent[];   // user-created events on the timeline
}
```

Plus a derived/synthesized layer:

```ts
all_events = [...events, ...synthesizeAutoEvents(accounts, actor)]
projection = project(accounts, actor, all_events)  // YearlyProjection[]
```

Auto-events are not stored; they're computed from declarative fields on accounts. The engine sees the merged `all_events` array.

---

## `AccountNode`

A node in the account tree. Every kind of "thing the model tracks" — investment lots, real estate, income streams, expense streams, jurisdictions, the macro economy — is an AccountNode.

```ts
interface AccountNode {
  id: string;
  name: string;
  kind: AccountKind;
  parent_id: string | null;

  // Tags / metadata. Do NOT participate in inheritance.
  asset_class?: AssetClass;
  tax_treatment?: TaxTreatment;
  custodian?: string;

  // Per-asset-class yields, typically defined on ambient parents.
  // Inherited via by-type lookup (see Inheritance).
  equity_yield?: FieldValue;
  bond_yield?: FieldValue;
  cash_yield?: FieldValue;
  real_estate_yield?: FieldValue;

  // Other inheritable rates.
  inflation_rate?: FieldValue;
  effective_tax_rate?: FieldValue;

  // Per-asset values.
  start_value?: number;
  yield_rate?: FieldValue;        // explicit per-asset override
  cost_basis?: number;

  // Per-stream values.
  start_age?: number;
  end_age?: number;
  annual_amount?: number;
  growth_rate?: FieldValue;
}

type AccountKind =
  | 'category'   // structural grouping; no balance, no flows
  | 'ambient'    // ambient/economic value (yields, inflation, jurisdiction)
  | 'asset'      // grows by yield; balance is `start_value` mutated by the engine
  | 'liability'  // negative balance; grows by interest_rate (today: under-implemented)
  | 'income'     // produces cash into the cash sink
  | 'expense';   // consumes cash from the cash sink

type AssetClass = 'equity' | 'bond' | 'cash' | 'real_estate' | 'other';
type TaxTreatment = 'taxable' | 'tax_deferred' | 'tax_free';
```

### Per-kind field relevance

Not every field applies to every kind. The Inspector and engine both branch on `kind`. This table is the canonical answer to "what does this field mean for a node of kind X?"

| Field | category | ambient | asset | income | expense | liability |
|---|---|---|---|---|---|---|
| `id`, `name`, `kind`, `parent_id` | required | required | required | required | required | required |
| `asset_class` | — | optional* | required | — | — | — |
| `tax_treatment` | — | — | required for sequencing | — | — | required |
| `custodian` | — | — | optional tag | — | — | optional |
| `equity_yield`, `bond_yield`, `cash_yield`, `real_estate_yield` | — | typically set | inheritable from parents | — | — | — |
| `inflation_rate` | — | typically set | — | — | — | — |
| `effective_tax_rate` | — | set on jurisdictions | — | — | — | — |
| `start_value` | — | — | required (current balance) | — | — | required (negative) |
| `yield_rate` | — | — | optional override on the typed yield | — | — | required (interest rate) |
| `cost_basis` | — | — | meaningful for `taxable` and `tax_deferred` (NUA) | — | — | — |
| `start_age` | — | — | — | required | required | — |
| `end_age` | — | — | — | optional (drives auto-event) | optional | — |
| `annual_amount` | — | — | — | required (base) | required (base) | — |
| `growth_rate` | — | — | — | required | required | — |

\* `asset_class` on an ambient is rare but allowed — it's how the seed's old "amb_equity" structure worked before being collapsed into US Economy's typed yields. New code should put typed yields directly on the ambient parent.

### Inheritance

A field declared as `FieldValue` may be inherited from a parent. Inheritance walks the parent chain leaf-to-root, returning the first explicit value, with overrides applied along the way.

```ts
type FieldValue =
  | undefined                                            // inherit (no contribution)
  | number                                               // explicit absolute
  | { mode: 'absolute'; value: number }                  // explicit absolute
  | { mode: 'delta'; value: number };                    // additive on inherited
```

Resolution algorithm (from the engine):

1. Walk the parent chain from leaf to root, collecting each defined value.
2. From root toward leaf, fold:
   - `number` → replaces accumulator with that value.
   - `{mode: 'absolute', value}` → replaces accumulator with `value`.
   - `{mode: 'delta', value}` → adds `value` to the current accumulator (or to 0 if no accumulator yet).
3. If no explicit value is found, the resolved value is `undefined`.

**Typed-yield lookup for assets.** When the engine grows an asset, it doesn't read `yield_rate` directly. It looks for the typed yield field corresponding to the asset's `asset_class`:

| `asset_class` | field name walked up the chain |
|---|---|
| `equity` | `equity_yield` |
| `bond` | `bond_yield` |
| `cash` | `cash_yield` |
| `real_estate` | `real_estate_yield` |
| `other` | (none — yield is 0 unless overridden) |

The asset's own `yield_rate`, if present, is then applied as either an absolute override or a delta on top of the inherited typed yield.

---

## Auto-events

Synthesized from declarative fields on accounts at projection time. Not stored. Today, only one synthesis rule:

**Rule.** For each account where `kind ∈ {'income', 'expense'}` and `end_age !== undefined` and `end_age < actor.horizon_age`, synthesize:

```ts
{
  id: `auto_end_${account.id}`,
  name: `End ${account.name.toLowerCase()}`,
  description: `Auto-generated from ${account.name}.end_age = ${end_age}.`,
  trigger_age: account.end_age,
  end_age: undefined,
  kind: 'one_shot',
  attached_account_ids: [account.id],
  parameters: {},
  actions: [{ type: 'end_account' }],
  auto_generated: true,
}
```

Auto-events appear in `useAllEvents()` but not in `useStore.events`. They are read-only in the Inspector. Drag is disabled.

Future synthesis rules (RMDs, step-up basis, etc.) follow the same pattern: derive at projection time from declarative fields, mark `auto_generated: true`, no UI for editing them directly.

---

## `TimelineEvent`

```ts
interface TimelineEvent {
  id: string;
  name: string;
  description?: string;

  trigger_age: number;
  end_age?: number;            // present → ranged

  kind: 'one_shot' | 'recurring';

  attached_account_ids: string[];
  parameters: Record<string, number>;
  actions: ActionTemplate[];

  auto_generated?: boolean;    // synthesized from declarative state
}
```

### Firing semantics

```ts
function eventFires(e: TimelineEvent, age: number): boolean {
  if (e.kind === 'one_shot') return e.trigger_age === age;
  const end = e.end_age ?? e.trigger_age;
  return age >= e.trigger_age && age <= end;
}
```

Events fire at the **start of the year**, before income/expense flows are computed. A one-shot event with `trigger_age: 72` fires once at year 72 and never again. A recurring event with `trigger_age: 65, end_age: 72` fires at ages 65, 66, 67, 68, 69, 70, 71, and 72 — eight times.

`trigger_age` and `end_age` MUST be integers. The store rounds on every write (drag math produces fractional values otherwise; see `DESIGN_NOTES.md` gotchas).

### Application order

For each firing event, in order:
1. For each `attached_account_id` (or once with synthetic empty id if `attached_account_ids === []`):
   - For each `action` in `actions`, in order, apply to that account.

If `attached_account_ids === []` and an action references the actor (e.g., `reparent`), the action runs once with no account context.

### Parameters are shared

`event.parameters` is a single map shared across all attached accounts. To apply different values to different accounts, create separate events. This is intentional; it keeps the event semantics simple and aligns with how strategies are reasoned about (e.g., "the same shock applied to all my equity holdings"). Per-attachment parameter overrides are not in scope.

---

## `ActionTemplate`

```ts
interface ActionTemplate {
  type: ActionType;
  field?: string;
  value?: number;
  param_ref?: string;       // if set, engine reads from event.parameters[param_ref] instead of value
  target_account?: string;  // for transfer / certain liquidate variants
  new_parent?: string;      // for reparent
}

type ActionType =
  | 'set_value'
  | 'add_value'
  | 'transfer'
  | 'liquidate'
  | 'reparent'
  | 'end_account';
```

### Per-action-type semantics

The runtime value `v` is `event.parameters[action.param_ref] ?? action.value ?? 0`.

#### `set_value`

Overwrite a numeric field on the attached account.

| `field` | Effect |
|---|---|
| `start_value` or `balance` | `acc.balance = v` |
| `annual_amount` | `acc.node.annual_amount = v` |
| anything else | no-op (silent — to be tightened) |

#### `add_value`

Mutate a numeric field by adding (or scaling, when `|v| < 1`).

| `field` | Effect |
|---|---|
| `start_value` or `balance` | `\|v\| < 1` → `acc.balance *= 1 + v`; otherwise → `acc.balance += v` |
| `annual_amount` | `\|v\| < 1` → `acc.node.annual_amount *= 1 + v`; otherwise → `acc.node.annual_amount += v` |
| anything else | no-op (silent — to be tightened) |

The `|v| < 1` heuristic is intentional: it lets the same action express both "shock by −25%" (`v = -0.25`) and "add $5,000" (`v = 5000`). At the dollar magnitudes this app handles, ambiguity (was 0.5 meant as $0.50 or 50%?) doesn't arise.

When `add_value` mutates `annual_amount` on a stream, the effect is permanent on the stream's trajectory: subsequent years compound from the new base. The `start_age` is NOT reset — the engine's compounding formula `annual_amount × (1 + growth_rate)^(age - start_age)` continues from the original anchor with the new base.

#### `transfer`

Move money between accounts.

```ts
const amt = Math.min(v, source.balance);   // source = attached account
source.balance -= amt;
target.balance += amt;                      // target = action.target_account
if (source.tax_treatment === 'tax_deferred') {
  // Roth-conversion-style: tax the converted amount as ordinary income.
  const tax = amt * jurisdictionTaxRate(...);
  taxes_ordinary += tax;
  cash_account.balance -= tax;
}
```

`target_account` must be set. If not, the action no-ops.

#### `liquidate`

Sell an attached asset; deposit net proceeds into the actor's cash sink; close the asset.

```ts
const proceeds = acc.balance;
const basis = acc.basis;
const gain = max(0, proceeds - basis);
let tax = 0;

if (acc.tax_treatment === 'tax_deferred') {
  // NUA-style: basis at ordinary, gain at LTCG.
  const ord = basis * rate;
  const ltcg = gain * rate * 0.6;
  taxes_ordinary += ord;
  taxes_ltcg += ltcg;
  tax = ord + ltcg;
} else if (acc.tax_treatment === 'taxable' || undefined) {
  // Real-estate gets the $500k MFJ exclusion.
  const exclusion = acc.asset_class === 'real_estate' ? 500_000 : 0;
  const taxableGain = max(0, gain - exclusion);
  const ltcg = taxableGain * rate * 0.6;
  taxes_ltcg += ltcg;
  tax = ltcg;
}
// tax_free → tax = 0

const net = proceeds - tax;
cash_account.balance += net;
acc.balance = 0;
acc.basis = 0;
acc.active = false;
event_liquidation_proceeds += net;
```

The 0.6 multiplier is a proxy for LTCG-as-fraction-of-ordinary; bracket-aware math will replace this in Phase 4.

#### `reparent`

Swap the actor's active jurisdiction.

```ts
if (action.new_parent) {
  sim.jurisdiction_id = action.new_parent;
}
```

This is the only action that mutates `Actor` rather than an attached account. `attached_account_ids` is typically empty for reparent events. (The engine calls `applyAction` once with a synthetic empty id when `attached_account_ids === []`, so reparent works with no attachments.)

There are two distinct ways to set jurisdiction in the model:
- `actor.jurisdiction_account_id = X` directly (initial residence).
- `reparent` event firing at a future age (planned move).

Both end up with the engine using a different jurisdiction's `effective_tax_rate` from a particular year onward.

#### `end_account`

Mark an attached account inactive at the trigger age. Inactive accounts don't grow, don't produce/consume cashflow, and don't contribute to portfolio totals.

```ts
acc.active = false;
```

Used by auto-events (UC11) and by user-created "stop this stream" events.

---

## `Actor`

```ts
interface Actor {
  current_age: number;
  horizon_age: number;
  cash_account_id: string;            // points at an asset, kind === 'asset'
  jurisdiction_account_id: string;    // points at an ambient with effective_tax_rate
  scenario_name: string;
}
```

Constraints (enforced at the store boundary by `clampActor`):

- `current_age ∈ [0, 130]`, integer
- `horizon_age > current_age`, ≤ 130
- `cash_account_id` and `jurisdiction_account_id` should reference existing accounts; the engine assumes this and may throw if they don't

V1 is single-actor (modeled as one MFJ filer). Multi-actor (couples) is Phase 4.

---

## `YearlyProjection`

The engine output. One element per year from `actor.current_age` through `actor.horizon_age` inclusive.

```ts
interface YearlyProjection {
  age: number;
  year: number;             // calendar year corresponding to `age`

  // Net worth across the three scenarios.
  total_baseline: number;
  total_best: number;
  total_worst: number;

  by_account: Record<string, number>;   // asset balances at end of year, keyed by id

  // Tax breakdown.
  taxes_paid: number;       // total
  tax_ordinary: number;
  tax_ltcg: number;

  // Cashflow breakdown for the cash-flow chart.
  income_received: number;                 // total income across all sources
  expenses_paid: number;                   // total expenses across all sources
  income_by_source: Record<string, number>;   // keyed by income account id
  expense_by_source: Record<string, number>;  // keyed by expense account id
  event_liquidation_proceeds: number;      // net proceeds from `liquidate` events
  forced_sale_proceeds: number;            // net proceeds from withdrawals to cover negative cash

  // Inflation tracking.
  cumulative_inflation_index: number;      // 1.0 at start; UI divides by this for "Today's $"

  events_this_year: TimelineEvent[];        // events that fired this year (baseline scenario only)
}
```

Decisions worth noting:

- All values are nominal dollars. The UI divides by `cumulative_inflation_index` for the Real / Today's $ display mode.
- The three-scenario cone (`baseline`, `best`, `worst`) is computed by running the engine three times with a constant return shift applied per year. Best / worst differ from baseline by `± env.volatility_range` applied to equity yield (and 0.4× to bond yield, none to cash). This is a horizon-shock model, not annual independent volatility — see `DESIGN_NOTES.md`.
- `events_this_year` is populated only from the baseline scenario's run. Best/worst runs use the same events but don't redundantly populate the array.

---

## Engine contract

```ts
function project(
  accounts: AccountNode[],
  actor: Actor,
  events: TimelineEvent[],     // typically merged user + auto-events
): YearlyProjection[]
```

**Pure.** Same inputs → same outputs. No I/O, no async, no global state. This is a hard constraint; it makes the engine snapshot-testable and lets the UI re-run on every state change.

### Annual loop (per scenario)

For each scenario in `[baseline (+0), best (+volatility), worst (-volatility)]`:

For each year from `current_age` through `horizon_age`:

1. **Evolve inflation.** `inflation_index *= 1 + resolveInflation()`. Only after year 0 (start year stays at 1.0).
2. **Apply triggered events.** Filter `events` by `eventFires(event, age)`. For each, iterate `attached_account_ids × actions`. Each action mutates one account or the actor.
3. **Apply income & expense streams.** For each active income/expense account:
   - `amount = annual_amount × (1 + growth_rate)^(age - start_age)`
   - For income: `cash += amount × (1 - effective_tax_rate)`; track ordinary tax.
   - For expense: `cash -= amount`.
4. **Cover negative cash with forced sales.** If cash went negative this year, withdraw from assets in order: `taxable → tax_deferred → tax_free`. Tax-deferred withdrawals gross-up by `1 / (1 - tax_rate)` and pay ordinary tax. Taxable withdrawals pay LTCG (proxy 0.6×) on the gain portion.
5. **Grow assets.** For each active asset: `balance *= 1 + effectiveYield`. Apply scenario shift: full to equity, ~0.4× to bonds, none to cash.
6. **Record snapshot.** Push the year's `YearlyProjection`.

### Tax classification

Every tax accrual must be classified as `ordinary` or `ltcg` at the source. Aggregating only `taxes_paid` loses information the user needs.

| Source | Bucket |
|---|---|
| Salary / SS / pension / other ordinary income | ordinary |
| Roth conversion (`transfer` from `tax_deferred`) | ordinary |
| `tax_deferred` liquidation: basis portion | ordinary |
| `tax_deferred` liquidation: gain portion | ltcg (proxy 0.6×) |
| `taxable` liquidation: gain over exclusion | ltcg |
| Forced withdrawal from `tax_deferred` | ordinary |
| Forced withdrawal from `taxable`: gain part | ltcg |

The 0.6× proxy is a coarse stand-in until bracket math lands.

### Withdrawal sequencing

When the cash account would go negative:

1. Walk active assets in order: `taxable → tax_deferred → tax_free`.
2. For each candidate, compute `gross_needed`:
   - For `tax_deferred`: `need / (1 - tax_rate)` (gross up because withdrawal is taxed).
   - Otherwise: `need`.
3. `take = min(gross_needed, balance)`. Reduce balance. Compute net (after tax for tax-deferred). Record tax. Reduce remaining `need` by net.

Halts when `need <= 0` or all assets exhausted. If exhausted: cash stays at 0 and the next-year projection reflects insufficient assets.

---

## Persistence

State is auto-persisted to `localStorage` under key `financial-modeler-v1` via Zustand's `persist` middleware. Schema version: `1`.

What's persisted:

```ts
{
  accounts: AccountNode[],
  actor: Actor,
  events: TimelineEvent[],
  dollarMode: 'nominal' | 'real',
  expandedNodes: string[],     // Set converted to array on persist
}
```

What is **not** persisted:

- `selection` (ephemeral; reset on reload)
- `hoveredEventId` (ephemeral)
- Auto-events (derived; never stored)
- Projection (derived; recomputed on every read)

### JSON export/import

`exportScenarioJson()` returns:

```ts
{
  schemaVersion: 1,
  exportedAt: <ISO string>,
  accounts, actor, events,
}
```

`importScenarioJson(json)`:

- Rejects payloads with no recognizable shape (`accounts`/`actor`/`events` missing or wrong type).
- Rejects payloads with `schemaVersion` newer than this app supports (forward-incompatibility error).
- Applies `clampAccount` and `clampActor` defensively to each imported entity.
- Resets `selection` and `hoveredEventId`.
- Invalidates the engine memoization caches.

### Schema migrations

When the schema changes in a backward-incompatible way, bump `SCHEMA_VERSION` and add a migration function consumed by Zustand `persist`'s `migrate` hook (or by `importScenarioJson` for imported payloads). Never break old saves silently.

---

## Validation rules (clamps)

Enforced at every store-write boundary. Defensive: imports and direct mutations both go through these.

`clampAccount(node)`:

- `start_age, end_age ∈ [0, 130]`, rounded.
- `end_age >= start_age` when both defined.
- `start_value >= 0` for `kind === 'asset'`.
- `annual_amount >= 0` for `kind ∈ {'income', 'expense'}`.
- `cost_basis >= 0`.

`clampActor(actor)`:

- `current_age ∈ [0, 130]`, rounded.
- `horizon_age > current_age`, ≤ 130.

`setEventAge(id, trigger, end)`:

- `Math.round(trigger)` and `Math.round(end ?? existing)` — never store fractional ages.

---

## Test seam

For Phase 2 (test suite):

- **Engine tests** import `project` from `engine.ts` directly with fixture inputs. No React, no DOM, no store. Pure-function in/out.
- **UC integration tests** drive the UI (React Testing Library or equivalent), then assert on `useStore.getState()`. They do not assert on projection values.
- **Fixture sharing.** The seed (`seedAccounts`, `seedActor`, `seedEvents`) is the canonical engine-test fixture. UC tests can dump their resulting state to a JSON fixture file consumed by additional engine snapshot tests.
- **Round-trip tests** (UC29, UC30) validate that persistence and JSON export/import are lossless on the persisted subset.

---

## Cross-references

- **Why this shape:** `DESIGN_NOTES.md` sections 2–4.
- **What's testable today:** `USE_CASES.md`.
- **How to use this in practice:** `USER_GUIDE.md`.
- **What's missing:** `ROADMAP.md` (Phases 3+).
