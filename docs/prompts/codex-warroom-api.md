You are building one unit of Bulletin. Work ONLY in the git worktree D:\wt-codex (branch codex/warroom-api). Do not touch D:\Bulletin.

First read AGENTS.md, CLAUDE.md, docs/WORKBOARD.md and docs/SPEC.md (war table / events sections) in that worktree.

Unit: warroom-api. You own only apps/api/src/server.ts, apps/api/src/server.test.ts and new files under apps/api/src/routes/ (plus tests next to them) and docs/API.md.

Do, in order, committing after each step on branch codex/warroom-api:
1. Write docs/API.md first (routes, JSON shapes, SSE event format) and commit it. Cursor builds the web UI against it.
2. Fastify routes: GET /missions (list), GET /missions/:id (one mission with units, ledger totals), GET /missions/:id/events (Server-Sent Events stream of engine events, replays history then follows live). Read event types from packages/core; do not change packages/core.
3. Failing test first for each route using fastify inject; then implement. Use the in-memory event log already in packages/core for data.
4. Run `pnpm run verify` until green. Never weaken or skip tests.

Rules: commits authored as wikzAM only, NO Co-Authored-By or tool attribution lines. Do not merge or push to main. If you hit a decision that is not yours, append it to BULLETIN.md and continue with what you can. Same failure twice: stop and note it there. When done, write a 5-line summary at the end of docs/WORKBOARD.md status for warroom-api.

LONG-RUNNING MODE: after you finish, do not stop. Read docs/board/README.md and follow the Worker loop using docs/board/codex.md as your queue (git merge main first; the queue lives there). Keep going until 11:00 local time. Commit authored as wikzAM only, no co-author lines.
