# Roadmap

> **Status:** Phases 0, 0.5, 1, and 2 are complete. The schema, engine, UX patterns, documentation, and test suite are settled. Code lives in `mocks/main-view/`. Production deployment via `Dockerfile` + `docker-compose.yaml` (publishes to GHCR on push). 79 tests at ~3 s; engine.ts at 96.83% coverage.

## Phasing principle

The temptation after a working mock is to start adding big features (taxes, couples, RMDs, multi-scenario). We deliberately did *not* do that first. Instead:

> **Document and test before scaling features.**

Reasons:

- The documentation we write doubles as the spec for the test suite. End-to-end use cases are simultaneously *user docs* and *test fixtures*. Time spent writing them returns twice.
- The first real users (and the author's own retirement planning) will surface gaps the mock didn't reveal. Docs force us to walk every flow as a user; tests freeze the answers we don't want to break.
- A robust test suite makes a future rewrite (if we choose one) cheap. Without tests, "starting fresh" loses the validated semantics. With tests, a rewrite is a matter of getting the green bar back.
- Bracket-based taxes, RMDs, and household modeling all touch the engine. Refactoring the engine without engine tests is reckless.

Phases 0–2 were the gate; they are now closed. Phase 3 (taxes/household) and Phase 4 (Analysis) build on them. The ordering is load-bearing: most of Phase 4's intra-plan insights (bracket placement, RMD impact, lifetime-tax breakdowns) only make sense with bracket-aware numbers, so taxes have to land first.

---

## Phase 0 — Use-yourself viability

**Goal:** stop being a refresh-resets-everything demo. The author can plan their own retirement with this over a weekend.

**Why now:** the code already works for slider-driven exploration. What blocks "I'll use this for real" is data loss on refresh, no portability, and a bug crashing the whole UI. Cheap fixes; high return.

**Deliverables:**
- Engine memoization (shared cache across components).
- Error boundary at the app root.
- LocalStorage persistence (zustand `persist` middleware, schema-versioned).
- JSON export and import via the topbar.
- Basic input validation at the store boundary.

**Exit criteria:**
- Refresh preserves every account, event, and slider position.
- Closing the browser and reopening tomorrow shows yesterday's plan.
- A bug in any chart or inspector renders a fallback, not a blank page.
- Slider drag does not run the engine more than once per state change in aggregate (currently 3×).
- Author has used the tool for at least one real scenario without losing data.

**Effort:** small. One session.

---

## Phase 1 — Document the surface

**Goal:** capture user-facing documentation and a small library of canonical end-to-end use cases that can later be lifted into tests.

**Why now:** docs force us to walk every flow as a user. Anything ambiguous or awkward in the UX surfaces here, before tests calcify it. The use cases written here become the spine of Phase 2's test suite, so the work is dual-purpose.

**Deliverables:**

1. **`docs/USER_GUIDE.md`** — task-oriented user docs. Each section is "how to do X":
   - Setting up your accounts (importing the seed and editing).
   - Modeling income and expense streams.
   - Adding a one-shot event (sell house, NUA execution, market shock).
   - Adding a recurring event (Roth conversion ladder, ongoing contribution).
   - Reading the cone, the cash flow chart, the tooltips.
   - Save / load / export / import.

2. **`docs/USE_CASES.md`** — a numbered list of canonical end-to-end scenarios. Each has:
   - A narrative (what the user is trying to figure out).
   - A starting state (or seed reference).
   - A sequence of UI actions.
   - Expected observable outcomes (what's true on the chart afterward, with concrete numbers where deterministic).
   
   Initial set (extend as we discover more):
   - **UC1 Roth ladder ROI:** "Does an $80k/yr ladder from 65–72 leave me better or worse than no ladder, given my situation?"
   - **UC2 Florida move tax savings:** "How much do I save in lifetime taxes if I move from CA to FL at 70?"
   - **UC3 NUA on company stock:** "Should I exercise NUA on $400k of company stock with $80k basis at age 64?"
   - **UC4 Sequence-of-returns shock:** "What happens to my plan if equity drops 25% at age 72?"
   - **UC5 House sale at 75:** "If I downsize at 75, how much taxable gain hits, and what does it do to my net worth?"
   - **UC6 Budget shortfall and forced sales:** "Where does cash come from in the gap years between salary ending and SS starting?"
   - **UC7 Setting up from scratch:** start with empty state, build a household, place key events. Validates the create flows.

3. **`docs/SCHEMA.md`** (extracted from `DESIGN_NOTES.md`'s schema section) — pure reference doc for the `AccountNode` / `TimelineEvent` / `Actor` / `YearlyProjection` types. Useful for tests and future bracket-tax work.

**Exit criteria:**
- A new user (or future-self) can read `USER_GUIDE.md` and successfully build their household model without the mock author present.
- Every UC in `USE_CASES.md` has been walked through manually and the expected outcomes match observed behavior. Any discrepancies become bug tickets.
- `SCHEMA.md` is sufficient for someone writing engine tests without reading `DESIGN_NOTES.md`.

**Effort:** medium. Probably two sessions.

---

## Phase 2 — Test suite

**Goal:** lock in correctness so future engine changes (Phase 4 taxes especially) don't silently break working features.

**Why now:** the engine is pure, the schema is settled, and Phase 1 has handed us concrete fixtures. This is the cheapest tests will ever be to write — write them now, before couples and RMDs make the engine more complex.

**Deliverables:**

1. **Engine snapshot tests.** For the seed scenario and a small library of variants, snapshot the full `YearlyProjection[]` array. Cheap, comprehensive, catches any regression.

2. **Engine unit tests.** Per-action tests — `liquidate` on tax-deferred produces NUA-style ordinary+LTCG split; `transfer` on tax_deferred → tax_free taxes the conversion; `reparent` swaps the active jurisdiction; `add_value` with `|v|<1` is a fractional shock; `end_account` deactivates a stream; etc. One test per branch in the engine.

3. **Use case integration tests.** Each UC from `USE_CASES.md` becomes a test. Programmatic UI driving (React Testing Library) walks the same actions a user would, asserts the same outcomes the doc claims. When a UC's behavior changes, the test fails *and* the doc must be updated — they stay in lockstep.

4. **Auto-event derivation tests.** Setting `end_age` on a stream produces an auto-event; clearing it removes the auto-event; auto-events are not present in the user's stored events array; the engine sees them via the synthesizer.

5. **Persistence round-trip test.** State → export JSON → import JSON → equivalent state.

**Exit criteria:**
- `npm test` runs all of the above and is green.
- Test suite runs in under 10 seconds.
- Coverage of engine.ts and store.ts is north of 90%.
- Every UC in `USE_CASES.md` has a corresponding integration test.

**Effort:** medium. Vitest + React Testing Library. Probably two sessions.

**Note:** writing tests will surface bugs in the current implementation. Fix them as found; don't write tests that pass against broken behavior. The DESIGN_NOTES "gotchas" section already lists known places to look (drag rounding, tooltip clipping, etc.).

---

## Phase 3 — Tax model upgrade and household reality

**Goal:** make the tool actually correct for the target user persona's primary jobs.

**Why now:** Phase 2 tests are in place, so we can rip into the engine without breaking working users. This is the largest single piece of work in the roadmap and the most consequential — *the* gap between "demo" and "trustworthy planning tool." It's also a prerequisite for Phase 4: bracket placement views, RMD impact analyses, and lifetime-tax breakdowns all depend on bracket-aware numbers.

**Deliverables:**
- **Federal tax tables.** Bracket-based ordinary income, LTCG/qualified dividends. Data, not code (JSON or per-jurisdiction account fields). User-editable so non-US plug-ins work.
- **State tax tables.** Small library of common states (CA, FL, NY, TX, WA, MA, …) shipped as defaults; user can edit or add.
- **IRMAA tiers** based on MAGI.
- **`tax_deductible: bool` flag** on expense accounts (now safe with brackets — was deferred from Phase 0.5 for this reason).
- **RMD auto-events** derived from tax-deferred accounts when `current_age >= 73`. Uses the IRS Uniform Lifetime Table. Per-account `subject_to_rmd` flag, defaulting from `tax_treatment === 'tax_deferred'` so Roth 401(k) exceptions are explicit.
- **Step-up basis at horizon** (one primitive; tiny diff).
- **Couple / joint MFJ** with two `Actor`s, each with their own age, SS stream, RMD schedule, life-expectancy horizon. Survivor mechanics via an explicit "death of spouse" event in V1; richer survivor logic deferred to a 3.5 if it gets complex.

**Exit criteria:**
- The "FL move" use case reflects real federal+state bracket math, not a single effective rate.
- The "Roth ladder" use case shows the conversion's effect on future bracket placement, not just blended-rate savings.
- A couples scenario produces sensible joint filing taxes, two RMD schedules, and survivor-stage projections.
- All Phase 2 tests still pass (with snapshot updates for the new math, reviewed and intentional).

**Effort:** large. Probably a week.

---

## Phase 4 — Analysis

**Goal:** ship the read-only analytical layer of the app — both inter-plan comparison and intra-plan analysis. This is where the tool moves from "model your plan" to "evaluate your plan."

**Why now:** intra-plan insights (bracket placement diagrams, RMD impact, lifetime-tax breakdowns by source) only make sense with bracket-aware numbers from Phase 3. Inter-plan comparison was originally Phase 3 in an earlier roadmap; deferring and rolling it in here lets us build a coherent analysis surface once instead of incrementally bolting on related features.

**Deliverables — inter-plan (multi-scenario compare):**
- `Scenario[]` in the store: `{ id, name, accounts, actor, events }`. Multiple scenarios; one active for editing.
- Topbar dropdown to switch active scenario; duplicate / rename / delete affordances.
- Compare mode: pick two scenarios. Net-worth chart overlays both baselines with shaded gap. Cash-flow chart defaults to a difference view (B − A bars, sign-colored), with a header toggle to view A or B individually. Summary strip becomes deltas. Read-only.
- Persistence: JSON wraps `{ schemaVersion, scenarios, activeScenarioId }`. Bumps `schemaVersion` to `2`. Migration accepts v1 single-scenario files as a one-element list.

**Deliverables — intra-plan analysis:**
- **Year drill-down.** Click a year on the chart; right inspector switches to a "Year detail" view showing the full breakdown (income flows, asset sales, taxes by source/bucket, account-by-account changes for that year). Already partially in the cash-flow tooltip; promote to a first-class panel.
- **Sensitivity sliders.** Slider on key ambient values (equity yield, inflation rate, life expectancy) shows a *ghost* projection alongside the current one in real time. Dropping the slider commits the change; resetting reverts.
- **Bracket placement view.** For any year, show where ordinary income lands in the federal+state bracket stack. Highlights the *next bracket* and the dollars-to-cliff. Critical for Roth-conversion decisions.
- **RMD impact analysis.** For each tax-deferred account, project required distributions across the horizon and the cumulative ordinary tax they generate. Compare with vs without configured Roth conversions.
- **Lifetime tax breakdown.** A pie or stacked-bar by source (ordinary income / LTCG / conversion / event-driven / forced-sale). Exportable as CSV.
- **Sequence-of-returns stress test.** Apply a configurable shock (e.g., −25% equities) at a chosen age, view the resulting trajectory next to the unshocked baseline. A guided "what-if" rather than a permanent event.
- **Goal-seeking** (stretch). "What's the maximum sustainable annual spending given my assets and assumptions?" Iterates the projection at varying spending levels to find the boundary.

**UX shape (rough sketch):**
- Topbar gains an `Analysis` mode toggle (peer of edit mode).
- In Analysis mode, the editing affordances disappear; the right panel becomes an analysis selector ("Year detail," "Bracket placement," "Lifetime tax breakdown," etc.).
- Compare is a sub-mode of Analysis: pick A and B, charts overlay.
- Exiting Analysis returns to whichever scenario was active for editing.

**Exit criteria:**
- Build "Plan A: no Roth ladder" and "Plan B: Roth ladder 65–72," see the lifetime-tax delta and terminal net-worth delta in compare.
- For any year on the chart, drill in and see exactly what cash flowed where and what tax it generated.
- See bracket placement during a Roth conversion year — and how much room is left to the next bracket cliff.
- All Phase 2 tests still pass; new tests added for compare math, year-drill-down rendering, and sensitivity ghost behavior.

**Effort:** large. Probably 1–2 weeks. The intra-plan analyses can ship incrementally — year drill-down and bracket placement are highest-leverage and would land first.

---

## Phase 5 — Distribution

**Goal:** suitable for sharing beyond the author.

**Possible deliverables (pick based on intent):**
- Cloud sync (opt-in).
- Auth (Google, magic link).
- Telemetry + error reporting (Sentry-style).
- Mobile / responsive layout (or formally commit to desktop-only).
- Accessibility audit (keyboard nav, screen readers).
- Onboarding flow for empty state.
- Public landing page.

**Exit criteria:** depends on intent. Open to defining when we get there.

**Effort:** open-ended.

---

## Cross-cutting concerns (not phase-locked)

These should be considered at every phase but don't have a single completion point.

- **Performance budget:** slider drag should re-render at 60 fps for a 50-account, 30-event household. Memoize project + synthesizeAutoEvents at the store boundary; debounce nothing (debouncing kills the immediate-feedback feel that's a core differentiator).
- **Schema versioning:** every persisted blob gets `schemaVersion`. When the schema changes, write a migration and bump the version. Never break backward compatibility silently.
- **Privacy:** all data is local-first. No remote calls without explicit user opt-in. If/when cloud sync ships, encryption-at-rest is non-negotiable for financial data.
- **No `any`.** Strict TypeScript throughout. Discriminated unions over status flags.
- **Engine purity is sacred.** Any new feature that wants side effects (network, async, time-of-day) belongs in the store or a new layer, not the engine.

---

## What this roadmap is *not*

- Not a calendar. No dates, because estimates are aspirational.
- Not exhaustive. Things will be added as actual use surfaces them.
- Not a contract. If Phase 3's couples work reveals the schema needs to change, we update DESIGN_NOTES and re-run Phase 2 tests. The roadmap bends; the principles hold.

## Roadmap history

- The original Phase 3 was "Multi-scenario + compare" as a standalone step. After Phase 2 closed, we recognized that compare belongs to a larger "analysis" surface that also needs intra-plan tools (sensitivity sliders, year drill-down, bracket placement, RMD impact, lifetime-tax breakdowns). Compare alone would be a narrow feature that gets reworked when those land. So the original Phase 3 was rolled into the new Phase 4 (Analysis), tax/household work was promoted from Phase 4 to Phase 3, and the ordering was flipped to land bracket-aware numbers before the analytical layer that depends on them.
