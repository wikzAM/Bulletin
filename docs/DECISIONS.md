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
