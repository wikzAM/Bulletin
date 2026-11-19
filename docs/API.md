# War table API

Mission reads project the event log. A mission becomes visible after its
`mission.created` event.

The desktop sidecar uses the same JSON routes through `request` and delivers
mission events through `subscribe`. See [Sidecar protocol](SIDECAR.md).
The first-run methods `env.check`, `repo.inspect`, `settings.get`, `settings.set`,
`secret.has` and `secret.set` exist only on the sidecar. They have no HTTP routes
because they describe the machine the desktop app runs on.

## Running the API

From the repository root, run this command.

```sh
pnpm --filter @bulletin/api exec tsx src/serve.ts
```

The API binds to `127.0.0.1` and reads `PORT`, with `4000` as the default.
`PORT=0` assigns a free port and prints the listening address. Set
`NEXT_PUBLIC_API_URL=http://localhost:4000` for the web client on port `3000`.
Planning, interviews, and automatic answers use Claude Code by default. Put
`claude` on `PATH` and configure its login for that mode. Set
`BULLETIN_PROVIDER=anthropic` or `BULLETIN_PROVIDER=bedrock` to use that provider's
SDK and environment credentials. The server loads model and price settings from
`config/models.json` and `config/prices.json`.
If the General's primary model call fails, the server tries the configured
fallback with the same request.

Mission execution uses `BULLETIN_RUNNER=claude` by default. Set
`BULLETIN_RUNNER=managed` and `BULLETIN_SANDBOX_REPO` to run stations in Managed
Agents. The mission's local repository must be a clone of that sandbox
repository. Startup warns by variable name when required configuration is
missing. See [Managed Agents setup](MANAGED-AGENTS.md).

The API and sidecar store mission events in `events.sqlite` using Node 24's
built-in SQLite driver. Set `BULLETIN_DATA_DIR` to override the directory.
Defaults are `%LOCALAPPDATA%\Bulletin` on Windows,
`~/Library/Application Support/Bulletin` on macOS, and
`$XDG_DATA_HOME/Bulletin` or `~/.local/share/Bulletin` on Linux. Run one API
or sidecar process per log.

On first startup with an empty database, the server imports existing events
from `.bulletin-scratch/api/events.jsonl` and its numbered segments. This
preserves their IDs and timestamps. Set `BULLETIN_EVENT_STORE=jsonl` to use that
legacy store. Set `BULLETIN_SCRATCH_DIR` to relocate JSONL logs and worktrees.
Relative scratch paths resolve from the repository root. JSONL logs rotate at
16 MiB into numbered sibling files. Recovery discards an incomplete final line
in the active segment and reports the location of corruption in archived segments.

At startup, every stored mission without a `mission.finished` event receives
one with `payload.interrupted: true`. Its earlier events remain available.

## Server configuration

`buildServer(log, options)` accepts `modelCall`, `interviewerCall`, and
`answererCall` for model calls. Pass `{ models, prices }` as `config` for the
settings response and plan approval. The `pricing` option overrides approval
pricing with `{ prices, tiers }`. The `startMission` callback receives the validated plan, repository,
base branch, Briefing Markdown or goal as `briefing`, an abort `signal`,
`budgetCents` when saved, and an event sink backed by `log`. For engine runs
started in the same process, pass the same log to
the engine's `events` option.

`briefingStore` and `questionStore` override the state stores. `buildServer()`
uses in-memory defaults. The runnable API uses SQLite for mission events by
default and JSONL for Briefing interviews. Question board entries reset with the in-memory store. Question
dispatches and decisions remain available in the mission stream after a restart.
The `readGit` option supplies the Git reader for mission rules and lessons.

## HTTP conventions

Send write bodies as `application/json`. Question and answer text is trimmed
and must contain a non-whitespace character.

