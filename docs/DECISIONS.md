# Decisions

One line for the decision, one for why. Newest last.

- **TypeScript 6, not 7.**
  typescript-eslint 8 refuses to load under TypeScript 7.0; revisit when it supports 7.x.
- **Packages export TypeScript source (`exports` -> `src/index.ts`), with no build step.**
  One fewer thing to break; `tsx` and `vitest` run source directly, and Next transpiles workspace packages.
- **One root `tsconfig.json`, one root `vitest.config.ts`, one root ESLint config.**
  The whole check runs in about ten seconds, which matters because the gate and every station run it.
- **Turborepo is installed but only drives `build`.**
  The spec names it; lint, typecheck and test are faster as single root runs than as eleven package runs.
- **`pnpm run verify` installs with `--frozen-lockfile` first.**
  Station worktrees start without `node_modules`, and a station that adds a dependency should go RED.
- **Lane computation lives in `packages/core`, not `packages/graph`.**
  Plan validation (rule 6) needs it and `core` must not depend on `graph`.
- **Dependencies added in M0:** zod, picomatch (globs for file ownership and lanes), fastify, drizzle-orm, pg,
  drizzle-kit, next, react, react-dom, vitest, eslint, typescript-eslint, tsx, turbo.
  All are the spec's named choices or the boring default for the job; picomatch is the one unnamed pick.
- **Tailwind, Auth.js, React Flow, `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` are not installed yet.**
  They arrive with the milestone that first uses them, so the lockfile only holds what runs.
- **`ledger` has two columns the spec's table does not: `prompt_version` and `cache_write_tokens`; `source` also allows `claude_code`.**
  Section 9 says every ledger row records the prompt version, cache writes are priced separately, and local runs are neither Messages calls nor managed sessions.
- **The pass checks locked paths before scope.**
  A station must never be able to hide a rule change behind a scope error.
- **Cache-write price is 1.25x input (5-minute TTL) for every model in `config/prices.json`.**
  That is the published multiplier; the Haiku 5.5 cache-read price is assumed at 0.1x input (see QUESTIONS).
- **Lesson promotion is deterministic text for now** (`- Cut units so this cannot recur: <reason>`).
  The graph engine has no model calls; the General can rewrite rules in its own words later.

## M1 logic units (2026-11-16)

- **validatePlan collects every error** rather than stopping at the first; a schema failure returns early.
  The General gets one complete list to revise against instead of one error per round trip.
- **Overlap and locked-path checks expand globs against the repository's files**, as well as comparing patterns.
  Two patterns that look unrelated can still own the same file, and a broad glob can swallow a locked one.
- **Acceptance commands use their own matcher where `*` matches anything**, not the path glob matcher.
  Path globs stop at `/`, so `pnpm --filter @bulletin/api test` would never match `pnpm *`.
- **A custom `lockedPaths` replaces the default list.**
  The caller owns the list; extending silently would hide what is actually locked.
- **buildWaves throws on an unknown need (`unknown unit`) and on a self-need (`cycle`).**
  Plans are validated first, so reaching either means a caller skipped validation.
- **Escalation holds from the third attempt onward, and a null last reason does not block it.**
  If attempts are ever raised above three, later attempts should not drop back to the cheaper tier.
- **The pass fails a diff only when it is strictly over the limit; evidence paths are normalised to forward slashes.**
  "Under the size limit" in the spec is read as at-or-under, and evidence should look the same on every OS.
- **Fare: per-unit costs keep 4 decimals; only the low and high totals round up to whole cents, after removing float noise.**
  `115 * 1.8` is `207.00000000000003` in floating point, and a bare ceiling would charge a cent that is not owed.
- **The budget cap passes when the total exactly equals the budget; cache-read share ignores output tokens.**
  "Fits the budget" includes spending all of it, and the share is about input caching only.
- **An acceptance command containing `;`, `&`, `|`, a backtick, `<`, `>`, `$(` or a newline is never allowed**, whatever the patterns say.
  A wildcard pattern like `pnpm *` would otherwise let a plan chain any shell command behind an allowed one.

## web-shell (2026-11-17)

- **No new web dependencies: plain CSS in `app/globals.css`, task cards instead of React Flow.**
  Adding Tailwind or React Flow changes the locked lockfile; both can replace the CSS and card grid later without touching `lib/`.
