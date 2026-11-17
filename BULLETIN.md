# Bulletin - open questions for the human, newest last

## [2026-11-16] Founder decision: acceptance target (spec section 17)
- question: Run acceptance against the sample todo app only, or also a real hackathon project?
- options: (a) todo app only until M3, then a real project at the dogfood gate; (b) both from M1
- recommendation: (a). The dogfood gate after M3 already requires a real project, and M1-M2 checks need a small, fast target.
- working default: (a)
- status: open

## [2026-11-16] Founder decision: budgets (spec section 17)
- question: What is the default mission budget, and the spend limit on the development API key?
- options: (a) $5 per mission, $50 monthly key limit; (b) $10 per mission, $100 key limit; (c) your numbers
- recommendation: (a). The sample mission should cost well under $1; a low cap proves the pause path early.
- working default: 500 cents per mission in code paths that need a number. The key limit is yours to set in the Console.
- status: open

## [2026-11-16] Founder decision: military theme (spec section 17)
- question: Does the UI use the military theme from day one, or plain language first?
- options: (a) glossary names in code and logs, plain language in Layer 0 UI copy; (b) themed everywhere
- recommendation: (a). The spec's glossary already fixes code names, and the product doc says to test the theme with non-technical users first.
- working default: (a)
- status: open

## [2026-11-16] Founder decision: open-sourcing (spec section 17)
- question: Release the board and graph engine first, or keep it private until the dogfood gate?
- options: (a) public repo now; (b) private until the dogfood gate
- recommendation: (a), which you already chose by asking for a public repo. Only docs/SPEC.md is published; the pitch, market and brainstorm docs stay out of the repo.
- status: open

## [2026-11-16] Merge the M1 logic units
- question: Merge `m1/integration` into `main`? Six units (plan validation, waves, send-back, merge policy, pass rules, treasury), 159 tests green with the engine loop, after two checker findings were fixed.
- options: (a) review `git diff main...m1/integration`, then `git merge m1/integration`; (b) ask for changes first
- recommendation: (a)
- status: open

## [2026-11-16] Log the Claude CLI in so graph.py can run stations
- question: `claude -p` fails with "OAuth session expired" outside the desktop app, so `graph.py` cannot start stations. Run `claude auth login` in a terminal?
- note: the plan passed `graph.py --dry-run`; this run's six units were built by in-session subagents in isolated worktrees instead.
- status: open

## [2026-11-16] Give gh the workflow scope so CI can be pushed
- question: GitHub rejected `.github/workflows/ci.yml` because the gh token lacks the `workflow` scope. Run `gh auth refresh -s workflow`, then `git merge ci-workflow && git push`?
- note: the CI commit is parked on the local branch `ci-workflow`. M0's "CI runs lint, typecheck, and tests" box is not verified until this lands.
- status: open

## [2026-11-16] Docker daemon would not start
- question: Docker Desktop crashes on start ("remove ...dockerInference: The file cannot be accessed by the system"). Windows refuses to delete the three stale socket files in `%LOCALAPPDATA%\Dockerun` (dockerInference, dockerEthernetVfkit, userAnalyticsOtlpHttp.sock) even from Node: access denied. Reboot, or delete them from an administrator terminal, then start Docker and run `docker compose up` and `curl localhost:4000/health`?
- note: the api and pass-worker `/health` endpoints were verified by running them directly with tsx.
- status: open

## [2026-11-17] web-shell: confirm the API shapes the web app assumes (for Codex, warroom-api)
- question: `docs/API.md` had not landed, so `apps/web/lib/types.ts` assumes: `GET /missions` returns `MissionSummary[]` (id, goal, status, created_at, units_total, units_done); `GET /missions/:id` returns that plus `repo` and `units: {id, title, lane, wave, needs: string[]}[]`, 404 when unknown; `GET /missions/:id/events?after=<id>` sends each event as a default (unnamed) SSE message whose `data` is one `BulletinEvent` JSON object. The browser calls the API directly, so it needs CORS for the web origin. Treasury panel: `GET /missions/:id/treasury` returns at least `{ budget_cents }`; spend is summed from `ledger.charged` events (`payload.cost_cents`), so the route need not repeat it. Question board: `GET /questions` returns `Question[]` (id, mission_id, unit_id, body, status open|answered, answer, source cache|briefing|human, briefing_ref, created_at, answered_at; see `apps/web/lib/types.ts`), and `POST /questions/:id/answer` takes `{ answer }` and returns the updated `Question`. New project: `POST /missions` takes `{ goal, repo }` and returns the General's result plus the id, `{ ok: true, mission_id, plan, attempts }` or `{ ok: false, mission_id, errors, attempts }` (also as the body of a 4xx), so the page can show validator errors.
- options: (a) the API matches these shapes; (b) `docs/API.md` defines different ones and the web side adapts in `lib/api.ts` only
- recommendation: (b) is fine; whichever lands first wins, and the swap is one file.
- working default: mock data until `NEXT_PUBLIC_API_URL` is set.
- status: resolved by (b). Codex's `docs/API.md` (on `codex/warroom-api`) is the contract; `apps/web/lib/api-adapters.ts` maps it, including named SSE frames. Remaining small asks are in the next entry.

