# USE_CASES.md

> **Purpose.** Each use case (UC) describes one user-driven primitive — or a composition of primitives — and the resulting model state. The list is the spec for the integration test suite (Phase 2). Strategy-level scenarios ("plan a Roth conversion ladder optimized for my brackets") deliberately do *not* appear here; they live in `USER_GUIDE.md` and become testable only after templates ship.

## Conventions

- **Primitive UC:** one user action (one click + form fill) that produces one model mutation.
- **Composition UC:** a sequence of primitive actions whose resulting model state is unambiguous.
- **Invariant UC:** asserts on shape, stability, or round-trip fidelity rather than on a transition. Tagged `[invariant]`.
- **Resulting model state** is asserted as a *subset* match — UCs assert what changed; they don't enumerate the full state.
- **Engine implications** (when given) are informational, not asserted in the UC test. The engine layer covers numeric correctness separately.
- **Preconditions** are explicit. `seed` means the demo data; `blank` means a freshly-reset blank scenario; `UC<n>` means the resulting state of UC<n>.
- The list is intentionally framework-agnostic. Phase 2 picks the test runner (Vitest + RTL is the leading candidate); these descriptions translate.

## Index

- Layer 0 — Invariants & reset (UC1–UC3)
- Layer 1 — Plan settings & jurisdictions (UC4–UC6)
- Layer 2 — Accounts (UC7–UC8)
- Layer 3 — Streams (UC9–UC11)
- Layer 4 — Events: kind & wiring (UC12–UC15)
- Layer 5 — Action types (UC16–UC22)
- Layer 6 — Mutations on existing entities (UC23–UC25)
- Layer 7 — Read-only display (UC26–UC28)
- Layer 8 — Persistence (UC29–UC30)
- Deferred — strategy-level UCs awaiting templates / Phase 4 features

---

## Layer 0 — Invariants and reset

### UC1 — Seed loads and remains valid `[invariant]`

**Narrative.** First-time visitor or "Reset to demo" produces a complete, navigable demo scenario.

**Preconditions.** Cleared localStorage; or "Reset to demo" just clicked.

**User actions.** Open the app.

**Expected model state.**
- `accounts.length > 0`. Every `AccountNode.parent_id` is either `null` or references an existing `accounts[].id`.
- `actor.cash_account_id` references an existing asset.
- `actor.jurisdiction_account_id` references an existing ambient with `effective_tax_rate` defined.
- For every `events[].attached_account_ids[i]`, the referenced account exists.
- Selecting any account or event updates the Inspector to a non-empty editor.
- Both charts render without thrown errors.

**Engine implications.** The seed projection produces stable numeric outputs (covered separately by engine snapshot tests).

### UC2 — Reset to blank scenario

**Narrative.** User wipes the current plan and starts from a minimal scaffold.

**Preconditions.** Any state.

**User actions.**
1. Click `New ▾` in the topbar.
2. Click "Blank scenario".
3. Confirm the prompt.

**Expected model state.**
- `accounts` contains exactly three nodes: a `kind: 'ambient'` US Economy with the four typed yields and `inflation_rate`; a `kind: 'asset'` cash account with `asset_class: 'cash'`; a `kind: 'ambient'` jurisdiction with `effective_tax_rate` defined.
- `actor.cash_account_id` references the cash account.
- `actor.jurisdiction_account_id` references the jurisdiction node.
- `events.length === 0`.
- `selection.kind === 'actor'` (the ActorInspector opens immediately).

### UC3 — Reset to demo scenario

**Narrative.** User restores the demo data after experimenting.

**Preconditions.** Any state.

**User actions.** `New ▾` → "Reset to demo" → confirm.

**Expected model state.** Identical to UC1's invariants. (This UC is essentially "you can get back to UC1 from any state.")

---

## Layer 1 — Plan settings and jurisdictions

### UC4 — Edit Plan settings

**Narrative.** User edits scenario name, current age, and horizon age.

**Preconditions.** Any valid state.

**User actions.**
1. Click "Plan settings" at the top of the AccountsTree.
2. Type a new name in the title field.
3. Type a new value in the Current Age number input.
4. Drag the Horizon Age slider.

**Expected model state.**
- `actor.scenario_name === <typed value>`.
- `actor.current_age === <typed value>` (clamped to [0, 130], rounded).
- `actor.horizon_age === <slider value>` (clamped to `> current_age`, ≤ 130).

