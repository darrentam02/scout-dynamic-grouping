# Scout Dynamic Grouping — 新領袖 P1–P6 分組配置

A full-stack app for fairly allocating scout leaders into six patrol groups (`P1`–`P6`) on camps/camporees. Hosts create a live room, leaders check in with their ranked patrol preferences and skills, and a spec-driven allocation engine builds balanced groups.

## Highlights

- **Live field rooms** — generate a room code, share a join link (QR included), see check-ins in real time.
- **Three ranked preferences** — every leader ranks their top three patrol tiers (`P1P2`, `P3P4`, `P5P6`, or `NONE`); the existing single-choice field is treated as the first choice.
- **Multi-objective allocation engine** — 36 leaders → 3 clusters of 12 → 6 groups of 6, balancing preferences, gender parity, and skill coverage.
- **Monte Carlo 500** — runs 500 seeded simulations and keeps the assignment with the best soft-coded KPI.
- **Excel bulk import** — download the `.xlsx` template with `Name`, `Gender`, `Preference`, `rank2Preference`, `rank3Preference`, and `E01–E20` columns, fill it in, upload it.
- **Soft-coded KPI dashboard** — the group board shows rank-1/2/3 hit rates, gender parity, skill coverage, and a weighted KPI score after every allocation.

## Repository layout

```
artifacts/
  api-server/                Express API (Fastify-style routes, zod validation)
  new-leaders-allocation/    Vite + React frontend for the rooms / group board
  mockup-sandbox/            UI sandbox (generated components)
lib/
  allocation/                Shared allocation engine (@workspace/allocation)
  api-spec/                  OpenAPI spec + orval config (single source of truth)
  api-zod/                   Generated zod schemas from the OpenAPI spec
  api-client-react/          Generated typed React hooks + fetch client
scripts/                     Repo maintenance scripts
```

## Allocation algorithm

The engine in `lib/allocation` implements a two-stage waterfall:

1. **Cluster assignment** — split leaders into three grade clusters `P1P2` / `P3P4` / `P5P6`, each capped at **12**.
   - *Safety locks first*: leaders with safety-critical skills (First Aid, Camping, Pioneering for `P5P6`; Child Psych, MC & Games for `P1P2`) are locked into their matching cluster first.
   - *Overflow*: remaining leaders are placed by weighted score — preference points (Rank 1 = +20, Rank 2 = +5, Rank 3 = +0) plus a skill-weight sum against an 18-skill × 3-cluster weight matrix.
2. **Sub-group split** — each cluster's 12 leaders are split into its two patrols of **6**, keeping gender counts as even as possible (e.g. 10 female / 26 male → four groups of 2F+4M and two groups of 1F+5M).
   - Ties are broken by non-core skill contribution so specialist skills spread across patrols.

**KPI** (soft-coded in `DEFAULT_KPI_CONFIG`):

```
weighted = rank1HitRate × 0.4 + rank2HitRate × 0.2
        + genderParity × 0.2 + coverage × 0.1 + contribution × 0.1
```

Monte Carlo runs with seed `20260916` (default in `DEFAULT_MC_CONFIG`) and returns the best-scoring assignment along with a distribution summary.

## API

All routes live under `artifacts/api-server/src/routes` and are validated with zod (generated from `lib/api-spec/openapi.yaml`).

| Method | Path                           | Description                                  |
| ------ | ------------------------------ | -------------------------------------------- |
| GET    | `/api/healthz`                 | Health check → `{"status":"ok"}`             |
| POST   | `/api/rooms`                   | Create a room (host name)                    |
| GET    | `/api/rooms/:roomCode`         | Fetch a room with roster + groups            |
| POST   | `/api/rooms/:roomCode/participants`| Check a leader in (name, gender, 3 ranks, skills) |
| POST   | `/api/rooms/:roomCode/grouping`| Run full allocation                          |
| POST   | `/api/rooms/:roomCode/grouping/new`| Allocate only new arrivals (locks existing)|
| POST   | `/api/rooms/:roomCode/grouping/clear`| Clear all assignments                     |

## Getting started

Requires `pnpm` (a `pnpm-workspace.yaml` monorepo).

```bash
pnpm install
pnpm run typecheck
pnpm --filter @workspace/api-server run dev        # API
pnpm --filter @workspace/new-leaders-allocation run dev   # frontend
```

### Re-generating API clients

Edit `lib/api-spec/openapi.yaml`, then run `orval` from `lib/api-spec` to regenerate `api-zod` and `api-client-react`:

```bash
cd lib/api-spec && pnpm run generate
```

## Algorithm spec example

**Input:** 36 leaders (e.g. 10 female, 26 male), each with gender, three ranked preferences, and a 20-dim skill vector.

**Output:**
- Executive summary — rank-1/2/3 hit rates and quality metrics.
- Master table — each patrol `P1`–`P6` with members, rank counts, and top skills.
- Constraint & quality audit — capacity (6 per group), gender balance, forced (non-Rank-1) allocations with reasons, warnings.
- Monte Carlo summary — mean / P10 / P50 / P90 of each KPI across 500 runs.
- Intra-cluster swap suggestions when a tie-breaker had to decide.