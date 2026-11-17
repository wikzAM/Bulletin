# Progress

## Goal
Build the Bulletin MVP from docs/SPEC.md, one milestone at a time (section 15).

## Done means
Every acceptance box of the milestone in flight is proven by an automated test or a recorded run.
`pnpm run verify` is the repo check.

## Tried
- TypeScript 7 with typescript-eslint 8: ESLint refuses to load. Pinned TypeScript 6.
- `corepack enable pnpm`: EPERM on `C:\Program Files\nodejs`. Installed pnpm with `npm install -g pnpm@10`.

## Known
- M0 boxes: monorepo + `pnpm i && pnpm test` green (verified); CLAUDE.md, .env.example, QUESTIONS, DECISIONS
  exist (verified); examples/todo-app with passing tests (verified); CI workflow written (not yet seen running);
  `docker compose up` + `/health` (see BULLETIN.md if not verified).
- Graph stations start without node_modules, so the check installs first.
- Stubs that throw "not implemented" mark the M1 logic cut into graph units: validate-plan, waves,
  send-back, merge-policy, judge, treasury.

## Next
Merge the M1 logic units from the graph run, then wire the M1 chain in one session: the General call,
LocalClaudeCodeRunner, the pass-worker check runner, and `bulletin run`.

## Never
- Never put prices or model ids in code (config/ only).
- Never let a unit own `.bulletin/**`, check configuration, or CI files.
- Never add a commit trailer or co-author; commits are authored by wikzAM only.
