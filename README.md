# Financial Modeler

A local-first, deterministic, event-driven retirement planner. Built for someone who *can* retire but hasn't yet — primary jobs are wealth preservation, tax planning, and inheritance planning, not long-term accumulation.

> **Status.** Mock-era code in `mocks/main-view/` is the active app under iteration. Phases 0, 0.5, and 1 of `docs/ROADMAP.md` are complete; Phase 2 (test suite) is the next gate.

## Documentation

Read these in order if you're new:

- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — task-oriented user docs. How to build a plan, model life events, read the charts.
- [`docs/USE_CASES.md`](docs/USE_CASES.md) — 30 testable primitives across 8 layers. Spec for the integration test suite.
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — mechanical reference for the data types and engine contract.
- [`docs/DESIGN_NOTES.md`](docs/DESIGN_NOTES.md) — decisions and rationale; UX patterns; lessons from the mock iterations.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased plan, what's deferred and why.
- [`docs/images/`](docs/images/) — annotated reference screenshots.

The mock-era [`docs/PRD.md`](docs/PRD.md) and [`docs/DESIGN.md`](docs/DESIGN.md) are kept for history; treat the new docs as authoritative when they conflict.

## Prerequisites

- **Node** matching [`.nvmrc`](./.nvmrc) (currently 20.20.2). `create-vite` requires Node ≥ 20.19; default macOS Node 18 will fail.
- A node version manager that reads `.nvmrc`: [`nvm`](https://github.com/nvm-sh/nvm), [`fnm`](https://github.com/Schniz/fnm), [`asdf`](https://asdf-vm.com/), or [`volta`](https://volta.sh/) — any of these.
- `bash` for the helper script (any modern shell will do).

## Fresh-machine setup

```bash
git clone <this repo>
cd financial-modeler

# Activate the pinned Node version. Use whichever manager you prefer.
nvm use            # nvm
# OR: fnm use
# OR: asdf install nodejs && asdf local nodejs $(cat .nvmrc)

cd mocks/main-view
npm ci             # deterministic install from package-lock.json
npm run dev        # vite dev server at http://localhost:5173
```

That's it. State auto-persists to `localStorage` under the key `financial-modeler-v1`.

## Common commands

All run from `mocks/main-view/` (or via `scripts/dev.sh` from anywhere):

| What | npm | dev.sh |
|---|---|---|
| Dev server | `npm run dev` | `dev.sh dev` |
| Typecheck | `npm run typecheck` | `dev.sh check` |
| Lint | `npm run lint` | — |
| Test once | `npm test` | `dev.sh test` |
| Test watch | `npm run test:watch` | — |
| Test with coverage | `npm run test:coverage` | — |
| Production build | `npm run build` | `dev.sh build` |
| Reproducible install | `npm ci` | `dev.sh install` |

`scripts/dev.sh` adds: `verify` (curls the dev server's key paths), `tail` (best-effort tail of a Claude-managed vite log).

## Architecture in one paragraph

A pure-function engine `project(accounts, actor, events) → YearlyProjection[]` runs over a tree of accounts and a list of timeline events to produce a year-by-year projection. Zustand holds state; React components render. All math is in nominal dollars; the UI divides by a cumulative inflation index for "Today's $" display. Persistence is `localStorage` (per-browser) with JSON export/import for portability. See [`docs/SCHEMA.md`](docs/SCHEMA.md) for the engine contract; see [`docs/DESIGN_NOTES.md`](docs/DESIGN_NOTES.md) for *why* it's shaped this way.

## Tech stack

- **Build:** Vite 8
- **Framework:** React 19
- **Language:** TypeScript 6 (strict)
- **State:** Zustand 5 with `persist` middleware
- **Charts:** Recharts 3
- **Tests:** Vitest 4 + @testing-library/react (jsdom) — currently scaffolding only; Phase 2 fills out the suite

## CI

[GitHub Actions workflow](.github/workflows/ci.yml) runs on every push and PR to `main`: install (with cache) → typecheck → lint → test → build. The CI Node version is read from `.nvmrc` so local and CI stay in lockstep.

## Privacy

Local-first. All data lives in your browser's `localStorage`. Nothing is transmitted. To back up or move between machines: `Export` in the topbar downloads a JSON file you can `Import` elsewhere.

## License

Not yet specified.