**Notes.** The clamp is enforced at the store boundary, not the input. Asserting on the resulting `actor` value (not the input field) is correct.

### UC5 — Add an ambient jurisdiction

**Narrative.** User creates a new state/jurisdiction with an effective tax rate.

**Preconditions.** Blank or demo state.

**User actions.**
1. Click `+ Add` in the AccountsTree header.
2. Click `Ambient` in the kind picker.
3. In the Inspector, rename the new node (e.g., "Connecticut").
4. Override the `effective_tax_rate` field, set it to a numeric value (e.g., 0.30).

**Expected model state.**
- A new `accounts[]` entry exists with `kind: 'ambient'`, `name === <typed>`, `effective_tax_rate` set to a number matching the entered value.
- `selection.kind === 'account'` referencing this new node.

### UC6 — Set actor's active jurisdiction

**Narrative.** User picks which jurisdiction's effective tax rate applies.

**Preconditions.** UC5 completed (at least one ambient with `effective_tax_rate` exists in addition to the default).

**User actions (path A — from the ambient node):**
1. Select the desired ambient node in the tree.
2. Click "Set as active jurisdiction" in the Inspector banner.

**User actions (path B — from Plan settings):**
1. Select "Plan settings".
2. Choose the desired ambient from the "Active jurisdiction" dropdown.

**Expected model state.**
- `actor.jurisdiction_account_id === <selected ambient's id>`.
- No change to `accounts`, `events`.

---

## Layer 2 — Accounts

### UC7 — Add an asset account

**Narrative.** User adds a balance-bearing asset (taxable holding, 401(k) lot, Roth holding, cash, or real estate).

**Preconditions.** Any valid state.

**User actions.**
1. `+ Add` → `Asset` in the AccountsTree.
2. In the Inspector: rename, set `custodian` (free-text tag), set `start_value`, optionally `cost_basis`, set `tax_treatment` and `asset_class` (today via direct edit on the node — the Inspector exposes them as derived from defaults).

**Expected model state.**
- A new `accounts[]` entry with `kind: 'asset'` and the typed fields.
- `parent_id` references the US Economy ambient (or whichever ambient was active when defaults applied).
- `selection` references the new node.

**Variants tested.** Run with `tax_treatment ∈ {'taxable', 'tax_deferred', 'tax_free'}` and `asset_class ∈ {'equity', 'bond', 'cash', 'real_estate'}`.

**Notes.** For `asset_class === 'cash'`, the cost_basis field is suppressed in the Inspector (it's meaningless for cash). The UC test asserts the field is *not* rendered when asset_class is cash.

### UC8 — Edit an asset's fields

**Narrative.** User adjusts an existing asset's start value, cost basis, custodian, or yield override.

**Preconditions.** UC7 completed (or seed asset selected).

**User actions.**
1. Select the asset.
2. Type a new value into the `start_value` number input.
3. Toggle the Yield "override" checkbox; drag the resulting slider.
4. Edit the custodian text input.

**Expected model state.**
- The mutation lands on the targeted account fields.
- Untouched fields are unchanged.
- The Yield override produces a `FieldValue` of either `number` (absolute) or `{mode: 'absolute' | 'delta', value: number}` depending on UI choice.

---

## Layer 3 — Streams

### UC9 — Add an income stream

**Narrative.** User models a salary, pension, or Social Security.

**Preconditions.** Any valid state.

**User actions.**
1. `+ Add` → `Income`.
2. In the Inspector: rename ("Salary"), set `annual_amount`, `start_age`, `end_age`, `growth_rate`.

**Expected model state.**
- New `accounts[]` entry with `kind: 'income'` and the typed fields.
- Field clamps applied: `start_age, end_age ∈ [0, 130]`, `end_age >= start_age`, `annual_amount >= 0`.

### UC10 — Add an expense stream

**Narrative.** Living expenses, healthcare, or other ongoing outflow.

**Preconditions.** Any valid state.

**User actions.** `+ Add` → `Expense`. Set fields per UC9.

**Expected model state.** New `accounts[]` entry with `kind: 'expense'` and the typed fields.

### UC11 — Auto-event derivation from end_age

**Narrative.** Setting `end_age` on a stream causes the engine to synthesize an `end_account` event in the timeline without the user creating it explicitly.

**Preconditions.** UC9 or UC10 completed; the stream has `end_age < actor.horizon_age`.

**User actions.** None beyond UC9/UC10.

**Expected model state.**
- The user's `events` array does *not* contain the auto-event (it's derived, not stored).
- `useAllEvents()` (or its equivalent derivation hook) returns an additional event with: `auto_generated: true`, `kind: 'one_shot'`, `attached_account_ids: [<stream.id>]`, `actions: [{type: 'end_account'}]`, `trigger_age: <stream.end_age>`.
- Marking on the auto-event row in the EventTimeline list (e.g., a `✱` glyph or "auto-generated" label) is present.
- Selecting the auto-event opens a *read-only* Inspector view with a "Open source account" affordance.

