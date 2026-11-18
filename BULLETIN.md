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
- status: resolved (2026-11-17). Codex documented the routes in `docs/API.md`; the web now sends `{goal}`, one `{question_number, answer}` per question, and plans with `briefing_id` unless the user edited the text (then the edited text goes as `goal`). 404/405/503 still fall back to goal-only review. `apps/web/test/api-live.test.ts` covers it against the real routes.

## [2026-11-17] web: questions need `source`, `briefing_ref` and the answerer's verdict
- question: Spec section 9 says a question reaches a person only after the automatic answerer replied SILENT or found a contradiction, and auto-answers cite a Briefing section. `GET /questions` returns none of that yet. Can the question objects carry `source` (`cache|briefing|human`), `briefing_ref`, and `auto_result` (`"silent"|"contradiction"|null`, the answerer's verdict before the handover)?
- options: (a) add the three fields to the question objects; (b) keep them only in events and let the web rebuild them from the stream
- recommendation: (a). The board is a plain list, not a stream view.
- working default: the web reads them when present (also `answerer_result` for the verdict, case-insensitive); without them an open question shows "Needs an answer" and an answered one "Answered by a person". Mock data shows both states.
- status: resolved (2026-11-17). `docs/API.md` now returns `source`, `briefing_ref` and `auto_answer_tried: true`; the web reads `auto_answer_tried` as the SILENT handover. A contradiction outcome would need its own value if the Answerer ever reports one.

## web: GET /config shape (cursor, 2026-11-17)

- question: what body will GET /config (codex task 18) return? /settings guesses
  `{models:{roles,tiers}, prices:{as_of,models}, limits:{maxUnits,...}, default_budget_cents}`.
  If the real shape differs, only toSettings in apps/web/lib/api-adapters.ts needs to change.
- status: resolved (2026-11-17). docs/API.md now documents GET /config; /settings follows it (5a5dc11) and a live test reads it from buildServer.
## web: dead code kept because tests cover it (cursor, 2026-11-17)

- question: may cursor delete `answersPayload` and the `back` action in apps/web/lib/interview.ts, together
  with their tests in apps/web/test/interview.test.ts? The /new flow now sends one answer at a time
  (pendingAnswer) and has no Back button, so nothing in the app uses them. The rules forbid deleting
  tests without a decision, so they stay until someone says yes.
- status: open.
## web: decisions route details (cursor, 2026-11-17)

- question: for Codex task 21, the web assumes POST /missions/:id/decisions/:unit/resolve takes `{choice}`
  and returns 2xx; 404 for an unknown mission or decision; 409 when already decided; and decision.resolved
  carries `payload.choice`. If any of these differ, only toResolveResult (apps/web/lib/api-adapters.ts) and the
  decision.resolved case in apps/web/lib/war-table.ts need to change. GET /missions/:id/decisions is not used:
  the page already has the stream.
- status: resolved (2026-11-17). The documented route matches; its 409 means another resolution is in progress, shown as 'someone else is deciding'. Live test added (24e771e).
## web: GET /missions/:id/rules body (cursor, 2026-11-17)

- question: for Codex task 22, the web reads `{rules, lessons}` as markdown strings (null or missing means an
  empty file; `rules_md` and `lessons_md` are also accepted). A 404 with "Mission not found" shows the not-found
  page; any other 404 or 405 shows "not shared yet". If the body differs, only toRulesInfo needs to change.
- status: resolved (2026-11-17). The documented body matches; the 404 for a missing integration branch now reads 'notes start once work has begun'. Live test added (24e771e).

## [2026-11-17] Browser access to the token-protected API

- question: Should protected web traffic use a server-side proxy, or should the client switch its SSE subscription to authenticated fetch with a user-supplied token?
- recommendation: Use a server-side proxy so the bearer token stays in the server environment.
- working default: Direct local web setup uses the API with token authentication disabled. Authenticated API clients can send a bearer header on JSON and SSE requests.
- status: open

## [2026-11-17] Link the running guide

- Please link `docs/RUNNING.md` from the root `README.md` under “Try it without Docker.”

## [2026-11-17] Cursor went quiet at 08:54
- question: Cursor has not committed since 08:54 and its worktree (D:\wt-cursor) has uncommitted edits in war-table.tsx, api-adapters.ts, copy.ts, ending.ts and fixtures.ts. Queue tasks 24 to 26 (paused-by-budget view, final review, report view) are not done.
- options: (a) it hit a usage limit or is waiting on a prompt: nudge it in the Cursor window; (b) leave it and finish those three tasks in the next session
- recommendation: (a). Its uncommitted work is not on main; nothing is lost, and I only merge committed, verified work.
- working default: (b)
- status: open

## [2026-11-17] Link docs/RUNNING.md from the root README
- question: Codex wrote docs/RUNNING.md (run API + web, with or without the managed runner). The root README is not Codex's to edit.
- options: (a) I link it; (b) leave as is
- recommendation: (a). Done in the same tick.
- status: resolved

## [2026-11-17] Web app or downloadable desktop app?
- question: docs/SPEC.md defines Bulletin as a web app (browser and phone) plus an API; what is built matches that. You were picturing a downloadable app. Which do you want as the product shape?
- options: (a) keep web core, add a thin desktop shell later (Tauri or Electron) that starts the API and web locally and opens a window, shipped as a Windows installer; (b) web only, hosted; (c) desktop-first, rebuild the shell now
- recommendation: (a). The engine, API and UI are the same either way, and a local shell fits the local Claude Code runner, which needs the user's own machine and login. It also keeps the phone-browser decision inbox the spec wants. Docker is not needed for this path.
- working default: web core continues; nothing desktop started
- status: resolved. Founder chose the desktop app; docs/SPEC.md now has the Tauri 2 platform section (see docs/DECISIONS.md).

## [2026-11-18] Lockfile change for apps/desktop
- note: Cursor task 1 adds Vite, Tailwind, React Router (and later React Flow / Tauri) under `apps/desktop`. `pnpm-lock.yaml` will change; coordinator should accept the lockfile with the desktop commits. AGENTS.md still says agents must not hand-edit the lockfile.
- status: open for coordinator merge

## [2026-11-18] API serve.test hangs on this worktree (twice)
- question: `apps/api/src/store/serve.test.ts` fails alone: spawned `serve.ts` prints nothing and never reaches `api listening on …` within its 5s kill; the managed-env warning case gets `status: null` (spawn timeout). Same with desktop changes reverted from the equation (config inject alone can take ~7s). Full `pnpm test` then cascades timeouts. Desktop lint/typecheck/`vitest apps/desktop`/`pnpm --filter @bulletin/desktop build` are green.
- options: (a) Codex investigates serve boot hang / raise the hardcoded 5s in serve.test; (b) Cursor keeps shipping desktop against package-level green and leaves verify red until (a)
- recommendation: (a). Working default: (b) so the desktop queue is not blocked.
- status: open

## [2026-11-18] Unfinished web pause work stashed
- note: Pre-direction-change pause UI (old queue task 24) is in `git stash` on `cursor/web-shell` (`wip: pause spending-limit UI (task 24)`). Old tasks 24–26 were cancelled; desktop will cover paused state when porting pages.
- status: info

## [2026-11-18] Sidecar workspace importer

- Please add the `@bulletin/sidecar` workspace manifest and regenerate `pnpm-lock.yaml` in the coordinator checkout. A new workspace needs an importer for frozen verification, and AGENTS.md reserves the lockfile. The Node sidecar runs from the repository root with `pnpm exec tsx apps/sidecar/src/main.ts` in the meantime.

## [2026-11-18] Windows process-test startup

- The new sidecar and existing HTTP startup tests repeatedly expired before receiving a frame. A direct `node --import tsx` probe took 26 seconds to import the shared API application. Allow 60 seconds for cold child startup on this host while checking the same responses and process exits.

## [2026-11-18] Full verification timed out during sidecar work

- Can the coordinator stagger full verification across worktrees when the machine is low on memory? The sidecar subprocess test passed. Two full runs reached Vitest after passing locked install, lint, and typecheck. The serial run finished with 484 tests passed and 13 timeouts in existing engine and API route tests. The sidecar implementation is available at `bc5f462` for the next full verification.

## [2026-11-18] Station and check process helper integration

- Can the runner and pass-worker owner accept an injected process launcher? The Codex platform layer exposes `spawnCommand` in `apps/api/src/platform/process.ts`. The existing launch sites are in `packages/runners/src/claude-code-runner.ts` and `apps/pass-worker/src/run-pass.ts`. Claude's queue also owns the SDK runner and pass supervision. Recommend accepting a launcher in both packages and supplying the platform helper at the API composition boundary.

## [2026-11-18] Windows verification while testing SQLite

- The SQLite storage suite and HTTP restart test passed in isolation. Full verification reached 482 passing tests and 18 failures, with timeouts in the engine and API fixtures and a Git fixture cleanup permission error after a timeout. A direct stdio probe started the SQLite sidecar and returned its first frame in 44 seconds. The sidecar test now allows up to 120 seconds for cold child startup and keeps the protocol assertions.

## [2026-11-18] Rust lockfile and installer sidecar

- `src-tauri/Cargo.lock` pins the new desktop crate's dependencies. Windows `cargo check` passed. The packaging unit needs to install the generated `bulletin-sidecar.exe` beside Bulletin and add its source path to Tauri's `bundle.externalBin` when the target-specific build artifact is available.
- The supervisor adds native process APIs and the temporary-directory test fixture to the Rust lockfile. The pnpm lockfile is unchanged.

## [2026-11-18] Desktop queue verification remains red

- The last full run passed frozen install, lint, and typecheck. Vitest finished with 489 passed and 16 failed. It hit test and hook deadlines again in the existing engine and API suites, including the HTTP subprocess startup deadline, and reported a Windows Git fixture cleanup permission error. The new sidecar, SQLite, platform, and route-contract tests passed in the full run. Windows `cargo check` and all three `cargo test` cases passed. The queue boxes remain open for full verification.

## [2026-11-18] Coordinator log append conflicted during refresh

- Merging `main` at `02e111b` into `codex/warroom-api` conflicted in `docs/board/log.md` because both branches appended records. I aborted the merge per the Worker loop. The coordinator can preserve both sets of entries during integration. The queue on `main` contains the same six desktop tasks.

## [2026-11-18] pnpm-lock.yaml changed for @modelcontextprotocol/sdk
- question: Queue task 1 adds @modelcontextprotocol/sdk to packages/bulletin-mcp. `pnpm add` rewrote pnpm-lock.yaml (needed, because verify installs with --frozen-lockfile). OK to merge that lockfile diff?
- options: (a) merge as is; (b) regenerate the lockfile on main after merging
- recommendation: (a). It is a machine-written, additive change (77 packages).
- working default: (a), committed on claude/general
- status: open

## [2026-11-18] apps/api tests time out on this machine (not a code failure)
- question: `pnpm run verify` in D:\wt-claude: lint and typecheck pass, but 12 to 17 apps/api tests (serve.test.ts, run-mission.test.ts, mission-flow.test.ts, and others) time out. Cold `tsx` startup takes about 6s here, and serve.test.ts spawns it with a 5s timeout; git-heavy tests hit 10s default timeouts. claude/general touches only apps/api/src/orchestrator (run-mission.ts, resolve-held.ts), which these tests exercise, but the timeouts are in the host: the same tests time out on main. Should the timeouts be raised, or is the host slow (antivirus scanning the new worktree)?
- options: (a) Codex raises the spawnSync/test timeouts; (b) exclude D:\wt-* from Windows Defender and retry; (c) ignore
- recommendation: (b), then (a) if it persists
- working default: carry on; judge verify by lint, typecheck and the tests of packages I touch, and log the apps/api timeouts
- status: open

## [2026-11-18] Pass tree-kill on Windows depends on taskkill, which goes through WMI
- question: runCommand kills a hung check with `taskkill /T /F`. Under heavy load (several sessions running tests at once) taskkill failed with "ERROR: Quota violation" and "ERROR: Call cancelled", leaving orphans. It is retried 3 times and the pass never hangs, but containment is not guaranteed. Who owns real containment?
- options: (a) accept taskkill plus retries and re-verify on a quiet machine or the Windows CI runner (queue task 6); (b) the Rust core runs checks inside a Windows Job Object with kill-on-close (spec Platform section gives process supervision to the Rust core)
- recommendation: (b) for the shipped app, (a) in the meantime
- working default: (a)
- status: open


## [2026-11-18] apps/desktop `test` script finds no test files
- question: `pnpm --filter desktop test` runs vitest with the root config from inside apps/desktop, so its include globs match nothing (exit 1). The root `pnpm test` does run the 219 desktop tests.
- options: (a) Cursor changes the script to run from the repo root or adds a package-level vitest config; (b) leave it and rely on the root run
- recommendation: (a), a one-line fix in apps/desktop/package.json (Cursor owns it). Added to Cursor's queue.
- status: resolved. Added `apps/desktop/vitest.config.ts` with `test/**/*.test.ts`; script uses `--config ./vitest.config.ts`. `pnpm --filter @bulletin/desktop test` → 219 passed.


## [2026-11-18] Codex has been silent since 08:16 (over 2 hours)
- question: codex/warroom-api has no commits since 08:16 and six open tasks (src-tauri supervisor, platform work, docs). The Codex app window on screen shows a thread working on web-shell, not the API thread.
- options: (a) re-paste the Codex instruction into its API thread: "Run git merge main in D:\wt-codex, read docs/board/codex.md, follow the Worker loop"; (b) move the remaining Codex tasks to another worker
- recommendation: (a). Its worktree is intact; nothing is lost.
- working default: (a), waiting on you
- status: open

## [2026-11-18] Bedrock model ids: prefix rule or explicit map in config/models.json
- question: `packages/models` sends Bedrock `anthropic.<configured id>` (the documented Mantle rule, e.g. `anthropic.claude-opus-5-5`). Real Bedrock ids can carry version suffixes or region prefixes. config/ is locked to me, so I added an optional `providers.bedrock.models` map to the models.json schema (core) but did not touch the file.
- options: (a) keep the prefix rule only; (b) the coordinator adds `"providers": {"bedrock": {"models": {...}}}` to config/models.json once the exact Bedrock ids are confirmed for the account's region
- recommendation: (b) before the first Bedrock run. Until then a wrong id fails loudly at the first call, not silently.
- working default: (a)
- status: open

## [2026-11-18] pnpm-lock.yaml changes again: @tauri-apps/cli (queue task 17)
- question: Task 17 asks for `@tauri-apps/cli` as a root devDependency. `pnpm add -Dw` rewrote pnpm-lock.yaml (126 added lines, machine-written, additive), which the workbench gate reports as "touched a locked file". Reverting the lockfile would make package.json and the lockfile disagree, so `pnpm install --frozen-lockfile` (the first step of verify) would fail. I did not edit the file by hand.
- options: (a) accept the generated lockfile diff with this branch; (b) drop the dependency and have the coordinator add it and regenerate the lockfile on main
- recommendation: (a). Same situation as the earlier entries for esbuild, postject and the provider SDKs, which were merged as is.
- working default: (a); carrying on with the parts of task 16-19 that do not depend on the answer
- status: open

## [2026-11-18 12:28] GATE: same failure came back twice
- check: `pnpm run verify`
- last output:
```
RED touched a locked file: pnpm-lock.yaml
```
- status: open
- note (claude, 2026-11-18): this is the pnpm-lock.yaml change for @tauri-apps/cli, logged above. The coordinator accepted the generated lockfile diff (message to this session) and will resolve the entry on merge. Nothing to do on the branch.
