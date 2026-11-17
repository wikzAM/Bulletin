# Bulletin: rules for agents working on this repo

- Read docs/SPEC.md before starting. Build milestone by milestone; a milestone is done
  only when every acceptance check in section 15 passes.
- When the spec is silent, add a question to docs/QUESTIONS.md, pick the most reversible
  option, note it, and keep going.
- Record non-obvious choices in docs/DECISIONS.md: the decision, then why.
- TypeScript strict. No new dependency without a DECISIONS.md line.
- Never weaken, skip, or delete a test to make it pass. Never edit .bulletin/ or check
  configuration to pass a check.
- Model IDs and prices live in config/, never in code.
- Every state change emits an event defined in packages/core.
- Never commit secrets; use the names in .env.example.
- Before calling a task done, run: pnpm lint && pnpm typecheck && pnpm test

## Where things are

- `packages/core` is the shared contract: types, zod schemas, event types, lanes, plan validation.
  Change a contract there first, in the same change as its callers.
- Packages export TypeScript source directly (`exports` points at `src/index.ts`); there is no
  build step for local work. `tsx` runs the api and the pass-worker, `vitest` runs tests.
- One check for the whole repo: `pnpm run verify` (install, lint, typecheck, tests). It must stay
  fast, because the workbench gate and every graph station run it.
- PROGRESS.md says which milestone is in flight and what is verified. BULLETIN.md holds open
  questions for the founder.
