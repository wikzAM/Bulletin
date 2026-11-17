# Codex queue (worktree D:\wt-codex, branch codex/warroom-api). Own: apps/api/src/server.ts, apps/api/src/routes/**, tests beside them, docs/API.md
- [x] 1. docs/API.md then GET /missions, GET /missions/:id, GET /missions/:id/events (SSE, replay then live). Details in docs/prompts/codex-warroom-api.md
- [x] 2. GET /missions/:id/treasury: spend per unit and total vs budget, from the ledger types in packages/core. Add to docs/API.md first.
- [x] 3. Question board routes: GET /questions, POST /questions, POST /questions/:id/answer (in-memory store behind an interface in apps/api/src/routes/questions-store.ts so a DB can replace it later). Add to docs/API.md first.
- [x] 4. POST /missions {goal, repo}: calls runGeneral from apps/api/src/general.ts with an INJECTED ModelCall (default throws "not configured"), returns the validated plan or the errors. Do not edit general.ts or cli.ts.
- [x] 5. POST /missions/:id/approve: starts runMission via an injected starter function; tests use a fake. Emit events through the existing event log.
- [x] 6. Hardening: zod validation of params/bodies, consistent error JSON, 404s, CORS for http://localhost:3000, tests for each.
- [x] 7. Update docs/API.md to match final shapes exactly; add a route-listing test that fails if docs and routes drift.
