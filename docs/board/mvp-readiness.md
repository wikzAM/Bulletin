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

## Mapping pass (coordinator, 2026-11-23): evidence found for each VERIFY row

| Box | Verdict | Evidence |
|---|---|---|
| M0 CLAUDE.md, QUESTIONS, DECISIONS, examples/todo-app | DONE | files exist; examples/todo-app has src, tests, .bulletin |
| M0 `pnpm i && pnpm test` on a fresh clone | STILL VERIFY | main suite is green here (1053 tests), but never run on a fresh clone; do once |
| M1 validation: fake edge, cycle, overlap, locked path | DONE | packages/core/src/validate-plan.test.ts ("rejects the exact fake-edge message", cycles of 2 and 3, overlap, locked path) |
| M1 concurrency; broken unit returns alone; out of scope; closed lane; gated+retry held | DONE | apps/api/test/run-mission.test.ts (titles match the boxes one to one) |
| M1 ledger row per model call, report prints cost/touches/rate; lessons line per send-back | DONE | run-mission.test.ts ("charges the ledger...", "reports touches...", "writes one lesson line per send-back") |
| M2 briefing_ref answer with no human; cache hit with zero model calls | DONE | routes/auto-answer.test.ts, routes/questions.test.ts, packages/bulletin-mcp/src/e2e.test.ts |
| M2 human answer -> new Briefing version -> waiting station gets it | DONE | routes/questions.test.ts ("versions the Briefing after a human answer..."), bulletin-mcp e2e |
| M2 injected dispatch fixture; auto-answer rate in report | DONE | packages/bulletin-mcp/src/injection.test.ts; routes/mission-report.test.ts |
| M3 plan review: units, edges, lanes, fare range, one revision | DONE | desktop plan-review/revise tests; revise route on main. Not clicked through in a real window |
| M3 war table live and rebuilds after reload; receipt | DONE in code | event replay with cursor (Codex task 15) and desktop reducers; not exercised in the packaged app |
| M3 smoke test end to end | GAP | Codex 34 queued; sidecar flow test covers the API half |
| M4 fare range shown before approval | DONE | desktop plan-review tests, approve-message tests |
| M4 budget cap pauses before exceeded | DONE | run-mission.test.ts ("pauses the mission when spend reaches the budget...") |
| M4 approving `budget_increase` resumes the mission | GAP | decision.opened exists and the reducer un-pauses on attempt.started, but no test proves an approval restarts work. Queued: Codex 36 |
| M4 actual vs estimated cost stored per unit | GAP | units carry estimates and the ledger has actuals, but no per-unit comparison in the report. Queued: Codex 36 |
| M4 tiers from config, escalate only on third attempt | DONE | run-mission.test.ts (tiersSeen test) |
| M4 cache-read share per role in HQ | GAP | Codex 35 queued (route); needs a UI surface afterwards |

Remaining code gaps: Codex 34 (smoke test), 35 (cache share route), 36 (budget resume and per-unit estimate vs actual).
Remaining UI gap after 35 and 36: an HQ/receipt surface for cache share and estimate vs actual (builder or Cursor).
Remaining non-code: dogfood run, CI workflows, installer result check, M5 decision.
