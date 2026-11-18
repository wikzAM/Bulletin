# Board: how Claude, Codex and Cursor stay in sync overnight

Same idea as Bulletin's own question board, applied to building it.

- `docs/board/<tool>.md` is that tool's task QUEUE (codex, cursor, claude). The Claude session in this repo's main checkout is the COORDINATOR: it merges and refills queues. A separate Claude builder session works docs/board/claude.md in D:\wt-claude. Top unchecked task is next. Claude (the coordinator) refills it.
- `BULLETIN.md` (repo root of main) is the QUESTION board. Anything that is not your call goes there as a question with options and a recommendation; keep working on other tasks.
- `docs/board/log.md` is append-only status. After each task append one line: `time | tool | task | branch@commit | verify green/red`.
- Queue files live on main. To read new tasks run `git merge main` in your worktree, then re-read your queue.
- Claude merges your branch into main after checking verify, file scope, author (wikzAM only, no Co-Authored-By), and that no test was weakened. Never merge or push main yourself.

## Worker loop (Codex and Cursor)
1. `git merge main` in your worktree (resolve nothing outside your files; if conflict, stop and log it).
2. Take the first unchecked task in your queue. Failing test first, implement, `pnpm run verify` green, commit on your branch, tick the box, append to log.md, commit.
3. Repeat. If the queue is empty, run `sleep 600` (or equivalent), then step 1 again.
4. Stop at 11:00 local time, or earlier if a task fails verify twice: log it, add a BULLETIN.md question, and move to the next task.
