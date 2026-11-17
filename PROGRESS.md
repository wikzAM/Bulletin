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
- M1 engine is on main (validate-plan, waves, send-back, merge-policy, judge, treasury, runMission, pass runner), plus the General (`bulletin plan --goal`, falls back to Opus when Fable has no credits), the local Claude Code runner and the Managed Agents runner (`bulletin run --runner managed`). Verified live: a local 3-unit mission (3/3 green) and a cloud mission on Managed Agents (2/2 green, $0.0485).
- War table API (Codex) and web shell (Cursor) are merged; main verify is 496 tests. The API covers Briefing interview, plan, approve, stop, treasury, questions, decisions, rules, report, bearer auth, restart recovery. The engine enforces a hard mission budget and a stop signal. A full run through the HTTP API (General, station, merge) was verified live for $0.144. Overnight coordination runs from `docs/board/`.
- `graph.py` runs stations end to end now that `claude` is logged in (verified on a scratch repo). It needs `.workbench/` in `.gitignore`.
- GitHub rejects `.github/workflows/*` until gh has the `workflow` scope; the CI commit waits on branch `ci-workflow`.
- Docker Desktop will not start: stale socket entries in `%LOCALAPPDATA%\Docker\run` give access denied when removed (see BULLETIN.md). `docker compose up` is unverified.

## Next
Wire the API entry (`serve.ts`) and finish the web shell against the real API; add the Treasury hard stop to the managed path; Docker and the CI workflow (needs `gh auth refresh -s workflow`); open founder decisions on BULLETIN.md.

## Never
- Never put prices or model ids in code (config/ only).
- Never let a unit own `.bulletin/**`, check configuration, or CI files.
- Never add a commit trailer or co-author; commits are authored by wikzAM only.
