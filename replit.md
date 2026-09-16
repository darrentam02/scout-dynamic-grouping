# Scout Dynamic Grouping

A live room-based tool that allocates Scout leaders into six balanced P1–P6 patrol groups using ranked preferences, gender parity, and skill coverage.

## Run & Operate

- Use the Replit run button to start the registered API and web workflows.
- `pnpm --filter @workspace/api-server run dev` — run the API server when its workflow supplies `PORT` (8080)
- `pnpm --filter @workspace/new-leaders-allocation run dev` — run the Vite frontend when its workflow supplies `PORT` and `BASE_PATH`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/new-leaders-allocation/` — Vite + React frontend
- `artifacts/api-server/` — Express API and room routes
- `lib/allocation/` — shared grouping engine
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/api-zod/` and `lib/api-client-react/` — generated validation and client packages
- `lib/db/src/schema/` — Drizzle database schema

## Architecture decisions

- API traffic is routed at `/api`; the frontend is routed at `/`.
- API contracts are defined in OpenAPI and generated into server validation and typed React clients.
- Room state is persisted in PostgreSQL through Drizzle.
- The allocation engine is a shared library consumed by both the API and frontend.

## Product

- Hosts create live rooms and share room codes or links.
- Leaders check in with ranked patrol preferences and skills.
- Hosts generate six balanced patrol groups and review allocation KPIs.
- Excel roster import supports bulk participant entry.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Do not run artifact dev commands from the workspace root without the workflow-provided `PORT` and `BASE_PATH`.
- After editing `lib/api-spec/openapi.yaml`, run API generation before typechecking consumers.
- Apply development schema changes with the database push command before starting the API.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
