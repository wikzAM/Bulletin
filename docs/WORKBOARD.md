# Workboard: who builds what in parallel

Units are file-disjoint so three tools can work at once without conflicts. Claim a unit by
putting your branch next to it. Merge happens only from the Claude Code session, after verify.

| Unit | Owner | Branch | Files (only these) | Done means |
|------|-------|--------|--------------------|------------|
| general | Claude Code | `claude/general` | `apps/api/src/general.ts`, `apps/api/test/general.test.ts`, `apps/api/src/cli.ts` | goal text in, validated plan.json out; one retry with feedback; tests use an injected fake model |
| warroom-api | Codex | `codex/warroom-api` | `apps/api/src/server.ts`, `apps/api/src/server.test.ts`, new files under `apps/api/src/routes/` | Fastify routes: list missions, get one mission, SSE event stream; reads engine events; tests use fastify inject |
| web-shell | Cursor | `cursor/web-shell` | `apps/web/**` | Next.js shell: mission list page and a war table page that renders events from the SSE route; `pnpm --filter web build` and lint pass |

## Rules for overlap
- `apps/api/src/cli.ts` belongs to `general` only. If Codex needs a CLI hook, ask on `BULLETIN.md`.
- The event shapes are defined in `packages/core`; read them, do not change them. Cursor codes against the SSE route shape Codex publishes in `docs/API.md` (Codex writes it first, in its first commit).
- Next units after these land: Managed Agents runner, Docker pass-worker, Treasury view.

## Status
- general: done (bulletin plan --goal), on claude/general
- warroom-api: complete on `codex/warroom-api`.
  - API contract published first in `docs/API.md`.
  - Mission list and detail project units and ledger totals from core events.
  - SSE replays history, resumes from a cursor, and follows live events.
  - `pnpm run verify` passed with 176 tests.
- web-shell: queue tasks 1-11 done; `lib/api.ts` is tested against the real API routes in-process (task 8); try history, dark theme and `apps/web/README.md` added; verify and web build green.
  - Pages: `/` projects, `/missions/[id]` live task cards by batch plus spending panel and activity feed, `/questions` answer board, `/new` plan request.
  - All fetching is in `apps/web/lib/api.ts`; mock data by default, real routes when `NEXT_PUBLIC_API_URL` is set, mapped by `lib/api-adapters.ts`.
  - Pure logic is tested (98 web tests): event reducer, treasury, questions, new-project validation, plan batches, adapters, copy rules.
  - Real API mode: set `NEXT_PUBLIC_API_URL` and run the web on port 3000 (the API's CORS origin); unset keeps mock data.
  - Open on BULLETIN.md: optional API fields (goal, titles), a browser-safe core entry, and the env var in `.env.example`.
