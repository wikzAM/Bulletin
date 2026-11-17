# War table API

Mission reads project the event log. A mission becomes visible after its
`mission.created` event.

## Running the API

From the repository root, run this command.

```sh
pnpm --filter @bulletin/api exec tsx src/serve.ts
```

The API binds to `127.0.0.1` and reads `PORT`, with `4000` as the default.
`PORT=0` assigns a free port and prints the listening address. Set
`NEXT_PUBLIC_API_URL=http://localhost:4000` for the web client on port `3000`.
Planning, interviews, and automatic answers use Claude Code. Put `claude` on
`PATH` and configure Claude Code credentials. The server loads model and price
settings from `config/models.json` and `config/prices.json`.

Mission execution uses `BULLETIN_RUNNER=claude` by default. Set
`BULLETIN_RUNNER=managed` and `BULLETIN_SANDBOX_REPO` to run stations in Managed
Agents. The mission's local repository must be a clone of that sandbox
repository. See [Managed Agents setup](MANAGED-AGENTS.md).

The server stores mission events in `.bulletin-scratch/api/events.jsonl` and
restores them at startup. Set `BULLETIN_SCRATCH_DIR` to use a different data and
worktree directory. Relative values are resolved from the repository root.
Run one API process per log. Recovery discards an incomplete final line and
reports a corrupt complete record with its line number. A mission interrupted
by a process exit keeps its last recorded status.

## Server configuration

`buildServer(log, options)` accepts `modelCall`, `interviewerCall`, and
`answererCall` for model calls. Pass `{ prices, tiers }` as `pricing` for plan
approval. The `startMission` callback receives the validated plan, repository,
base branch, Briefing Markdown or goal as `briefing`, an abort `signal`, and
an event sink backed by `log`. For engine runs started in the same process, pass the same log to
the engine's `events` option.

`briefingStore` and `questionStore` override the state stores. `buildServer()`
uses in-memory defaults. `serve.ts` uses JSONL for mission events and Briefing
interviews. Question board entries reset with the in-memory store. Question
dispatches and decisions remain available in the mission stream after a restart.

## HTTP conventions

Send write bodies as `application/json`. Question and answer text is trimmed
and must contain a non-whitespace character.

The API allows browser requests from `http://localhost:3000`. Preflight
requests from that origin return `204 No Content` with `GET`, `HEAD`, `POST`,
and `OPTIONS` allowed and `Content-Type` and `Last-Event-ID` accepted. JSON read
routes also accept `HEAD` and return headers only.

## Errors

Error responses include an `error` string. Planning and budget errors can
include the additional fields shown on those endpoints.

- `400 Bad Request`. `Invalid request` for malformed JSON, parameters, or fields. `Invalid event cursor` for malformed SSE cursors.
- `404 Not Found`. `Route not found`, `Mission not found`, `Briefing not found`, or `Question not found`.
- `409 Conflict`. `Briefing is incomplete`, `Briefing is not awaiting this answer`, `Mission already approved`, `Mission has no plan to approve`, `Plan exceeds mission budget`, `Mission is not running`, `Question already answered`, `Auto-answer already in progress`, or `Mission has no completed Briefing`.
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
`failed` sets the mission status to `failed`.

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

## `GET /missions/:id/events?after=<event id>`

Returns `200 OK` with `Content-Type: text/event-stream; charset=utf-8`.
The stream replays the mission's events in ascending ID order, then follows new
events until the client disconnects or the server closes. Event IDs are global
to the log, so gaps are expected within a single mission.

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

The mission stream receives `dispatch.asked` with `question_id` and `body`,
then `decision.opened` with `kind: "question"` and `question_id`.

## `POST /questions/:id/answer`

Send `{"answer":"Use seed 17."}`. Returns `200 OK` with the full question,
`status` set to `answered`, the answer text, and the `answered_at` timestamp.
The response includes `source: "human"`.
An unknown question returns `404 Not Found` with `{"error":"Question not found"}`.
A question with an answer returns `409 Conflict` with
`{"error":"Question already answered"}`.

The mission stream receives `dispatch.answered` with `question_id` and `answer`,
then `decision.resolved` with `kind: "question"` and `question_id`.

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
