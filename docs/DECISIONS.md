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
  Exception: the Briefing document itself keeps the spec's `# Briefing:` heading (section 8), because it is the file the planner reads and the user edits as text.