- **All UI wording lives in `apps/web/lib/copy.ts`, in plain language ("Projects", "Tasks", "Batch").**
  Code keeps glossary names; the themed copy (BULLETIN, military theme) becomes a one-file swap.
- **Browser code imports only types from `@bulletin/core`; `apps/web/lib/guards.ts` mirrors lanes and event types.**
  The core index re-exports `config.ts`, which reads `node:fs`, so a value import breaks the client bundle. Records keyed by the core types plus a test against `EVENT_TYPES` and `LANES` stop drift.
- **The war table rebuilds unit state from the event stream from id 0; `GET /missions/:id` only supplies the plan.**
  The spec says a reload rebuilds the map from the log; the reducer drops ids it has seen so reconnects with `?after=` cannot double count.
- **Mock mode is the default: `NEXT_PUBLIC_API_URL` unset serves `lib/mock.ts`.**
  The API routes are not merged yet, and `API_URL` in `.env.example` is not visible to browser code.

## 2026-11-17: add @anthropic-ai/sdk to apps/api
Needed for the Managed Agents runner adapter (apps/api/src/managed-client.ts). It is the official SDK; the runner itself stays dependency-free behind the ManagedClient interface, and tests use a fake.

## web-shell, real API (2026-11-17)

- **The web reads the API through pure adapters (`apps/web/lib/api-adapters.ts`) that tolerate missing fields.**
  `docs/API.md` omits a goal and unit titles; the pages fall back to the repo path and to titles from `plan.proposed`, and pick the fields up without changes if the API adds them.
- **`apps/web/test/api-live.test.ts` imports `buildServer` from `apps/api/src` by relative path, with a fetch-based EventSource stand-in.**
  It checks `lib/api.ts` against the real routes inside `pnpm test`; a workspace dependency on `@bulletin/api` would change the locked lockfile, and Node has no EventSource.
- **`agentRules: false` in `apps/web/next.config.ts`.**
  `next dev` otherwise writes its own `apps/web/AGENTS.md`, which would sit beside and contradict the repo's agent rules.

## web: guided /new flow (2026-11-17)

- **The interview is a pure reducer (`apps/web/lib/interview.ts`) and the page only wires it to the API.**
  Steps, back/skip, follow-up questions and the 10-question cap (spec F1) are tested without rendering; the page reuses the reducer to compute the answers it sends.
- **No Briefing routes means "start from the goal", not an error.**
  A 404/405 from `POST /briefings` opens the review step with the spec's Briefing template (section 8) filled from the goal, so the page works before and after Codex task 11 lands.
- **The plan request sends the reviewed Briefing as `goal` on `POST /missions`.**
  The route's schema is strict, so a new field would be rejected; `docs/API.md` already says the planner receives the goal "as `briefing`".- **Open questions the automatic answerer already tried get their own "Tried automatically, needs you" chip and a one-line reason.**
  Spec section 9 routes only SILENT or contradictory questions to a person, so saying the requirements were checked first tells the reader why it is theirs; questions asked directly through the API keep the plain "Needs an answer".- **`/demo` renders fixed scenarios (`apps/web/lib/fixtures.ts`) through the same view as the live mission page.**
  `WarTableView` takes a reduced state and has no data fetching, so the demo, the tests and the live page share one rendering path; `/demo` works with or without `NEXT_PUBLIC_API_URL`.
## web: plain-language copy (2026-11-17)

- **The web UI never shows the glossary or pipeline words below; it says project, task, batch, spending, requirements, tries, approval and "added to the project" instead.**
  The spec's themed and internal names suit code and logs, not a first-time reader. `apps/web/test/plain-language.test.ts` reads the next line and fails if any shown string (all of `apps/web/lib/copy.ts`, every activity-feed sentence, and literal text in `apps/web/app/**/*.tsx`) contains a term, matched case-insensitively at the start of a word:
  `forbidden-ui-terms: war table, mission, station, general, commander, dispatch, wave, treasury, courier, fog, unit, lane, attempt, ledger, merge, silent, payload, verdict, escalat, endpoint, sse, briefing`
  Exception: the Briefing document itself keeps the spec's `# Briefing:` heading (section 8), because it is the file the planner reads and the user edits as text.- **`/new` follows the API's one-question-at-a-time interview and drops Back.**
  Each answer is posted as it is given and the server writes the next question from it, so an earlier answer cannot be changed locally. The plan request sends `briefing_id` when the reviewed text is unchanged and the edited text as `goal` otherwise, because a `briefing_id` plan reads the stored Briefing and would ignore edits.- **Approve lives on the project page while it is in planning; Stop is not built yet.**
  `docs/API.md` documents `POST /missions/:id/approve` but no stop route, and the board says to hide Stop until it is listed. The approve refusals map to reasons in `toApproveResult`, and the over-budget numbers become one sentence ("estimated to cost at least…, that is … more than the … budget").
