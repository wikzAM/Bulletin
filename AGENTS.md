# Bulletin: instructions for any coding agent (Codex, Cursor, Claude Code)

Read `CLAUDE.md` (repo rules) and `docs/SPEC.md` (the product spec) first. They apply to you too.

## Your loop
1. Work only in your own git worktree and branch (see `docs/WORKBOARD.md`). Never edit `D:\Bulletin` main directly.
2. Take one unit from `docs/WORKBOARD.md`. Touch only the files listed for it.
3. Write the failing test first, then the code.
4. Run `pnpm run verify` (install, lint, typecheck, tests). It must pass before you stop.
5. Commit on your branch. Do not merge; the Claude Code session merges after verify.

## Hard rules
- Commits are authored by `wikzAM` only. No `Co-Authored-By` trailers, no tool attribution lines.
- Never edit: `docs/SPEC.md`, `pnpm-lock.yaml`, `config/*`, `eslint.config.js`, `tsconfig.json`, `vitest.config.ts`, `.workbench.json`.
- Never weaken, skip or delete a test. Never commit secrets.
- Shared contracts live in `packages/core`. If you need a contract change, add a question to `BULLETIN.md` and stop on that unit; do not edit core in a unit that does not own it.
- New dependencies need a line in `docs/DECISIONS.md`, and a lockfile change must be flagged on `BULLETIN.md`.
- If the same failure comes back twice, stop and write it to `BULLETIN.md`.

## Setup
```
git worktree add D:\wt-<tool> -b <tool>/<unit> main
cd D:\wt-<tool>
pnpm install
```