`BULLETIN_WEB_ORIGINS` accepts a comma-separated list of allowed browser
origins and defaults to `http://localhost:3000`. Matching browser preflights
return `204 No Content` without credentials. They allow `GET`, `HEAD`, `POST`,
and `OPTIONS` and accept `Authorization`, `Content-Type`, and `Last-Event-ID`.
JSON read routes also accept `HEAD` and return headers only.

When `BULLETIN_API_TOKEN` is set to a nonempty value, send
`Authorization: Bearer <token>` with every API request except `GET /health`.
A missing or invalid token returns `401` and `WWW-Authenticate: Bearer`.
Token-protected SSE requires a client or proxy that can send the header.

## Errors

Error responses include an `error` string. Planning and budget errors can
include the additional fields shown on those endpoints.

- `400 Bad Request`. `Invalid request` for malformed JSON, parameters, or fields. `Invalid event cursor` for malformed SSE cursors.
- `401 Unauthorized`. `Unauthorized` when the API requires a bearer token and the request credentials are invalid or absent.
- `404 Not Found`. `Route not found`, `Mission not found`, `Briefing not found`, `Question not found`, `Open decision not found`, or `Mission integration branch not found`.
- `409 Conflict`. `Briefing is incomplete`, `Briefing is not awaiting this answer`, `Mission already approved`, `Mission has no plan to approve`, `Plan exceeds mission budget`, `Mission is not running`, `Mission has not finished`, `Decision resolution in progress`, `Question already answered`, `Auto-answer already in progress`, or `Mission has no completed Briefing`.
- `413 Payload Too Large`. `Payload Too Large` when the body exceeds the server's request limit.
- `415 Unsupported Media Type`. `Unsupported Media Type` when the server cannot parse the requested content type.
- `422 Unprocessable Entity`. `Repository unavailable`, `Mission planning failed`, or `Plan cannot be priced`.
- `500 Internal Server Error`. `Internal server error` on an unexpected server failure.
- `502 Bad Gateway`. `Interviewer failed` or `Answerer failed` when an injected model call fails or output remains invalid after a retry.
- `503 Service Unavailable`. `Mission planning failed`, `Interviewer not configured`, `Answerer not configured`, `Mission pricing not configured`, or `Mission runner not configured`.

## `GET /health`

Returns `200 OK` with `{"status":"ok","service":"api"}`.

## `GET /config`

Returns `200 OK` with the configured model names for each role and tier,
default lane patterns, sorted names of models in the price table, and default
spending limits in cents. The response includes only these settings.

```json
{
  "roles": { "general": { "model": "example-general", "fallback": "example-fallback" } },
  "tiers": { "station": "example-station" },
  "lanes": { "closed": ["infra/**"], "gated": ["**/package.json"] },
  "priced_models": ["example-general", "example-station"],
  "limits": { "default_budget_cents": 500, "unit_allowance_cents": 200 }
}
```

Role model records may include `fallback` and `escalate` alongside `model`.
Repository-specific lane rules are read from each repository when planning
and running a mission.

## `POST /briefings`

Send `{"goal":"Seed the demo with test data"}` to start the interview. Returns
`201 Created` with the current interview. The Interviewer asks one question at
a time, up to ten questions, and may write the Briefing sooner.

```json
{
  "id": "ef497d44-0aff-4230-9aa3-573b24efb979",
  "goal": "Seed the demo with test data",
  "status": "interview",
  "question": "Who will use the seed data?",
  "question_number": 1,
  "version": null,
  "markdown": null
}
```

When complete, `status` is `complete`, `version` is `1`, and `markdown`
contains the full Briefing. `question` and `question_number` become `null`.
The runnable API stores interviews in `.bulletin-scratch/api/briefings.jsonl`.

## `POST /briefings/:id/answers`

Send `{"question_number":1,"answer":"Developers running the demo locally."}`.
Send `"answer":null` to skip the question. Returns `200 OK` with the updated
interview. A stale question number, an answer already being processed, or a
completed interview returns `409 Conflict` with
`{"error":"Briefing is not awaiting this answer"}`.

