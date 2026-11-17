You are building one unit of Bulletin. Work ONLY in the git worktree D:\wt-cursor (branch cursor/web-shell). Open that folder, not D:\Bulletin.

First read AGENTS.md, CLAUDE.md, docs/WORKBOARD.md and the UI sections of docs/SPEC.md in that worktree.

Unit: web-shell. You own only apps/web/**.

Do, in order, committing after each step on branch cursor/web-shell:
1. Next.js app shell with plain-language copy (no military theme in UI text for now). Pages: "/" mission list, "/missions/[id]" war table showing units as cards with status, lane, attempts, and a live event feed.
2. Code against the API contract in docs/API.md. Codex writes it on branch codex/warroom-api; until it lands, build against typed mock data in apps/web/lib/mock.ts and keep all fetching behind apps/web/lib/api.ts so swapping to the real routes is one file. Routes will be GET /missions, GET /missions/:id, GET /missions/:id/events (SSE).
3. Add tests for the pure logic (event reducer that turns events into unit card state) with vitest; failing test first.
4. Make `pnpm run verify` pass, and `pnpm --filter web build` pass. Never weaken or skip tests. Do not add dependencies beyond what Next.js needs without a line in docs/DECISIONS.md.

Rules: commits authored as wikzAM only, NO Co-Authored-By or tool attribution lines. Do not merge or push to main. Decisions that are not yours go to BULLETIN.md; keep working on the rest. Same failure twice: stop and note it there. When done, write a 5-line summary under web-shell in docs/WORKBOARD.md status.

LONG-RUNNING MODE: after you finish, do not stop. Read docs/board/README.md and follow the Worker loop using docs/board/cursor.md as your queue (git merge main first; the queue lives there). Keep going until 11:00 local time. Commit authored as wikzAM only, no co-author lines.
