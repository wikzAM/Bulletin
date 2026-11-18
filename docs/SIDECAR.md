# Sidecar protocol

The sidecar reads UTF-8 JSON-RPC 2.0 messages from stdin and writes messages
to stdout, one JSON object per line. Diagnostics go to stderr. Each line is
an individual request or notification. A request ID is echoed in the response.
Multiple requests can be in flight. Close stdin to shut down the sidecar.

From the repository root, launch it with `pnpm exec tsx apps/sidecar/src/main.ts`.

## Tauri desktop bridge

The desktop frontend can call `invoke("rpc", { method, params })` with the
methods below. A successful invocation resolves to the JSON-RPC result. A
protocol failure rejects with the sidecar's `code` and `message`. Use
`listen("bulletin://event", handler)` to receive the notification's `params`
object as the Tauri event payload. Register the listener before subscribing.

The Tauri process supervises the child. A child exit rejects outstanding calls
with code `-32000` and triggers a restart. Reissue reads as needed and reconnect
subscriptions with the last event ID received. Confirm the outcome of an
interrupted write before retrying it. On Windows, Bulletin puts the sidecar in
a Job Object before it starts so it can stop the sidecar and its descendants
together.

Set `BULLETIN_SIDECAR_PATH` to use a specific sidecar executable. Development
uses `pnpm --filter @bulletin/sidecar exec tsx src/main.ts` when the workspace
manifest exists, or Node with the root `tsx` installation while it is pending.
The release executable defaults to `bulletin-sidecar.exe` next to Bulletin on
Windows. The packaging work supplies that executable. Tauri passes the bundled
config directory through `BULLETIN_RESOURCE_DIR` to the release sidecar.

Windows Credential Manager and macOS Keychain back the Tauri commands
`secret_set` with `{ name, value }`, `secret_get` with `{ name }`, and
`secret_has` with `{ name }`. `secret_get` returns a string or `null`, and
`secret_has` returns a boolean. Use `secret_has` for settings status. The Rust
bridge reads `ANTHROPIC_API_KEY` and `BULLETIN_GITHUB_TOKEN` from the keychain
when launching the sidecar if they are absent from the parent environment.
Settings changes take effect the next time the sidecar starts.

## `health`

Returns the health object from `GET /health`.

```json
{"jsonrpc":"2.0","id":1,"method":"health"}
{"jsonrpc":"2.0","id":1,"result":{"status":"ok","service":"api"}}
```

## `request`

Send `method`, a root-relative API `path` with an optional query string, and
an optional JSON `body`. The result contains the HTTP `status` and the parsed
`body`. Responses with an empty body return `null`. HTTP errors retain their
status and body here. API route names and response shapes are shared with the
headless service. See [API reference](API.md).

```json
{"jsonrpc":"2.0","id":2,"method":"request","params":{"method":"GET","path":"/missions"}}
{"jsonrpc":"2.0","id":2,"result":{"status":200,"body":{"missions":[]}}}
```

The sidecar relays the configured bearer token over its in-process connection
to Fastify. Use `subscribe` for the stream provided by `GET /missions/:id/events`
on the HTTP interface.

## `subscribe`

Send `mission_id` and optional `after`, a non-negative safe integer. The cursor
is exclusive and defaults to zero. The response supplies a `subscription_id`
before the sidecar sends any notifications for it. Delivery replays committed
events in ascending ID order, then follows new events for that mission.
An unknown mission returns error `-32004`.

```json
{"jsonrpc":"2.0","id":3,"method":"subscribe","params":{"mission_id":"demo","after":6}}
{"jsonrpc":"2.0","id":3,"result":{"subscription_id":1}}
{"jsonrpc":"2.0","method":"event","params":{"subscription_id":1,"event":{"id":7,"mission_id":"demo","ts":"2026-11-18T15:00:00.000Z","type":"unit.started","unit_id":"seed","payload":{"lane":"open"}}}}
```

`event` notifications carry the same event envelope as the HTTP event stream.
Subscription IDs belong to one sidecar process. After reconnecting, subscribe
again with the last event ID your client processed.

## `unsubscribe`

Send `subscription_id`. The result is `{"unsubscribed":true}` for an active
subscription and `{"unsubscribed":false}` otherwise. Notifications already
sent can still arrive before the response.

## Protocol errors

- `-32700` for invalid JSON.
- `-32600` for an invalid request envelope.
- `-32601` for an unknown method.
- `-32602` for invalid parameters or an event-stream response requested through `request`.
- `-32603` for an internal failure.