## `GET /briefings/:id`

Returns `200 OK` with the same interview shape, including the full Markdown
when complete. Unknown IDs return `404 Not Found` with
`{"error":"Briefing not found"}`. Starting or answering an interview returns
`503 Service Unavailable` with `{"error":"Interviewer not configured"}` when
the model is unavailable in server configuration. If a model call fails or
invalid output persists after a retry, the response is `502 Bad Gateway` with
`{"error":"Interviewer failed"}` and the previous interview state is retained.

## `GET /missions`

Returns `200 OK` with missions ordered by their creation event, oldest first.
An empty log returns `{"missions":[]}`.

Use `status` to filter to one of `interview`, `planning`, `running`, `finished`,
`failed`, `interrupted`, or `paused`. Use `limit` to keep the first N matching
missions, such as `/missions?status=planning&limit=10`. With `limit=0`, the
result is empty. Invalid values or duplicate filters return `400 Bad Request`.
The limit must be a non-negative safe integer written in decimal digits.

```json
{
  "missions": [
    {
      "id": "demo",
      "repo": "D:/repos/todo-app",
      "base": "main",
      "created_at": "2026-11-17T14:00:00.000Z",
      "status": "running"
    }
  ]
}
```

`repo` and `base` come from `mission.created` and are `null` when absent.
Status starts at `interview`, advances to `planning` on `briefing.versioned` or
`plan.proposed`, advances to `running` on `plan.approved`, and becomes `finished`
on `mission.finished`. A `mission.finished` event with `payload.status` set to
`failed` sets the mission status to `failed`. A `mission.finished` event with
`payload.interrupted: true` sets it to `interrupted`. A finish event with
`payload.paused: true` sets it to `paused`.

## `POST /missions`

Send `{"goal":"Seed the demo with test data","repo":"D:/repos/todo-app"}`.
Set `budget_cents` to a non-negative integer to choose a budget. The default
for new API missions is `500` cents.
Include `briefing_id` to plan against a completed interview. A missing
Briefing returns `404` with `{"error":"Briefing not found"}`. A Briefing in
progress returns `409` with `{"error":"Briefing is incomplete"}`.
The API reads the current commit of the local Git repository and runs the
General with the goal and repository map. It returns `201 Created` when the
General produces a valid `@bulletin/core` `Plan`.

```json
{
  "mission_id": "4f92d548-5474-468c-9270-2b1c0448fcb7",
  "attempts": 1,
  "plan": {
    "briefing_version": 1,
    "units": [
      {
        "id": "seed-data",
        "title": "Seed the demo",
        "task": "Add seed data for demo tests.",
        "files": ["src/seed.ts"],
        "needs": [],
        "lane": "open",
        "tier": "station",
        "acceptance": ["pnpm test"]
      }
    ]
  }
}
```

Success emits `mission.created` with `goal`, `repo` (the local repository root),
`base`, and `budget_cents`, then `plan.proposed` with the validated `plan` and
the `units` count.
When `briefing_id` is supplied, the API also emits `briefing.versioned` with
`briefing_id`, `version`, and `markdown` before proposing the plan.
The new mission is visible in `GET /missions` with status `planning`.

- `400 Bad Request` for invalid JSON fields, with `{"error":"Invalid request"}`.
- `422 Unprocessable Entity` for an unreadable Git repository, with `{"error":"Repository unavailable"}`.
- `422 Unprocessable Entity` for planning errors, or `503 Service Unavailable`
  when the API lacks a configured model. Both return `{"error":"Mission planning failed","errors":[...],"attempts":2}`
  with the number of attempts made. A failed request leaves the event log unchanged.

## `GET /missions/:id`

Returns `200 OK` with the mission fields from the list, plus units and ledger
totals.

```json
{
  "id": "demo",
  "repo": "D:/repos/todo-app",
  "base": "main",
  "created_at": "2026-11-17T14:00:00.000Z",
  "status": "running",
  "units": [
    { "id": "seed-data", "status": "merged", "lane": "open", "wave": 1 }
  ],
  "ledger": { "cost_cents": 1.25, "charges": 1 }
}
```

