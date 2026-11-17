# Cursor queue (worktree D:\wt-cursor, branch cursor/web-shell). Own: apps/web/** only
- [ ] 1. Next.js shell, mission list "/" and war table "/missions/[id]" with unit cards and event feed. Details in docs/prompts/cursor-web-shell.md. Mock data behind apps/web/lib/api.ts.
- [ ] 2. Event reducer (events -> unit card state) with vitest tests, failing first. Used by the feed and cards.
- [ ] 3. Treasury panel on the war table: spend per unit, total vs budget, warning state when over 80% (mock now; GET /missions/:id/treasury per docs/API.md once Codex lands it).
- [ ] 4. Question board page "/questions": list, answer form, status chips (mock now; POST /questions/:id/answer later).
- [ ] 5. New mission page "/new": goal textarea, repo field, shows the returned plan as a unit graph/list with errors if invalid (mock now; POST /missions).
- [ ] 6. Switch lib/api.ts from mock to real fetch/EventSource behind NEXT_PUBLIC_API_URL, keeping mock as fallback when unset. Only after docs/API.md exists on main (git merge main).
- [ ] 7. Accessibility and responsive pass, empty/error/loading states for every page, tests for the pure logic.
