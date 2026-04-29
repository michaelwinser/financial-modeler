# USER_GUIDE

How to use the Financial Modeler to plan your own situation. This doc is task-oriented: each section is "how to do X." For the precise UI sequences and the assertions about resulting state, see [`USE_CASES.md`](USE_CASES.md). For the data model and engine semantics, see [`DESIGN_NOTES.md`](DESIGN_NOTES.md). For the work plan, see [`ROADMAP.md`](ROADMAP.md).

## What this is

A local-first, deterministic, event-driven retirement planner. It is built for someone who *can* retire but hasn't yet — your primary jobs are wealth preservation, tax planning, and inheritance planning, not long-term accumulation. The tool's job is to let you ask "what happens to my net worth and lifetime taxes if I do X?" and see an answer that updates as you slide the inputs.

Configuration *is* the model: a tree of accounts plus a list of timeline events. Everything you see in the UI maps to fields on those structures. The engine is a pure function from your configuration to a year-by-year projection. There is no hidden state.

All your data lives in your browser's localStorage. Nothing is sent over the network. To back up or move your plan, export a JSON file (see *Saving and sharing*).

## Mental model in one paragraph

Everything is an account. Your investment lots, your house, your salary, your living expenses, *and* environmental things like inflation or your tax jurisdiction — all of them are nodes in one tree. Children inherit values from their parents (an equity holding inherits its growth rate from the "US Economy" ambient parent). Events live separately on a timeline; each event attaches to one or more accounts and mutates them at a chosen age. Your job in this app is to build the tree and place the events; the engine's job is to project forward.

## Getting started

The first time you open the app, a demo household is loaded. Use it to explore the UI without commitment. When you're ready, you have two options:

- **Reset to demo** (the default state) — `New ▾` → `Reset to demo`. Restores the demo if you've made changes.
- **Blank scenario** — `New ▾` → `Blank scenario`. Wipes everything and gives you a minimal scaffold (a US Economy ambient with default yields, a cash account, and a placeholder jurisdiction) so you can build your own plan from scratch.

The screen has three panes:

- **Left:** the Accounts tree. Click `+ Add` at the top to create new accounts.
- **Center:** Summary stats, the net-worth projection chart, the cash-flow bar chart, and the timeline events list.
- **Right:** the Inspector. Edits whatever you've selected — an account, an event, or your overall Plan settings.

At the very top of the Accounts tree there's a **Plan settings** row. Click it first.

## Setting up your plan

Plan settings is where your overall scenario lives — your name for it, your current age and horizon age, which account is your cash sink, and which jurisdiction's tax rate applies. (See UC4.)

**Scenario name.** Free text. Shows in the topbar.

**Current age.** Where the projection starts. Most calculations are anchored here.

**Horizon age.** Where the projection ends. Defaults to 95. Income/expense streams that don't have an explicit `end_age` run through the horizon. The cone widens as the horizon extends — this is by design.

**Cash sink.** The account that serves as the operating cash account. Income flows in here (net of tax); expenses flow out. When the balance goes negative, the engine forces sales from your other assets to cover the gap (see *Forced sales* below). You almost never need to change this; the default points at "Cash & reserves."

**Active jurisdiction.** The ambient node whose `effective_tax_rate` applies to your ordinary income, withdrawals, and conversions. The demo defaults to California (32% blended). To live somewhere else, see the next section.

### Modeling where you live

Your active jurisdiction is one of the bigger levers in the tool. The demo has California and Florida baked in. To use a different state, create your own ambient and set it active. (See UC5 and UC6.)

1. In the Accounts tree, click `+ Add` → `Ambient`.
2. Rename to your state (e.g., "Connecticut").
3. Toggle "override" on `effective_tax_rate` and slide it (or type) to your blended federal+state rate.
4. With the new state still selected, click "Set as active jurisdiction" in the inspector banner.

A reasonable starting effective rate is 22% if you're in a no-state-income state and your AGI is moderate; 28–34% in higher-tax states. You can refine this once you've actually run a scenario through it. The roadmap's Phase 4 replaces blended rates with bracket-based math; until then, use a rate that reflects your current marginal-plus-state mix.

To model **moving** at a future age (rather than your starting residence), don't change the active jurisdiction. Create a `reparent` event instead — see *Modeling life events* below.

## Modeling assets

An asset is anything that holds value and grows. Investment lots, your house, cash. (Liabilities are a separate kind, currently best modeled by a negative-yielding asset until proper liability support lands.)

