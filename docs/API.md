# War table API

The mission endpoints are read-only. They project the engine events in the API
process's in-memory log. A mission is visible after its `mission.created` event.
To serve an in-process engine run, pass the same `MemoryEventLog` to
`buildServer(log)` and to the engine's `events` option.

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
on `mission.finished`.

## `POST /missions`

Send `{"goal":"Seed the demo with test data","repo":"D:/repos/todo-app"}`.
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
and `base`, then `plan.proposed` with the validated `plan` and the `units` count.
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

`ledger.charges` counts events with a numeric `payload.cost_cents` in
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
non-negative integer `budget_cents` in the `mission.created` payload. When the
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
the frame. The stream also sends SSE comments on connect and while open.

```text
id: 7
event: unit.started
data: {"id":7,"mission_id":"demo","ts":"2026-11-17T14:00:01.000Z","type":"unit.started","unit_id":"seed-data","payload":{"lane":"open"}}

```

With `EventSource`, register listeners by event type, for example
`source.addEventListener("unit.started", handler)`, and parse `event.data` as
JSON. The `unit_id` field is `null` for mission-level events. Payloads come
directly from the engine. The `EVENT_TYPES` export in `@bulletin/core` lists the
available event names.

Mission-specific endpoints return `404 Not Found` with
`{"error":"Mission not found"}` for an unknown mission ID.

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
An unknown question returns `404 Not Found` with `{"error":"Question not found"}`.
A question with an answer returns `409 Conflict` with
`{"error":"Question already answered"}`.

The mission stream receives `dispatch.answered` with `question_id` and `answer`,
then `decision.resolved` with `kind: "question"` and `question_id`.

Question and answer text is trimmed and must contain a non-whitespace character.
Invalid inputs return `400 Bad Request` with `{"error":"Invalid request"}`.
The default question store lives in memory for the lifetime of the API process.
