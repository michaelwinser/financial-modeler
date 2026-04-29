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

The **only** thing a typical developer needs to install separately is a Node version manager. Everything else is either universal (`git`, `bash`) or bootstrapped automatically from files in this repo.

| Tool | Required? | How |
|---|---|---|
| **Node version manager** | Yes — install once | [`nvm`](https://github.com/nvm-sh/nvm), [`fnm`](https://github.com/Schniz/fnm), [`asdf`](https://asdf-vm.com/), or [`volta`](https://volta.sh/) — any of these |
| **git** | Yes | Almost always already installed; `xcode-select --install` on macOS otherwise |
| **bash** | Yes | macOS / Linux native; Git Bash or WSL on Windows |
| **Node 20.20.2** | Bootstrapped | The version manager reads [`.nvmrc`](./.nvmrc) and installs/switches; no separate step |
| **npm** | Bootstrapped | Bundled with Node |
| **Vite, React, Vitest, Recharts, …** | Bootstrapped | `npm ci` installs from `package-lock.json` |

`create-vite` requires Node ≥ 20.19; the default macOS Node 18 will fail. `dev.sh` will refuse to run if the active Node doesn't match `.nvmrc`, so version drift fails fast rather than silently.

If you really don't want a version manager: install Node 20.20.2 directly (e.g. via Homebrew, official installer, or asdf without the `local` step). `dev.sh` will accept any matching version.

## Fresh-machine setup

```bash
# 1. Install a node version manager (one-time, system-wide).
#    macOS:
brew install nvm
#    Linux / Windows-WSL:
#    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash

# 2. Clone and bootstrap.
git clone <this repo>
cd financial-modeler

nvm install        # installs 20.20.2 from .nvmrc if not present
nvm use            # switches to it
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