When you click `+ Add` → `Asset` (UC7), you get a new asset with sensible defaults: equity asset class, taxable tax treatment, a 0 balance. Edit it in the Inspector.

**Start value.** What's in this lot today. Type the precise amount in the number input next to the slider; the slider is for exploration.

**Cost basis** (taxable assets). Your basis matters when the asset is liquidated — gains are taxed; basis is returned tax-free. For tax-deferred accounts, basis is meaningless on most lots (everything comes out as ordinary income); the exception is an NUA-eligible company-stock lot where basis is taxed at ordinary and gains at LTCG. For Roth accounts, basis is meaningless (everything is tax-free). For cash, the field doesn't appear.

**Yield.** By default, an asset inherits its growth rate from the nearest ambient parent that defines a yield for its asset class (typically `US Economy.equity_yield`, etc.). You can override per-asset by checking "override" on the Yield field. This is useful for "this stock is overweighted on tech, expected to grow 9% not 7%" or "this lot is a fixed-income product yielding exactly 5%." The override can be either an absolute value or a delta; today the UI exposes only the absolute form.

**Custodian.** A free-text tag. Use it for "Schwab," "Fidelity 401(k)," "Vanguard Roth IRA," etc. Currently it's display-only — it doesn't drive the engine — but it's the right place to write down which institution holds the lot. When the app eventually grows a "view by custodian" toggle, this is what feeds it.

**Asset class.** Determines which yield gets inherited. Pick `equity`, `bond`, `cash`, or `real_estate`.

**Tax treatment.** Determines withdrawal sequencing and how gains are taxed. Pick `taxable`, `tax_deferred`, or `tax_free`. Roth accounts → `tax_free`. 401(k)s, traditional IRAs, traditional pensions → `tax_deferred`. Brokerage accounts and CDs → `taxable`. (Roth conversions and ladder strategies go between these — see *Roth conversion ladder* below.)

### A useful simplification

Asset class drives yield. Tax treatment drives withdrawal taxation. The two are independent: a 401(k) (tax-deferred) can hold equities (which grow at the equity yield), bonds (bond yield), or cash (cash yield). Model each lot as its own account. This is more granular than what most people do mentally, but it's faster to enter than it sounds and the projection accuracy is much better than treating "401(k)" as one blob.

## Modeling income and expenses

Streams (income and expense) are accounts whose balance over time is computed from `annual_amount × (1 + growth_rate)^(years since start_age)`. They flow through the cash account each year between `start_age` and `end_age`.

**Salary.** `+ Add` → `Income`. Set `annual_amount` to your gross. Set `start_age` to your current age (or wherever the income begins). Set `end_age` to when the salary stops — usually retirement. Set `growth_rate` to expected annual raises (3% is a fine default). When you set `end_age`, the timeline auto-generates an `End <name>` event at that age (UC11) — visible in the timeline list with a `✱` glyph. You can't drag or edit it directly; to retime your retirement, edit the salary's `end_age`.

