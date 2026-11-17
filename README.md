# Bulletin

Bulletin turns a goal into a plan, splits the plan into units that agents build in parallel,
lets those agents ask the plan questions instead of interrupting people, checks every unit with
deterministic tests, and shows it all on a live map.

This repository is the MVP, built milestone by milestone from [docs/SPEC.md](docs/SPEC.md).
Current status lives in [PROGRESS.md](PROGRESS.md).

## Run it

Requires Node 22+, pnpm 10, and Docker for the database and the pass-worker.

```bash
pnpm install
```

```bash
pnpm run verify
```

```bash
docker compose up
```

`GET http://localhost:4000/health` returns `{"status":"ok","service":"api"}`.

## Try it without Docker

```bash
pnpm --filter @bulletin/api exec tsx src/serve.ts
```

```bash
pnpm --filter web dev
```

The API is documented in [docs/API.md](docs/API.md). From the command line, `tsx apps/api/src/cli.ts plan --repo <path> --goal "..."` writes a plan, and `tsx apps/api/src/cli.ts run --repo <path> --plan plan.json` builds it with parallel Claude Code stations (add `--runner managed --sandbox-repo <url>` for Managed Agents; see [docs/MANAGED-AGENTS.md](docs/MANAGED-AGENTS.md)). Work is split across tools by [docs/WORKBOARD.md](docs/WORKBOARD.md).

## Layout

```text
apps/web            Next.js: setup, plan review, war table, inbox, receipt
apps/api            Fastify: routes, SSE, orchestrator, answerer, treasury
apps/pass-worker    runs deterministic checks on a clean checkout
packages/core       shared types, zod schemas, event types, lanes, plan validation
packages/graph      wave scheduling, merge policy, send-back packets, lessons
packages/runners    Runner interface; local Claude Code and Managed Agents runners
packages/bulletin-mcp  Bulletin tool contracts and MCP server
packages/prompts    versioned prompt templates with stable prefixes
packages/db         Drizzle schema and migrations
examples/todo-app   sample target repo used for acceptance runs
config/             model ids and prices (never in code)
```

## Working on it

Read [CLAUDE.md](CLAUDE.md). Open questions go in `docs/QUESTIONS.md`, choices in `docs/DECISIONS.md`.
