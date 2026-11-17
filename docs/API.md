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
event's `unit_id`. The engine currently emits counts in `plan.proposed`, so a
unit becomes visible when its ID first appears in the log. `lane` and `wave`
are `null` until reported. Unit statuses use the `@bulletin/core` values. A
unit starts as `pending`, then follows unit, attempt, and pass events.

`ledger.charges` counts events with a numeric `payload.cost_cents` in
`ledger.charged`. `ledger.cost_cents` sums those costs, rounded to four decimal
places in cents. Both fields start at zero.

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

Both mission-specific endpoints return `404 Not Found` with
`{"error":"Mission not found"}` for an unknown mission ID.