**Social Security.** `+ Add` → `Income`. `start_age` is when you claim (62, 67, or 70 are typical). `end_age` is your horizon (or your spouse's later, when joint modeling lands). `growth_rate` is the COLA — 2.5% is a common assumption. The 2025 maximum at full retirement age is around $4,000/month ($48,000/year); delaying to 70 boosts it to around $5,200/month ($62,000/year).

**Pensions.** Same shape as salary or SS. If your pension has no COLA, set `growth_rate` to 0 — your nominal income stays flat, your real (inflation-adjusted) income falls.

**Living expenses.** `+ Add` → `Expense`. Your annual cost of living. `growth_rate` reflects inflation — match the `US Economy.inflation_rate` (3% by default) unless you have reason to think your lifestyle inflates differently.

**Healthcare.** Often deserves its own expense stream because it inflates faster than general CPI. `start_age` 65 (Medicare eligibility) or 0 if you're modeling pre-Medicare retirement bridge. `growth_rate` 5–6% is a more realistic medical inflation assumption than the 3% general number.

**Mortgage / fixed-payment expenses.** Use an expense stream with `growth_rate: 0` — payments are flat in nominal terms.

### Important: growth_rate is nominal

The growth rate on a stream is the *nominal* annual change. The engine does not also multiply your stream by the inflation index. If you set living expenses to grow at 3% and inflation is also 3%, your real (today's-dollar) expenses are flat — which is usually what you mean. Don't double-count by also raising living expenses each year manually.

To see your projection in today's dollars, toggle the topbar to **Today's $**. The engine still computes everything in nominal; the display divides by the cumulative inflation index.

## Modeling life events

Events are the heart of the tool. They live on a timeline; each fires at a specific age (or age range) and mutates one or more attached accounts.

To create one:

1. In the timeline section below the cash-flow chart, click `+ One-shot` (single age) or `+ Recurring` (age range).
2. Pick an action type from the picker grid: Liquidate, Transfer, Shock/adjust, Set value, Reparent, End stream.
3. The event is created with a stub action wired up. Edit it in the Inspector.

In the Inspector for an event you'll see:

- **Trigger age** (and **End age** for recurring events). Slider + number input.
- **Parameters.** Shared values across all attachments. The default action wires up sensible parameter names (e.g., `amount` for transfer, `shock` for add_value).
- **Attached accounts.** Check the accounts this event mutates.
- **Actions.** The list of mutations the event performs. You can add multiple actions to one event.

Events also have a **draggable node** above the net-worth chart. Click and drag to retime. Ranges have separate handles for start, end, and the whole span.

### Common event patterns

The seed includes worked examples for each of these. Inspect them to see how they're wired.

#### Retiring at a specific age

Set `end_age` on your salary stream. The auto-event handles the rest. To explore "what if I retire at 65 vs 67," just edit `end_age` — the auto-event moves with it. (UC11.)

If your retirement date depends on something other than salary ending — e.g., your contract ends but you keep consulting — use an explicit `end_account` event instead.

#### Selling an asset (downsizing the house)

Create a one-shot event with a `liquidate` action attached to the asset you want to sell (UC17, UC13). At the trigger age, the engine sells the asset, computes capital gains tax (with the $500k MFJ exclusion if the asset is real estate flagged as the primary residence), and deposits net proceeds into your cash sink. Subsequent years no longer see the asset's growth. The cash flow chart at that year shows a big cyan "Event liquidation" bar; the tax bar that year reflects the LTCG.

**Caveat:** the current model treats every taxable real estate liquidation as eligible for the $500k MFJ exclusion. When you sell something that *isn't* your primary residence (an investment property), the math is currently overly generous. This will tighten when proper bracket math lands.

#### Moving to a tax-friendlier state

Two distinct cases:

- **You currently live in CT and might stay or move.** Set up CT as your active jurisdiction now (see *Modeling where you live* above). If you decide later to model a move, add a `reparent` event for the future move age.
- **You currently live in CA and plan to move to FL at age 70.** Active jurisdiction stays CA. Add a one-shot `reparent` event at age 70 with `new_parent` set to the FL ambient (UC20). After age 70, the engine uses FL's effective rate for taxes.

The cash-flow chart's tax bar should visibly drop in the year of the move and stay lower thereafter.

#### Roth conversion ladder

Recurring `transfer` event (UC11/UC13/UC16) attached to a tax-deferred account, target = a Roth account, parameter = annual conversion amount, age range = the years you want to convert across.

The engine treats the converted amount as ordinary income in each year of the conversion (taxes accrue), moves dollars from the source to the destination, and treats the destination as `tax_free` going forward (no tax on growth or eventual withdrawal). On the cash-flow chart, you'll see the tax bar grow during conversion years and net worth dip slightly; the long-term effect is to reduce future RMDs (when those land in Phase 4) and lifetime taxes for someone who expects to be in a higher bracket later.

A common shape is "$80k/year from age 65 through 72" — eight years of conversion targeting the gap between retirement and RMDs. The right number for *you* depends on your bracket runway, which the current effective-rate model doesn't capture well — bracket-aware optimization waits for Phase 4.

#### NUA on company stock (Net Unrealized Appreciation)

A specific case where you have employer stock inside a 401(k) with substantial unrealized gain. Done correctly, you pay ordinary tax on the *cost basis* (a small number) and convert the appreciation into LTCG-eligible gains in a taxable account.

In this tool: model the company-stock lot as its own asset within your 401(k) container, with `tax_treatment: 'tax_deferred'`, `asset_class: 'equity'`, and an explicit `cost_basis` (this is where basis matters for tax-deferred). Then create a one-shot `liquidate` event (UC17) attached to that lot. The engine applies the NUA-style split: basis × ordinary rate plus appreciation × LTCG rate (proxy 0.6× the ordinary rate today). Net proceeds land in your cash account; the original lot is closed.

Model this carefully. The seed has a worked example labeled "NUA on company stock" attached to "Company stock (NUA candidate)" — inspect it for the wiring.

#### Market downturn / sequence-of-returns shock

One-shot `add_value` event with `field: 'start_value'`, parameter = a fractional shock like −0.25 (UC18). Attach it to all the equity holdings you want shocked.

At the trigger age, each attached asset's balance is multiplied by `(1 + shock)`. The damage compounds: a 25% drop at age 72 means the post-shock trajectory is roughly 25% below the no-shock counterfactual for the rest of your horizon. This is a useful stress test.

Keep this distinct from the next pattern, which targets a stream rather than an asset.

#### Belt-tightening (permanent reduction in expenses)

Sometimes you want to model "from age 75 onward, my living expenses drop by 30% because I downsize and reduce travel." This is an `add_value` event with `field: 'annual_amount'` (UC19), parameter = `-0.30`, attached to your living-expenses stream.

This is *not* the same primitive as the market-downturn pattern above. The field matters: `start_value` shocks an asset balance; `annual_amount` shocks a stream's nominal trajectory. If you pick the wrong field, the engine silently does nothing (the action runs but the field doesn't exist on that account kind). The action editor lets you pick — pay attention to which is right for your attached account.

#### Late-life income changes

Use a `set_value` event with `field: 'annual_amount'` to override a stream from a future age (e.g., "after 80, healthcare jumps to $50k regardless of growth_rate compounding"). Or use `add_value` for a *delta*. Both UC18/UC19 cover the patterns.

## Reading the charts

### The net-worth chart (top)

Single line is the **baseline** projection. The shaded band is **best/worst** — applied as a constant return shift over the whole horizon, not as annual independent volatility. When you adjust the volatility slider in the environment, the band widens or narrows; when you make plan changes, the line moves.

Vertical lines mark events. Color: blue = one-shot, green = recurring, gray = auto-generated. Dragging the colored dot above the chart retimes the event (UC25).

Hover any year to see baseline / best / worst values for that age (UC26).

### The cash-flow chart (middle)

Stacked bars per year. Income above zero (each source colored separately, plus event liquidations and forced sales). Outflows below zero (each expense source plus a single Taxes bar).

The most actionable view is the **tooltip**: hover any year to see Income, Outflows, and Net at the top. Net is green if positive, red if negative. The Taxes line breaks out into ordinary income and LTCG subrows.

What to watch:

- **Forced sale bars** (orange, above zero). These are years where your income wasn't enough to cover expenses + taxes, and the engine had to sell assets to bridge. If you see forced sales in years you didn't plan for, it means you didn't model an explicit liquidation. Either add one (so you control the timing and the tax consequences) or accept the forced sale as the safety net.
- **Event liquidation bars** (cyan). Big positive bars in the years you scheduled liquidations (NUA, house sale, etc.). The corresponding tax bar that year reflects the realization.
- **Tax bar shape over time.** During Roth conversion years it bulges; in the year of an FL move it should drop and stay lower; in the year of a house sale it spikes (LTCG on the gain). If those don't match your intent, your event wiring is off.

### Real vs Nominal

Topbar toggle. **Nominal $** shows projected dollars at face value (your $1M at 95 looks like a lot but is worth less in today's purchasing power). **Today's $** divides by the cumulative inflation index — your $1M at 95 in today's dollars after 3% inflation is around $400k. Most planning conversations should happen in Today's $.

The toggle affects display only. Engine math always runs in nominal.

## Saving and sharing

Your scenario auto-saves to your browser's localStorage. Refresh the page; nothing is lost. Open a new tab on the same browser; you'll see the same plan.

To **back up** or move between devices: click `Export` in the topbar. A JSON file downloads with everything: accounts, actor, events, plus a schema version for forward compatibility.

To **restore** a backup: click `Import`, pick the JSON file, confirm. The current scenario is replaced.

Two things to know:

- Selection (which thing you had clicked) and hover state are not saved or exported. They're ephemeral.
- The localStorage key is `financial-modeler-v1`. If you ever need to wipe everything (e.g., after a bad import), open dev tools → Application → Local Storage → delete the key, refresh.

Multi-scenario support (build "Plan A" and "Plan B" side by side, compare projections) ships in Phase 3 of the roadmap. Until then, use multiple JSON exports as your version control.

## Tips and gotchas

- **Custodian is a tag, not a tree level.** Don't try to make "Schwab" a parent account containing your individual lots. Tag each lot with `custodian: "Schwab"` instead. Two accounts can share a custodian without sharing inheritance. (See `DESIGN_NOTES.md` for why.)
- **Auto-events can't be edited or dragged.** They're derived from `end_age` on a stream. To change the timing or behavior, edit the source stream. The Inspector shows a read-only view with a "Open source account" button when you select an auto-event.
- **The `Math.abs(v) < 1` heuristic for `add_value`.** A parameter of −0.25 is interpreted as a fractional shock (−25%). A parameter of −5000 is interpreted as a flat add of −$5,000. The boundary is 1.0. Don't pass 0.5 expecting "$0.50" — at this scale, dollars are integers.
- **Inheritance walks up the tree by field.** A lot with `asset_class: 'bond'` looks for `bond_yield` on its parent chain — independently of any `equity_yield` set on those parents. So you can have a parent ambient with all four typed yields set, and each child binds to the right one automatically. Override per-child only when you want to deviate.
- **Year-72 events apply at the start of year 72.** Conventionally, an event with `trigger_age: 72` fires before that year's income/expense flows are computed. If you model "I sell the house at 75," the year-75 cash flow includes the sale proceeds and the tax.

## What's not modeled yet

These are real and on the roadmap:

- **Bracket-based federal and state taxes.** Today you set one effective rate per jurisdiction. Real-world planning around Roth conversions, capital gains harvesting, and IRMAA requires bracket-aware math. Phase 4.
- **Required Minimum Distributions.** Tax-deferred accounts require RMDs starting age 73. Currently you model these manually; auto-generation arrives with bracket-tax work.
- **Step-up basis at death.** Phase 4. As a primitive it's one line; the inheritance-aware UI comes later.
- **Couples and joint filing.** Today the model is single-actor (or MFJ-as-one-actor). Two ages, two SS streams, separate RMD schedules, survivor mechanics — Phase 4.
- **Multi-scenario compare.** Build "with Roth ladder" and "without," see them on one chart. Phase 3.
- **Templates.** Curated event blueprints (Roth ladder, NUA, FL move, market shock) so you don't compose them from primitives every time. Phase 4 or later.
- **Tax-deductible vs non-deductible expense distinction.** Currently all expenses are after-tax cash outflows. Bundling deductibility with the bracket-tax upgrade.

## Glossary

- **Account.** A node in the tree. Has a kind (asset, income, expense, ambient, category, liability), a parent, and zero or more fields the engine reads.
- **Ambient.** An account whose purpose is to *hold inheritable values* (yields, inflation, tax rates). Has no balance.
- **Auto-event.** An event the engine synthesizes from a declarative field on an account (today: `end_account` events from a stream's `end_age`). Marked with `✱` in the timeline list. Read-only in the Inspector.
- **Cone.** The shaded band around the baseline net-worth line. Best-case (baseline + volatility) above; worst-case (baseline − volatility) below. Applied as a constant shift over the horizon, not annual independent draws.
- **Cost basis.** The amount you originally paid for a taxable asset. Returned tax-free when you sell; the gain (current value minus basis) is taxed as a capital gain.
- **Effective tax rate.** Single blended federal+state rate applied to ordinary income. Today's coarse model; bracket-aware math is Phase 4.
- **Forced sale.** When the cash account would go negative this year, the engine sells assets in tax-efficient order (taxable → tax-deferred → tax-free) to cover the gap. Visible as orange bars on the cash-flow chart.
- **Horizon age.** The terminal age of the projection. Defaults to 95.
- **Jurisdiction.** An ambient with `effective_tax_rate` defined. The actor references one as their active jurisdiction; events of type `reparent` switch which one is active at a future age.
- **LTCG.** Long-term capital gains. In today's coarse model, taxed at 0.6 × the ordinary rate as a proxy.
- **NUA.** Net Unrealized Appreciation. An IRS provision letting employer stock inside a 401(k) be split: basis taxed at ordinary, appreciation taxed at LTCG when sold. Modeled here as a `liquidate` event on a tax-deferred lot with explicit basis.
- **Nominal.** Face-value dollars. The default display mode and the unit the engine computes in.
- **Real / Today's $.** Inflation-adjusted dollars. Toggle in the topbar. UI only — engine math is always nominal.
- **Recurring event.** Event with `kind: 'recurring'` and a non-trivial `end_age`. Fires every year from `trigger_age` through `end_age`.
- **Roth conversion ladder.** A pattern, not a primitive. Recurring `transfer` events from a tax-deferred account to a Roth account, ages X–Y, parameter = annual amount.
- **Stream.** An income or expense account with `start_age`, `end_age`, `annual_amount`, and `growth_rate`. Flows through the cash account each year between start and end.
- **Tax treatment.** One of `taxable`, `tax_deferred`, `tax_free`. Drives withdrawal sequencing and tax bucket on the cash flow.
