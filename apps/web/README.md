# @bulletin/web

**Legacy.** Bulletin’s product UI is now `@bulletin/desktop` (Vite + React + Tailwind + React Flow, destined for Tauri). Keep this Next.js app for headless/dev and until the coordinator retires it; do not add new product features here. Prefer `apps/desktop`.

The Bulletin web app (Next.js App Router). Pages:

- `/` lists projects (missions).
- `/missions/[id]` shows tasks by batch with live status, tries and spend, a spending panel, and the activity feed.
- `/questions` lists questions from the agents and takes answers.
- `/new` is a guided flow: goal and repository, a few questions (one at a time, each skippable), the
  written requirements for review and editing, then the plan or its validation errors.
- `/demo` shows fixed sample projects (running, waiting for approval, sent back, over budget, paused) from
  `lib/fixtures.ts`. It never calls the API.

All UI text lives in `lib/copy.ts`, in plain language. All network calls go through `lib/api.ts`.

## Run with mock data

No API needed. Leave `NEXT_PUBLIC_API_URL` unset:

```
pnpm install
pnpm dev:web
```

Open http://localhost:3000. Mock data comes from `lib/mock.ts`: two projects, a replayed event stream for
"Add due dates…", four questions, and a canned planner (a goal containing "broken" returns plan errors).
Answers and new plans in mock mode live only in the browser tab.

## Run against the real API

1. Start the API (Fastify, port `API_PORT`, default 4000):

   ```
   pnpm dev:api
   ```

   The standalone API starts with an empty in-memory event log and no model, so `/new` returns
   "Mission planning failed" until a model is configured. To keep events between restarts, run
   `pnpm --filter @bulletin/api exec tsx src/serve.ts` instead (JSONL event store, `PORT`, default 4000).
   See `docs/API.md` for the routes.

   Until the API has Briefing routes, `/new` skips the questions and starts the requirements from the goal.

2. Start the web app on port 3000 with the API address. The API only allows browser requests from
   `http://localhost:3000`, so keep that port.

   PowerShell:

   ```
   $env:NEXT_PUBLIC_API_URL = "http://localhost:4000"; pnpm dev:web
   ```

   bash:

   ```
   NEXT_PUBLIC_API_URL=http://localhost:4000 pnpm dev:web
   ```

`NEXT_PUBLIC_API_URL` is read when the app starts in dev, and baked in at build time for `next build`.
Unset it (and rebuild) to go back to mock data; a leftover value in your shell is the usual reason a
page shows "Something went wrong".

## Tests and checks

From the repository root:

```
pnpm vitest run apps/web        # web tests only
pnpm run verify                 # install, lint, typecheck and all tests
pnpm --filter web build         # production build
```

The pure logic is tested directly: the event reducer (`lib/war-table.ts`), spending (`lib/treasury.ts`),
questions, the `/new` interview (`lib/interview.ts`), new-project validation, plan batches, API adapters,
the demo fixtures, and copy rules. `test/plain-language.test.ts` fails if shown text uses a term from the
`forbidden-ui-terms` line in `docs/DECISIONS.md`. `test/api-live.test.ts`
boots the real API routes from `apps/api` in-process and runs `lib/api.ts` against them, including the
event stream.

## Notes

- Browser code imports only types from `@bulletin/core`; its index also pulls in `node:fs`. Runtime lists
  that the browser needs (lanes, event types) are mirrored in `lib/guards.ts`, and a test pins them to core.
- Light and dark themes follow the system setting; colors are CSS variables in `app/globals.css`.