Units appear in the order their IDs first occur in `wave.started` or in an
event's `unit_id`. `lane` and `wave` are `null` until reported. Unit statuses
use the `@bulletin/core` values. A unit starts as `pending`, then follows unit,
attempt, and pass events.

`ledger.charges` counts events with a finite numeric `payload.cost_cents` in
`ledger.charged`. `ledger.cost_cents` sums those costs, rounded to four decimal
places in cents. Both fields start at zero.

## `GET /missions/:id/treasury`

Returns `200 OK` with the mission budget, total spend, and spend for each known
unit. Units use the same discovery order as mission detail.

```json
{
  "mission_id": "demo",
  "budget_cents": 500,
  "cost_cents": 1.25,
  "remaining_cents": 498.75,
  "charges": 2,
  "units": [
    { "id": "seed-data", "cost_cents": 1, "charges": 1 },
    { "id": "review", "cost_cents": 0, "charges": 0 }
  ]
}
```

Totals use the same charge rules as `GET /missions/:id`. A charge with no
`unit_id` contributes to the mission total only. The budget comes from a
non-negative safe integer `budget_cents` in the `mission.created` payload. When the
log has no budget, `budget_cents` and `remaining_cents` are `null`.
`remaining_cents` can be negative when spend exceeds the budget. Spend and
remaining budget are rounded to four decimal places in cents.

## `GET /missions/:id/report`

Returns the final recorded mission report after `mission.finished`, including
after a stop, budget pause, or interruption. An unfinished mission returns
`409 Conflict` with `{"error":"Mission has not finished"}`.

```json
{
  "mission_id": "demo",
  "shipped": ["seed-data"],
  "held": ["review"],
  "failed": [],
  "blocked": ["publish"],
  "attempts": 2,
  "model_calls": 2,
  "cost_cents": 1.25,
  "cost_per_green_unit_cents": 0.625,
  "touches": 1,
  "touch_rate": 1,
  "auto_answer_rate": 0.5,
  "repeat_returns": 1,
  "sent_back": [{ "unit_id": "seed-data", "reason": "tests failed" }],
  "elapsed_ms": 12000
}
```

Attempts count `attempt.ended` events. Model calls and cost use the recorded
ledger charges. Cost per green unit divides cost by distinct passed units,
including held units and excluding passes that were sent back after a failed
merge. It is `null` if none passed. Touches use the finish event count or the
number of held units for legacy reports that lack decision and revision events.
Otherwise, touches count human decision resolutions and edits after the initial
Briefing and plan. A human answer and its generated Briefing version count as
one touch. Touch rate divides touches by shipped units and is `null` when none
shipped. Auto-answer rate divides questions answered by the Briefing or the
cache by all questions, including those still waiting. It is `null` when nobody
asked a question. These metrics use events through the selected finish event.
Elapsed time runs from approval to finish, using creation as the start when
approval is absent. Unusable timestamps yield `null`.

`sent_back` lists unit IDs and reasons in event order, including separate
returns of the same unit. A missing reason is `null`. `repeat_returns` counts
returns for which the reason already matched a line in `.bulletin/rules.md`,
either as the rule text or in the generated `Cut units so this cannot recur:`
format. The engine records the match on `unit.sent_back` before the current
lesson can add a rule. Older events without that flag appear in the list.
Only confirmed matches count toward the total.

## `GET /missions/:id/events?after=<event id>`

Returns `200 OK` with `Content-Type: text/event-stream; charset=utf-8`.
The stream replays the mission's events in ascending ID order and follows a
running mission until it finishes or the connection closes. A finished mission
replays its available history and closes the stream. When a finished mission has
no events after the cursor, the route returns `204 No Content`. This ends browser
reconnection once the client has received the final event. Event IDs are global to the log,
so gaps are expected within a single mission.

