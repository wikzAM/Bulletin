# MVP readiness (coordinator, 2026-11-23)

Source: docs/SPEC.md section 15 plus the Platform section's milestone changes (M0 = Tauri scaffold,
M3 = desktop app v0, phone inbox moves to M5). Finishing Cursor tasks 19-21 completes the desktop polish
items; it does NOT close every box below. Status words: DONE (automated test or recorded run exists),
GAP (nothing found), USER (only the user can do it), VERIFY (probably done, needs the evidence mapped).

| Milestone / box | Status | Notes |
|---|---|---|
| M0 monorepo, `pnpm i && pnpm test` on a fresh clone | VERIFY | run on a fresh clone once |
| M0 desktop shell builds an installer | DONE (unsigned) | NSIS/MSI debug and rebuilt; real install test recorded by builder in docs/PACKAGING.md (user should read it) |
| M0 CI runs lint, typecheck, tests | USER | workflows parked in docs/ci-drafts/ until `gh auth refresh -s workflow`; signing cert absent |
| M0 CLAUDE.md, .env.example, QUESTIONS, DECISIONS, examples/todo-app | VERIFY | |
| M1 engine boxes (validation, concurrency, send-back, scope, lanes, ledger, lessons) | VERIFY | engine tests exist; map each box to a test name |
| M2 Briefing, answerer, cache, decisions, injection fixture, auto-answer rate | VERIFY | Codex task 12 touched this; map each box |
| M3 interview, edit/approve Briefing; plan review with fare range + one revision | DONE except revise wiring | revise route on main; UI wiring is task 21 |
| M3 war table live + rebuilds after reload; decisions; receipt | VERIFY | desktop tests exist |
| M3 sign in with GitHub/Google | N/A for the desktop app | replaced by local app + provider settings; record in DECISIONS |
| M3 smoke test end to end with a stub runner | GAP | Spec says Playwright; the sidecar flow test (Codex 14) covers the API half. Queued: Codex 34 |
| Dogfood gate: one real project, four success metrics recorded | USER | docs/DOGFOOD.md; blocks "continuing" per spec |
| M4 fare range before approval, actual vs estimated per unit | VERIFY | |
| M4 budget cap pauses; budget_increase resumes | VERIFY | pause exists; confirm resume path |
| M4 tiers from config, escalate on third attempt | DONE | engine test |
| M4 HQ shows cache-read share per role | GAP | no desktop surface found. Queued: Codex 35 (route) |
| M5 teammate invite, claim, member banners, cloud sync | GAP (post-MVP candidate) | only docs/TEAM.md + role types; needs a founder call: ship MVP without M5? |
| M5 ManagedAgentsRunner completes the sample mission | DONE | live run recorded |
| M6 battle replay, fog, couriers, flags | DONE (desktop) | tldraw sketch stretch not started |

Next steps once 19-21 land: coordinator merges, then maps every VERIFY row to a test or recorded run
(an Explore pass), fixes or queues gaps, and puts the M5-in-MVP question on BULLETIN.md.