## web: /settings before GET /config is documented (2026-11-17)

- The page reads a guessed body: `{models:{roles,tiers}, prices:{as_of,models}, limits, default_budget_cents}`,
  the shapes of config/models.json and config/prices.json. The adapter also accepts roles and tiers at the top
  level and skips anything it cannot read. A 404 shows "settings not shared yet".
- The mock imports config/*.json instead of copying model names, so model ids stay out of code.
- Limits the copy has no label for are left out rather than shown under a raw key.
- Update: GET /config is now documented (roles, tiers, lanes, priced_models, limits). /settings follows it: priced model
  names instead of a price table, the default file rules, and the budget and per-task allowance as spend limits.
## web: /spend (2026-11-17)

- Totals come from GET /missions plus one GET /missions/:id/treasury per project (cost_cents and budget_cents).
  No new route is needed; one request per project is fine at the scale the spec describes.
- The warning and over-budget rule lives in one place (budgetLevel in lib/treasury.ts), so the project page
  and /spend cannot disagree. Projects without a budget are counted separately, not added to the total budget.
## web: held tasks panel (2026-11-17)

- "Held for your OK" lists tasks the engine held (unit.held / decision.opened with kind closed_lane_merge or
  gated_retry). Question decisions stay on /questions.
- The reducer stores the decision on the task card, and the choice from decision.resolved `payload.choice`.
  Decision events for tasks the plan does not list are ignored, so they never create stray cards.
- Approving says plainly that the choice is saved but held tasks are not added automatically yet, matching
  Codex task 21 ("recording only").
## web: rules and lessons page (2026-11-17)

- /missions/:id/lessons parses the line formats packages/graph writes (lessonLine, promoteLessons) and shows
  both lists newest first (last line in the file first). The test builds its input with those functions,
  imported by relative path because apps/web does not depend on @bulletin/graph (no lockfile change).
- Hand-written bullets are kept; a learned rule reads "Plan so this does not happen again: <reason>".
## web: plan dependency graph (2026-11-17)

- Hand-drawn SVG from a pure layout function (lib/graph-layout.ts): one column per batch, plan order inside a
  column, fixed node sizes, so nodes cannot overlap. No graph library, so no new dependency.
- The drawing sits in a closed <details> above the task board, with the same facts as sentences
  ("X waits for Y") for screen readers and narrow screens.
## web: stopped and interrupted projects (2026-11-17)

- The reducer reads how mission.finished ended things: payload.stopped, payload.interrupted, payload.status
  "failed", otherwise done. After an early end, a running card reads "Stopped before it finished" and a
  waiting one "Not started", so nothing looks busy on a project that has ended.
- The project list accepts "stopped" and "interrupted" statuses, and finished + stopped/interrupted flags,
  for when Codex task 20 lands. "failed" now reads "Failed" instead of "Stopped".
- Stop is now shown (POST /missions/:id/stop is documented), behind a confirm step. This supersedes
  "Stop hidden" above.
## 2026-11-17: ship as a Tauri 2 desktop app (Windows first)
Founder decision, recorded in docs/SPEC.md (Platform section, which wins over sections 0, 5, 6, 7, 14, 15). UI becomes React + Vite + Tailwind + React Flow in Tauri; a Rust core supervises processes, worktrees, SQLite and credentials; the existing TypeScript engine, General, runners and Anthropic SDK code become the bundled sidecar, spoken to over JSON-RPC on stdio. Why: the user wants an installable app; the local runner needs the user's own machine and login anyway. The Fastify API and Next.js web app stay as a headless/dev surface until the desktop app replaces them.
## bulletin-mcp: MCP server (2026-11-18)

- New dependency `@modelcontextprotocol/sdk` (^1.32.2) in packages/bulletin-mcp: the official MCP server/client with stdio and in-memory transports. Why: spec section 10 makes the Bulletin an MCP server; hand-rolling the protocol would be worse. pnpm-lock.yaml changed by `pnpm add`, not by hand.
- The server takes an injected `store` (dispatches, Briefing) and `answerer` (cache, model, human pipeline), so it needs no model in tests. One server instance serves one attempt and holds that attempt's question count (default cap 10). The first question over the cap posts one `blocker` dispatch so the General sees it; later ones only get an error.
- Dispatch text is returned as a `<dispatch>` block with every line prefixed `> ` and `<` escaped, so it cannot forge the closing tag.
## sdk-station-runner: default station agent loop (2026-11-18)

- `packages/runners/src/sdk-station-runner.ts` runs a Messages API tool loop against an injected `ModelClient` (request/response shapes follow the Messages API, so the sidecar adapter over `@anthropic-ai/sdk` or Bedrock is a thin wrapper). No new dependency. New runner kind `"sdk-station"`.
- Tools: read_file, write_file, list_files, run_command. Paths must be relative, stay inside the attempt worktree (lexical check plus a realpath check on the nearest existing ancestor, so links that leave it are refused), and never touch `.git`.
- run_command is allowed only for patterns passed in `allowedCommands` plus the unit's own acceptance commands (glob-style, same metacharacter ban as plan validation). It runs without a shell, except pnpm/npm/npx/yarn on Windows, which are `.cmd` shims. Path-like arguments that are absolute or contain `..` are refused. This is a policy gate, not an OS sandbox; the pass decides what is accepted.
- Cost: the runner does not read config/. An optional injected `costOf(model, usage)` prices each call, and with it the loop stops when the unit's `allowanceCents` is spent. Without it, usage events carry no cost and the engine prices them from config as it does today.
- Failures the model can fix (refused path, refused command, non-zero exit) go back to it as tool results; model errors, cancel, max turns (default 40) and allowance end the attempt with `done ok:false` and no commit.
## resolveHeld: resuming held units (2026-11-18)

- `apps/api/src/orchestrator/resolve-held.ts` exports `resolveHeld({...missionOptions, unitId, resolution, history, events})`. It acts after the mission has finished (held units are left unmerged and their dependents blocked), so it needs the mission's event history: statuses are rebuilt from unit.* events (`statusesFromEvents`) and the branch comes from the unit.held event. It does not emit decision.resolved; the route that takes the human's answer does.
- Outcomes: `merged` (with `unblocked` and a `report` when dependents ran), `rejected`, `conflict` (branch no longer merges; nothing changes, unit stays held), `not_held` (never held or already resolved, so a double click is harmless), `mission_running` (no mission.finished yet; the engine still owns the integration branch, so the route should answer 409 and retry later).
- Approve merges `--no-ff` in a temporary checkout of the integration branch, emits `unit.merged`, then continues the mission through `runMission({ resume })`: same integration branch, no new mission.created or plan events, wave numbers and spend carried over (so `budgetCents` covers the whole mission), and a second `mission.finished` with `resumed: true`. No new event types, so existing readers keep working.
- Dependents revived are the blocked ones downstream of the approved unit, unless they also sit downstream of a unit that failed or is still held. A mission that ended stopped or budget-paused only gets the merge, no new work.
- Reject emits `unit.failed` with reason `rejected`; dependents stay blocked.
- Open for Codex when wiring the route: approving while the mission is still running returns `mission_running`; the engine does not yet pick up a decision mid-run.
## Pass without Docker: supervised subprocess with kill-tree (2026-11-18)

- The pass already ran the checks in a clean detached worktree of the unit branch, with check configuration (locked paths) read from the integration branch. What was missing was a real timeout: `child.kill()` on Windows only killed the cmd.exe wrapper, so a hung check and its children lived on and held the pipes, which could hang the pass forever.
- `runCommand` now kills the whole tree on timeout (`taskkill /T /F` on Windows, retried because it goes through WMI and can fail under load; the process group on POSIX), returns exit code 124 with "timed out after Ns and was killed", and always settles. `PassInput.commandTimeoutMs` sets the limit (default 10 minutes).
- Programs start directly; only pnpm/npm/npx/yarn go through cmd.exe on Windows, because they are `.cmd` shims. Argument rules (no shell characters) are unchanged.
- Known limit: a process that starts a grandchild at the instant of the kill, or a taskkill that keeps failing, can leave an orphan. Real containment on Windows is a Job Object with kill-on-close, which belongs in the Rust core (see BULLETIN.md).