The cursor is exclusive. Omit `after` to replay from the beginning. On browser
reconnect, a nonempty `Last-Event-ID` header takes precedence over the query
parameter. The selected cursor must be a non-negative safe integer written in
decimal digits. Invalid cursors return `400 Bad Request` with
`{"error":"Invalid event cursor"}`.

Each frame has an `id` line, an `event` line naming the event type, and a `data`
line with the full `BulletinEvent` JSON from `@bulletin/core`. A blank line ends
the frame. The stream also sends SSE comments on connect and every 15 seconds
while the client can accept data.

```text
id: 7
event: unit.started
data: {"id":7,"mission_id":"demo","ts":"2026-11-17T14:00:01.000Z","type":"unit.started","unit_id":"seed-data","payload":{"lane":"open"}}

```

With `EventSource`, register listeners by event type, for example
`source.addEventListener("unit.started", handler)`, and parse `event.data` as
JSON. The `unit_id` field is `null` for mission-level events. The payload is
whatever the event producer wrote. The `EVENT_TYPES` export in `@bulletin/core`
lists the available event names.

## `POST /missions/:id/approve`

Approves the current proposal and starts the configured mission runner in the
background. Omit the body or send `{}`. Returns `202 Accepted` with
`{"mission_id":"demo","status":"running"}`. Follow the mission stream for
execution progress. The API publishes `plan.approved` once and the runner
publishes execution events to the same log.

The engine emits `budget.paused` when recorded execution spend reaches the
saved budget. It stops starting work and publishes `mission.finished` with
`payload.paused: true`. Mission list and detail then report `paused`.

- `409 Conflict` with `{"error":"Mission has no plan to approve"}` if the mission has no full proposal or lacks repository metadata.
- `409 Conflict` with `{"error":"Mission already approved"}` if execution has already been approved or has finished.
- `409 Conflict` with `{"error":"Plan exceeds mission budget","budget_cents":500,"estimated_cents":1150,"spent_cents":10,"shortfall_cents":660}`
  when the baseline Treasury fare estimate plus recorded spend exceeds the
  mission budget. The mission stays in planning. An exact fit can run.
- `422 Unprocessable Entity` with `{"error":"Plan cannot be priced"}` if a budgeted plan has an unknown tier or a missing model price.
- `503 Service Unavailable` with `{"error":"Mission pricing not configured"}` if a budgeted mission has no configured pricing.
- `503 Service Unavailable` with `{"error":"Mission runner not configured"}` if the API has no runner. The mission stays in planning.

If the runner throws before finishing, `mission.finished` carries
`{"status":"failed","error":"Mission execution failed"}` in its payload.

## `POST /missions/:id/stop`

Omit the body or send `{}`. Requests cancellation of the running mission and
returns `202 Accepted` with `{"mission_id":"demo","status":"stopping"}`.
Repeated stop requests return the same result while the runner is active.
Follow the stream for the engine's `mission.finished` event with
`payload.stopped: true`. The mission detail stays `running` until that event.
A mission without an active run returns `409 Conflict` with
`{"error":"Mission is not running"}`.

## `GET /missions/:id/decisions`

Returns `200 OK` with `{"decisions":[...]}`. Each item is the full
`decision.opened` `BulletinEvent` without a matching resolution. The list is
ordered from oldest to newest. For unit holds, `unit_id` identifies the unit
and `payload.kind` and `payload.branch` describe the hold.

## `POST /missions/:id/decisions/:unit/resolve`

Send `{"choice":"approve"}` or `{"choice":"reject"}`. Returns `200 OK` with the
new `decision.resolved` event. Its payload records `opened_event_id`, `choice`,
and `kind` when present. The endpoint records the oldest open approval decision
for the unit. Send question answers through `POST /questions/:id/answer`.