**Notes.** Decision documented in `DESIGN_NOTES.md`: auto-events are *derived on every projection*, not materialized into the events array.

---

## Layer 4 — Events: kind and wiring

### UC12 — Create a one-shot event

**Narrative.** User adds an event that fires at a single age.

**Preconditions.** Any valid state.

**User actions.**
1. Click `+ One-shot` in the EventTimeline header.
2. Pick an action type from the action picker.

**Expected model state.**
- New `events[]` entry with `kind: 'one_shot'`, `end_age: undefined`, `actions.length === 1` with `action.type` matching the pick.
- `attached_account_ids === []` (user attaches separately — UC14).
- `selection` references the new event.

### UC13 — Create a recurring event

**Narrative.** Event spans a range of ages.

**Preconditions.** Any valid state.

**User actions.** `+ Recurring` → pick action.

**Expected model state.** As UC12, but `kind: 'recurring'` and `end_age === trigger_age + 5` (default span).

### UC14 — Attach an event to one or more accounts

**Narrative.** User specifies which accounts an event mutates.

**Preconditions.** UC12 or UC13 completed; event selected.

**User actions.** Toggle checkboxes in the "Attached accounts" section of the EventInspector.

**Expected model state.**
- `event.attached_account_ids` matches the set of checked account ids.
- Order of attachment doesn't matter for the assertion (set equality).

### UC15 — Set event parameters

**Narrative.** User adjusts the shared parameter values an event's actions read at run time.

**Preconditions.** Event has at least one action with a `param_ref` (default for `transfer`, `add_value`, `set_value`).

**User actions.** Drag the parameter slider, or type into its number input.

**Expected model state.** `event.parameters[<key>] === <value>`.

---

## Layer 5 — Action types

Each UC in this layer asserts that the **resulting `event.actions[i]`** has the expected shape after the action editor is configured. Engine effects are not asserted here (engine tests cover them).

### UC16 — Configure a transfer action

**Narrative.** Move money between accounts (e.g., Roth conversion).

**User actions.** In the action editor: type=transfer, pick `target_account`, set `param_ref` to an existing parameter key.

**Expected model state.** `actions[i] === {type: 'transfer', target_account: <id>, param_ref: <key>}`.

**Notes.** Target account must exist in `accounts` (assertion: lookup succeeds). The source comes from `event.attached_account_ids` at runtime, not from the action.

### UC17 — Configure a liquidate action

**Narrative.** Sell an asset; deposit net proceeds into the actor's cash account.

**User actions.** type=liquidate. (No further fields — liquidate acts on the attached accounts.)

**Expected model state.** `actions[i] === {type: 'liquidate'}`.

### UC18 — Configure an add_value action with `field: 'start_value'`

**Narrative.** Apply a fractional shock or flat add to an asset's balance.

**User actions.** type=add_value, field=`start_value`, set a parameter (`param_ref` or `value`).

**Expected model state.** `actions[i].field === 'start_value'`, with `param_ref` or `value` set.

**Notes.** The engine convention `|v| < 1` → fractional shock vs `|v| >= 1` → flat add is documented in `DESIGN_NOTES.md`. UC tests assert the action *shape*; engine tests assert the math.

### UC19 — Configure an add_value action with `field: 'annual_amount'`

**Narrative.** Permanent shift to an income or expense stream's trajectory (e.g., −30% to home expenses from a target age forward).

**User actions.** type=add_value, field=`annual_amount`, set parameter.

**Expected model state.** `actions[i].field === 'annual_amount'`, with `param_ref` or `value` set.