## [2026-11-17] web-shell: three optional fields the web would show if the API sent them (for Codex)
- question: Per `docs/API.md` the web falls back where fields are missing. Add any of these? (1) `goal` on `GET /missions` and `GET /missions/:id` (it is in the `mission.created` payload); today the list shows the repo path as the title. (2) unit `title` on `GET /missions/:id`; today the web takes titles from `plan.proposed` `payload.plan` in the stream, and shows ids for engine runs whose `plan.proposed` has only counts. (3) `source` and `briefing_ref` on questions once the answerer lands; today an answered question is shown as "Answered by a person".
- options: (a) add them when convenient; (b) leave as is
- recommendation: (a) for (1) and (2), each is one field read from events the API already has; (3) can wait for M2's answerer.
- working default: fallbacks above; no web change is needed when the fields appear.
- status: open

## [2026-11-17] web-shell: a browser-safe entry point for @bulletin/core (core contract change)
- question: Importing any value from `@bulletin/core` in a client component breaks `next build` (`config.ts` pulls in `node:fs`). Add a browser-safe subpath, e.g. `"./browser"` exporting `types` and `events` only?
- options: (a) add the subpath in core and drop `apps/web/lib/guards.ts`; (b) keep the mirrored guards (a test pins them to core)
- recommendation: (a) when core is next open; (b) works meanwhile.
- status: open

## [2026-11-17] web-shell: add NEXT_PUBLIC_API_URL to .env.example
- question: The web app reads `NEXT_PUBLIC_API_URL` (browser-visible); unset means mock data. Add it to `.env.example` next to `API_URL`? web-shell does not own that file.
- recommendation: yes, empty by default.
- status: open

## [2026-11-17] Managed Agents: adapter, repo access and secrets
- question: The Managed Agents runner is built and tested against an injected client. To run it for real we need (1) the `@anthropic-ai/sdk` dependency and a thin adapter, (2) a GitHub remote the cloud sandbox can push to, and (3) an ANTHROPIC_API_KEY (Claude Code login does not cover Managed Agents).
- options: (a) add the SDK + adapter now and test it with your API key when you wake up; (b) wait until the AWS/site setup is done
- recommendation: (a). It is one dependency and one small file. A GitHub token with push rights to a scratch repo is needed; use a throwaway repo, not Bulletin.
- working default: not started; the local Claude Code runner stays the default
- status: open

## [2026-11-17] War table engine integration

- Which unit should connect engine runs to the API process? `buildServer(log)` can read the same `MemoryEventLog` as an in-process runner, while `bulletin run` currently creates its own log in a separate process.
- Which unit should expose the full plan to the war table? The current `plan.proposed` payload carries counts. Unit IDs, lanes, and wave numbers become visible as the engine emits them. Rendering the complete planned graph before execution also requires titles and dependency edges.
- status: open

## [2026-11-17] Cursor adds "Co-authored-by: Cursor" trailers to commits
- question: Your rule is wikzAM as the only author with no co-author lines. Cursor appends a Co-authored-by trailer to its commits.
- options: (a) turn off Cursor's commit attribution in its settings; (b) keep squash-merging its branch so main never gets the trailer
- recommendation: do (b) now (already doing it) and (a) when you can, so its own branch history is clean too.
- working default: (b)
- status: open

## [2026-11-17] Shared Interviewer prompt and interview events

- question: Should a shared-contract unit move `interviewer-v1` to `packages/prompts` and define events for draft turns and failed model calls? The shared package has no Interviewer template and the event list has `briefing.versioned` for a completed Briefing.
- options: (a) move the template and add draft events in the next shared-contract unit, or (b) keep drafts and their template API-local.
- recommendation: (a) once another client needs draft events or the prompt.
- working default: API-local template and JSONL draft snapshots. Attaching a complete Briefing to a mission emits `briefing.versioned`.
- status: open
## [2026-11-17] web: Briefing route shapes assumed by the guided /new page
- question: `/new` is now goal, then questions, then the requirements (Briefing) for review, then the plan. `docs/API.md` has no Briefing routes yet (Codex task 11), so `apps/web/lib/api.ts` assumes: `POST /briefings {goal, repo}` and `POST /briefings/:id/answers {answers: [{question_id, answer|null}]}`, each replying either `{briefing_id, questions: [{id, text}]}` (more questions) or `{briefing_id, briefing: "<markdown>"}` (done). The adapter also accepts `id`, `markdown`/`text`, and questions as strings or `{id, question}`. The plan is then requested with the existing `POST /missions {goal: <Briefing markdown>, repo}`.
- options: (a) Codex builds the routes to these shapes; (b) Codex documents different shapes and Cursor adapts `lib/api-adapters.ts` (one function)
- recommendation: (a), or (b) if the engine already differs; either is a small change on the web side.
- working default: when `POST /briefings` returns 404/405 the page skips the questions and opens the review step with the Briefing template filled from the goal, so `/new` works against today's API.
- status: open
## [2026-11-17] web: questions need `source`, `briefing_ref` and the answerer's verdict
- question: Spec section 9 says a question reaches a person only after the automatic answerer replied SILENT or found a contradiction, and auto-answers cite a Briefing section. `GET /questions` returns none of that yet. Can the question objects carry `source` (`cache|briefing|human`), `briefing_ref`, and `auto_result` (`"silent"|"contradiction"|null`, the answerer's verdict before the handover)?
- options: (a) add the three fields to the question objects; (b) keep them only in events and let the web rebuild them from the stream
- recommendation: (a). The board is a plain list, not a stream view.
- working default: the web reads them when present (also `answerer_result` for the verdict, case-insensitive); without them an open question shows "Needs an answer" and an answered one "Answered by a person". Mock data shows both states.
- status: open
