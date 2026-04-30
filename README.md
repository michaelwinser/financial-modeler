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

`npm` scripts work from **either the repo root or `mocks/main-view/`** — the root has pass-through scripts that delegate to the app. `scripts/dev.sh` is a thin wrapper that also handles the `nvm use` step.

| What | npm | dev.sh |
|---|---|---|
| Dev server | `npm run dev` | `dev.sh dev` |
| Typecheck | `npm run typecheck` | `dev.sh check` |
| Lint | `npm run lint` | — |
| Test once | `npm test` | `dev.sh test` |
| Test watch | `npm run test:watch` | — |
| Test with coverage | `npm run test:coverage` | `dev.sh coverage` |
| Production build | `npm run build` | `dev.sh build` |
| Reproducible install | `npm run install:app` (root) or `npm ci` (in `mocks/main-view/`) | `dev.sh install` |

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

[GitHub Actions workflow](.github/workflows/ci.yml) runs on every push and PR to `main` with two parallel jobs:
- **app**: install → typecheck → lint → test → build. Node version read from `.nvmrc` so local and CI stay in lockstep.
- **docker**: builds the production image to validate the Dockerfile (no push).

## Deployment

The app is a static-asset SPA — no backend, no database. Once the user loads the page, no server interaction happens (their data lives entirely in their browser's `localStorage`). Deployment means *serving the built `dist/` directory*. The supplied [`mocks/main-view/Dockerfile`](mocks/main-view/Dockerfile) bakes that into a ~50 MB nginx-alpine image suitable for any container host.

> **HTTPS is strongly recommended** even though no sensitive data is in flight: some browsers restrict `localStorage` on plain HTTP, and your testers will trust the URL more. Cloud Run gives HTTPS automatically. Self-hosted needs a reverse proxy with TLS.

### Build and run the container locally

```bash
docker build -t financial-modeler mocks/main-view
docker run --rm -p 8080:8080 financial-modeler
# open http://localhost:8080
```

### Cloud Run

Easiest target for "show friends a public URL": Cloud Run gives HTTPS, a public domain, and generous free tier (2M requests/month).

```bash
# One-time: create a project and enable the relevant APIs.
gcloud projects create financial-modeler-demo
gcloud config set project financial-modeler-demo
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

# Deploy. Cloud Build picks up the Dockerfile automatically.
gcloud run deploy financial-modeler \
  --source mocks/main-view \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080
```

`--allow-unauthenticated` makes the service public. Drop it (and use `gcloud run services add-iam-policy-binding` instead) if you want only signed-in Google accounts you've allowlisted to reach it.

Subsequent deploys: same command. Cloud Run keeps prior revisions; rollback is `gcloud run services update-traffic`.

### TrueNAS Scale (self-hosted)

Two paths depending on whether your testers are inside your home network or beyond it.

**Local network only.** TrueNAS Scale's *Apps* feature includes "Custom App" / "Launch Docker Image":

1. Build and push the image to a registry your TrueNAS box can pull from (Docker Hub, GHCR, your own registry). Example with GHCR:

   ```bash
   docker build -t ghcr.io/<you>/financial-modeler:latest mocks/main-view
   docker push ghcr.io/<you>/financial-modeler:latest
   ```

   Or run a quick local registry on your network and push there.

2. In the TrueNAS UI: *Apps* → *Discover Apps* → *Custom App*. Image: your pushed tag. Container port: `8080`. Map to a host port (e.g. `8080`).

3. Browse to `http://<truenas-ip>:8080/` from any device on the LAN.

**Public access with HTTPS.** Add a reverse proxy with TLS in front of the container. The simplest path on TrueNAS Scale is the Caddy app (or the built-in *TrueCharts* / *cnpg* equivalents):

- Install Caddy as another app; route `<your-domain>` → the financial-modeler container.
- Caddy issues and renews Let's Encrypt certificates automatically.
- Open ports 80 / 443 on your router; point your DNS at your home IP.

If you don't have a static IP, a Tailscale or Cloudflare Tunnel between your TrueNAS box and a public endpoint sidesteps the port-forwarding question entirely.

## Privacy

Local-first. All data lives in your browser's `localStorage`. Nothing is transmitted. To back up or move between machines: `Export` in the topbar downloads a JSON file you can `Import` elsewhere.

## License

Not yet specified.