**Notes.** This is the regression case for the silent-no-op bug fixed when annual_amount support was added to the engine. The integration test asserts the action shape; an engine test asserts that an attached stream's projected `expense_by_source[id]` drops by the expected fraction from the trigger age onward.

### UC20 — Configure a reparent action

**Narrative.** Future jurisdiction change (e.g., move to FL at 70).

**User actions.** type=reparent, pick `new_parent` from the ambient nodes.

**Expected model state.** `actions[i] === {type: 'reparent', new_parent: <ambient_id>}`.

**Notes.** Distinguished from UC6 (set initial jurisdiction via ActorInspector). UC6 changes `actor.jurisdiction_account_id` directly (no event). UC20 schedules a future change via an event. Both are valid; users pick based on whether the change is "now" or "at a future age."

### UC21 — Configure an end_account action

**Narrative.** Mark an attached income or expense account inactive at the trigger age. (Usually auto-generated — UC11 — but can be user-created for one-time end moves.)

**User actions.** type=end_account.

**Expected model state.** `actions[i] === {type: 'end_account'}`.

### UC22 — Compose multiple actions in one event

**Narrative.** A single event performs more than one mutation in sequence (e.g., NUA from scratch: liquidate the 401(k) lot AND deposit the basis-portion proceeds — though today the `liquidate` primitive handles this internally).

**User actions.**
1. Create event (UC12 or UC13).
2. Click `+ Add action` in the EventInspector.
3. Configure each action.

**Expected model state.** `event.actions.length > 1`; each action has the configured shape.

**Notes.** This UC stresses that actions are an array, ordered, and applied in sequence by the engine. Order matters for some compositions (e.g., transfer-then-set_value). The UC assertion checks order.

---

## Layer 6 — Mutations on existing entities

### UC23 — Delete an account

**Narrative.** User removes an account they no longer want.

**Preconditions.** Account exists.

**User actions.** Select account → click Delete → confirm.

**Expected model state.**
- The account is removed from `accounts`.
- Any `events[].attached_account_ids` are filtered to drop references to the removed id.
- `selection.kind === 'none'`.

**Constraints (assertion variants).**
- *Delete is blocked* when the target has children (`removeAccount` returns `{ok: false, reason: 'has children…'}`); the user is alerted; state unchanged.
- *Delete is blocked* when the target is the actor's `cash_account_id` or `jurisdiction_account_id`; alerted; state unchanged.

### UC24 — Delete an event

**Narrative.** User removes an event.

**Preconditions.** Event exists; not auto-generated.

**User actions.** Select event → click Delete → confirm.

**Expected model state.** Event removed from `events`. `selection.kind === 'none'`.

**Notes.** Auto-generated events cannot be deleted directly (their Inspector is read-only). To "delete" an auto-event, the user clears `end_age` on the source account — which is UC8.

### UC25 — Drag an event node on the chart

**Narrative.** User retimes an event by dragging its node above the net-worth chart.

