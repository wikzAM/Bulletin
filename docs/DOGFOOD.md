# Dogfood run: one real project, four numbers

The spec's gate after the desktop app (M3) is: run one real project through Bulletin and record all four success
metrics before building further (docs/SPEC.md, "Dogfood gate" and "Success metrics"). This page is the checklist for
that run and the table to fill in. It has not been run yet; the person who owns the project does the run.

Install first with [INSTALL.md](INSTALL.md).

## What counts as a good project

A small piece of real work you would otherwise do yourself: a hackathon build or a class project, in a Git repository
with at least one commit, that has an automatic check (`npm test`, `pnpm test` or similar) that passes before you
start. Aim for something that splits into roughly 5 to 15 tasks. Do not use the to-do sample; that is for practice.

## Before the run

1. Install the app and finish the first-run screen. Write down which provider you chose (Claude Code login, API key,
   Bedrock).
2. In the project folder, run the project's check by hand and confirm it passes. Write down the command.
3. Note the starting commit: `git rev-parse HEAD`.
4. Write the goal in one or two sentences and keep the exact text.
5. Decide the spending limit you are willing to lose, and write it down. The default is shown on **Settings**.
6. Check whether the project already has `.bulletin\rules.md` (rules Bulletin learned in earlier runs). If it does not,
   the "repeat returns" number below will be 0 by definition on this run; say so in the notes.

## During the run

Do exactly what the app asks, and nothing more, so the touch count is honest.

1. **New project**: enter the goal and the folder. Answer the questions or skip them. Review the requirements text and
   change it only if it is wrong. **Make a plan**, read it, **Approve plan and start**.
2. Do not edit files in the repository while the run is going.
3. Answer questions that reach you, and approve or reject held tasks, only when the app shows them. Write down each
   time you did something (the app counts them too; compare at the end).
4. If you stop the run, or the app restarts, write down why and when. A stopped or interrupted run still has a report, but
   say so in the notes.
5. When it finishes, open the project page. The **Receipt** on it is the first place to read numbers.

## After the run: where each number comes from

The Receipt on the project page shows: shipped, held, failed and blocked task counts, **touches**, and **spent**. It does
not yet show the rates (the project's "Report" page says "Coming soon"). The rates come from the engine's report, which
you can read straight from the recorded history:

1. Close Bulletin completely. One process may use the history at a time, and the commands below open it.
2. From the repository folder, in a terminal:

   ```powershell
   pnpm --filter @bulletin/api exec tsx src/serve.ts
   ```

   It prints `api listening on http://127.0.0.1:4000`. If you moved the data with `BULLETIN_DATA_DIR`, set the same
   variable first. If `BULLETIN_API_TOKEN` is set in your environment, requests need `Authorization: Bearer <token>`.
3. In a second terminal, list the projects and read the report for yours:

   ```powershell
   curl.exe http://127.0.0.1:4000/missions
   curl.exe http://127.0.0.1:4000/missions/<project id>/report
   ```

   The report has `shipped`, `held`, `failed`, `blocked` (lists of task ids), `attempts`, `model_calls`, `cost_cents`,
   `cost_per_green_unit_cents`, `touches`, `touch_rate`, `auto_answer_rate` and `elapsed_ms`. A value of `null` means it could not
   be worked out (for example `touch_rate` when nothing shipped, `auto_answer_rate` when nobody asked a question).
4. Stop the server with Ctrl+C when done, then reopen Bulletin.

| Number | Target (spec) | Where to read it | How it is worked out |
| --- | --- | --- | --- |
| **Touch rate** | under 0.3, trending to 0.1 | `touch_rate` in the report. The Receipt shows `touches` and the shipped count, so touches ÷ shipped gives the same figure. | Human touches ÷ tasks shipped. A touch is a decision you resolved or an edit after the first requirements and plan; approving the plan counts as one touch; a human answer and the requirements version it creates count as one. |
| **Auto-answer rate** | over 70% | `auto_answer_rate` in the report (not on the Receipt). | Questions the agents asked that were answered from the requirements or from an earlier answer, ÷ all questions, including ones still waiting. |
| **Cost per green unit** | tracked, falling across runs | `cost_per_green_unit_cents` in the report. The Receipt's **spent** divided by tasks that passed is close, but the report's figure counts held tasks as passed and does not count a pass that was sent back after a failed merge. | Total recorded model spend ÷ distinct tasks that passed their checks, in cents. |
| **Repeat returns** | trending to zero | Not in the report; count by hand (below). | Tasks sent back for a reason that was already written as a rule in `rules.md`. |

### Counting repeat returns

1. List every send-back with its reason. Save this as `sent-back.mjs` (Node 24 or newer), then run it:

   ```powershell
   @'
   import { DatabaseSync } from "node:sqlite";
   const [file, mission] = process.argv.slice(2);
   const db = new DatabaseSync(file, { readOnly: true });
   const rows = db.prepare("select id, unit_id, payload from events where mission_id = ? and type = 'unit.sent_back' order by id").all(mission);
   for (const row of rows) console.log(row.id, row.unit_id, JSON.parse(row.payload).reason);
   console.log(rows.length + " sent back");
   '@ | Set-Content sent-back.mjs
   node sent-back.mjs "$env:LOCALAPPDATA\Bulletin\events.sqlite" <project id>
   ```

   (Use your `BULLETIN_DATA_DIR` instead of `%LOCALAPPDATA%\Bulletin` if you set one. The file is only read. Delete
   `sent-back.mjs` afterwards.)
2. Open the project's **Lessons** page (or `curl.exe http://127.0.0.1:4000/missions/<project id>/rules`). Lessons are
   written each time a task is sent back; a reason that comes back twice is promoted to a rule in `rules.md`.
3. To see when each rule appeared, in the project folder:

   ```powershell
   git log --format="%h %s" bulletin/<project id>/integration -- .bulletin/rules.md .bulletin/lessons.md
   ```

4. A send-back is a **repeat return** if its reason matches a rule that already existed when it happened: a rule
   from an earlier run, or one promoted earlier in this run. Count those. If the project had no rules at the start, the
   first send-back for each reason is never a repeat, so this run's figure can only be above 0 if the same reason came
   back after being promoted. The number becomes meaningful from the second run on.

## Also record (not targets)

Tasks planned, shipped, held, failed and blocked; attempts and model calls; elapsed time (`elapsed_ms`); the plan's
estimated cost against the actual cost (the plan page shows the estimate); how many questions you personally
answered; and one sentence on anything that surprised you or that you had to work around. The targets in the spec are
starting guesses and are to be revised after this run, so write down what you think they should be.

## Results

Fill in one row per run. Keep the command output (the report JSON) with the table.

| Run | Date | Project and goal | Provider | Limit | Planned | Shipped | Held | Failed | Blocked | Touches | Touch rate | Auto-answer rate | Cost (cents) | Cost per green unit (cents) | Repeat returns | Elapsed | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | | | | | | | | | | | |
| 2 | | | | | | | | | | | | | | | | | |
| 3 | | | | | | | | | | | | | | | | | |

Targets for reference: touch rate under 0.3 (trending to 0.1); auto-answer rate over 70%; cost per green unit tracked and
falling; repeat returns trending to zero.

## When the gate is passed

The spec asks only that all four numbers are recorded before continuing. After the first run, copy the row into
`PROGRESS.md` and note which targets were missed and what you would change, in `docs/DECISIONS.md` if it changes how
Bulletin works.