In the runnable API and sidecar, approving held work merges the held branch
and runs any newly unblocked units before returning. Rejecting records the unit
as failed and keeps its dependents blocked. A merge conflict leaves the
decision open and returns `409 Conflict` with
`{"error":"Held branch conflicts with the integration branch"}`. An approval
decision also returns `409 Conflict` while the mission is still running or if
its saved plan is unavailable.

An unavailable decision returns `404 Not Found` with
`{"error":"Open decision not found"}`. A concurrent resolution of the same
decision returns `409 Conflict` with `{"error":"Decision resolution in progress"}`.

## `GET /missions/:id/rules`

Returns `200 OK` with `.bulletin/rules.md` and `.bulletin/lessons.md` as raw
Markdown from one snapshot of the mission's integration branch. A missing file
has a `null` value. If the integration branch is unavailable, the response is
`404 Not Found` with `{"error":"Mission integration branch not found"}`.

```json
{
  "mission_id": "demo",
  "branch": "bulletin/demo/integration",
  "rules": "# Rules\n- Run the fixture tests.\n",
  "lessons": null
}
```

## `GET /questions`

Returns `200 OK` with `{"questions":[...]}`, ordered from oldest to newest.
Use `?mission_id=demo` to filter to one mission. A filter with no matches
returns an empty array.

## `POST /questions`

Send `{"mission_id":"demo","unit_id":"seed-data","body":"Which seed should I use?"}`.
Omit `unit_id` or send `null` for a mission-level question. The mission must
already exist. Returns `201 Created` with the question.

```json
{
  "id": "4f92d548-5474-468c-9270-2b1c0448fcb7",
  "mission_id": "demo",
  "unit_id": "seed-data",
  "body": "Which seed should I use?",
  "status": "open",
  "created_at": "2026-11-17T14:00:00.000Z",
  "answer": null,
  "answered_at": null
}
```

The mission stream receives `dispatch.asked` with `question_id` and `body`.
A matching cached answer for the current Briefing version returns an answered
question with `source: "cache"` and `briefing_ref`. It also publishes
`dispatch.answered`. A question that needs a human answer publishes
`decision.opened` with `kind: "question"` and `question_id`.

## `POST /questions/:id/answer`

Send `{"answer":"Use seed 17."}`. Returns `200 OK` with the full question,
`status` set to `answered`, the answer text, and the `answered_at` timestamp.
The response includes `source: "human"`.
An unknown question returns `404 Not Found` with `{"error":"Question not found"}`.
A question with an answer returns `409 Conflict` with
`{"error":"Question already answered"}`.

The mission stream receives `dispatch.answered` with `question_id` and `answer`,
then `decision.resolved` with `kind: "question"` and `question_id`.

For a mission with a completed Briefing, the answer also appends one line to
the Decisions log and publishes a `briefing.versioned` event with the next
version and its Markdown. That version caches the answer for the same
normalized question. An SDK station waiting on the question receives the answer
through `bulletin_wait`.

## `POST /questions/:id/auto-answer`

Omit the body or send `{}`. The Answerer uses the mission's latest completed
Briefing. Returns `200 OK` with the full question. A cited answer has status
`answered`, `source: "briefing"`, and a `briefing_ref` naming the section. The
mission stream records `dispatch.answered` and `decision.resolved` with the
Briefing source.

When the Answerer returns `SILENT` or supplies no valid citation, the question
stays `open` with `auto_answer_tried: true`. The mission stream gets
`dispatch.escalated` with `question_id`, `outcome: "silent"`, and
`prompt_version`. Both outcomes are visible through `GET /questions`.

- `404 Not Found` with `{"error":"Question not found"}` for an unknown ID.
- `409 Conflict` with `{"error":"Mission has no completed Briefing"}`,
  `{"error":"Question already answered"}`, or `{"error":"Auto-answer already in progress"}`.
- `502 Bad Gateway` with `{"error":"Answerer failed"}` on a model failure or invalid output after a retry.
- `503 Service Unavailable` with `{"error":"Answerer not configured"}` when the role has no configured model.