**Preconditions.** Event exists; user-created (auto-generated events aren't draggable).

**User actions.** Pointer-down on the event's node → move horizontally → pointer-up.

**Expected model state.**
- `event.trigger_age === <integer matching the cursor x at pointer-up, clamped to [actor.current_age, actor.horizon_age]>`.
- For ranged events: dragging the "whole" handle preserves `end_age - trigger_age`; dragging a start or end handle moves only that endpoint.
- All age values are integers (no fractional drift — regression case for the rounding bug).

**Notes.** Auto-generated events do not respond to pointer-down (verified by attempting drag → state unchanged).

---

## Layer 7 — Read-only display

### UC26 — Net-worth chart tooltip

**Narrative.** Hovering a year shows baseline / best / worst values for that age.

**User actions.** Move pointer over the chart at age T.

**Expected behavior.** A tooltip appears containing labels matching `Baseline`, `Best`, `Worst`, with formatted dollar values. The label of the tooltip displays `Age T`.

**Notes.** The actual numeric values are deterministic given the seed and are covered by engine snapshot tests; the UC test asserts the tooltip *renders* with the right labels and structure.

### UC27 — Cash-flow chart tooltip

**Narrative.** Hovering a year shows a structured breakdown: Net at top, Income section, Outflows section with tax subrows.

**User actions.** Move pointer over the cash-flow chart at age T.

**Expected behavior.** A tooltip appears with:
- A header containing `Age T` and a `Net` value, color-coded green for non-negative or red for negative.
- An `Income · <total>` section with one row per income source plus optional `Event liquidation` and `Forced sale` rows when present.
- An `Outflows · <total>` section with one row per expense source plus a `Taxes` row, followed by `· ordinary` and `· LTCG` subrows.

**Notes.** Values in the tooltip are derived from the projection; engine tests cover the math. UC asserts on tooltip *structure*.

### UC28 — Toggle Nominal $ ↔ Today's $

**Narrative.** User switches the dollar mode and both charts update.

**User actions.** Click "Today's $" (or "Nominal $") in the topbar toggle.

**Expected model state.** `dollarMode === <selected>`. Both charts re-render.

**Engine implications.** All displayed dollar values divide by the cumulative inflation index when in `'real'` mode. (Engine snapshot test compares projection in nominal; UI test compares displayed labels.)

---

## Layer 8 — Persistence

### UC29 — Export and re-import preserves model state `[invariant]`

**Narrative.** Exporting JSON and importing it back is a round-trip.

**User actions.**
1. Click `Export`. Capture the downloaded JSON.
2. Click `New ▾` → "Reset to demo" → confirm. (State changes.)
3. Click `Import` → choose the captured file → confirm.

**Expected model state.** `accounts`, `actor`, `events` deep-equal their values before step 1.

**Notes.** Selection and hover are *not* round-tripped (intentional — they're ephemeral).

### UC30 — LocalStorage round-trip across page refresh `[invariant]`

**Narrative.** Refreshing the browser preserves all model state.

**User actions.**
1. Note the current `accounts` / `actor` / `events`.
2. Reload the page.

**Expected model state.** `accounts`, `actor`, `events`, `dollarMode`, `expandedNodes` deep-equal their pre-refresh values. `selection.kind === 'none'` (selection isn't persisted).

---

## Deferred — not testable until features land

These will become testable when their corresponding feature ships:

- **RMD auto-events** (Phase 3). When a `tax_deferred` account at `current_age >= 73` triggers an auto-event, the derivation rule becomes testable as an extension of UC11.
- **Step-up basis at horizon** (Phase 3). One primitive: at `actor.horizon_age`, taxable assets get `cost_basis = current balance`. UC test will assert on the resulting account state at the horizon year.
- **Couples / joint scenarios** (Phase 3). Two actors, two SS streams, joint vs separate filing.
- **Bracket-based tax math** (Phase 3). Replaces the single effective rate. UCs become testable for "Roth conversion at age X moves you into the Y% bracket" and "FL move at 70 saves $Z lifetime tax measured against real federal+state brackets."
- **Multi-scenario compare** (Phase 4 — Analysis). UC asserting that two named scenarios coexist and a compare view overlays both projections, with side-by-side or difference cash-flow rendering. Was originally planned as standalone Phase 3; rolled into the broader Analysis phase since intra-plan analyses share the same surface.
- **Intra-plan analysis** (Phase 4 — Analysis). Year drill-down, bracket placement diagrams, RMD impact, sensitivity sliders, lifetime-tax breakdown, sequence-of-returns stress test. UCs assert on the analysis panel's contents for a given year/scenario.
- **Templates / macros** (Phase 4 or later). When a "Roth conversion ladder" template exists as a single user action, the strategy-level UC ("user invokes the template, resulting events match the template's expansion") becomes testable. Until then, see UC15+UC16 for the underlying primitive.
- **Death and inheritance UI** (post-Phase 4). Step-up basis primitive lands in Phase 3; full inheritance modeling comes later.

---

## Notes for Phase 2 (test implementation)

- **Test seam.** The store is the seam; tests drive the UI and assert on `useStore.getState()`. Engine tests bypass the UI entirely and call `project()` directly with fixture data.
- **Fixture sharing.** The seed (`seedAccounts`, `seedActor`, `seedEvents`) is the canonical engine-test fixture for the demo case. UC results can be exported to JSON and used as additional engine-test fixtures.
- **Invariant UCs run on every commit.** UCs 1, 11, 29, 30 are cheap and load-bearing. Keep them in a fast smoke suite separate from the slower integration suite.
- **When a UC becomes unwritable or untestable**, the response is *not* to write a contorted UC. It's to file a UX/architecture gap, fix it, then write the UC. This document lists what's testable today; growth happens by fixing what isn't.
