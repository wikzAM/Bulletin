# Sidecar protocol

The sidecar reads UTF-8 JSON-RPC 2.0 messages from stdin and writes messages
to stdout, one JSON object per line. Diagnostics go to stderr. Each line is
an individual request or notification. A request ID is echoed in the response.
Multiple requests can be in flight. Close stdin or call `shutdown` to stop the sidecar.

From the repository root, launch it with `pnpm exec tsx apps/sidecar/src/main.ts`.

## Desktop flow test

Run `pnpm exec vitest run apps/sidecar/src/desktop-flow.test.ts` to drive the
stdio bridge through a complete mission with a fake model and a `StubRunner`.
The test creates a temporary Git repository and uses local subprocesses.

On Windows, `pnpm exec tsx apps/sidecar/src/test-fixtures/build-desktop-flow.ts`
builds an executable with the same fixture using the sidecar packaging code.
Set `BULLETIN_SIDECAR_PATH` to the printed executable path and run the test
again to check the packaged fixture.

## Tauri desktop bridge

The desktop frontend can call `invoke("rpc", { method, params })` with the
methods below. A successful invocation resolves to the JSON-RPC result. A
protocol failure rejects with the sidecar's `code` and `message`. Use
`listen("bulletin://event", handler)` to receive the notification's `params`
object as the Tauri event payload. Register the listener before subscribing.

The Tauri process supervises the child. A child exit rejects outstanding calls
with code `-32000` and triggers a restart. Reissue reads as needed and reconnect
subscriptions with the last event ID received. Each time the supervisor starts a sidecar process (the first start, a crash restart, and `restart_sidecar`) it emits the Tauri event `bulletin://sidecar` with the payload `"started"`. A new process knows no subscriptions, and its subscription ids start again at 1, so on that event subscribe again from the last event ID received and do not unsubscribe the old id. The desktop transport does this. Confirm the outcome of an
interrupted write before retrying it. On Windows, Bulletin puts the sidecar in
a Job Object before it starts so it can stop the sidecar and its descendants
together.

Set `BULLETIN_SIDECAR_PATH` to use a specific sidecar executable. Development
uses `pnpm --filter @bulletin/sidecar exec tsx src/main.ts` when the workspace
manifest exists, or Node with the root `tsx` installation while it is pending.
The release executable defaults to `bulletin-sidecar.exe` next to Bulletin on
Windows. The packaging work supplies that executable. Tauri passes the bundled
config directory through `BULLETIN_RESOURCE_DIR` to the release sidecar.

### Secrets

The secret store lives on the Rust side. Windows Credential Manager (service
`app.bulletin.desktop`) and macOS Keychain back the Tauri commands `secret_set`
with `{ name, value }` and `secret_has` with `{ name }`. `secret_has` returns a
boolean. There is deliberately no command that reads a value back to the page. Only
these names are accepted, anything else is refused: `ANTHROPIC_API_KEY`,
`AWS_BEARER_TOKEN_BEDROCK` and `BULLETIN_GITHUB_TOKEN`. A value is trimmed of
surrounding whitespace (a pasted key often ends in a newline), must not be empty or
contain a null character, and is at most 1280 characters (the Windows credential
limit). Values are never logged; the only way out of Rust is the sidecar's
environment at launch, below.

The sidecar never reads the keychain. Whenever the Rust bridge launches the
sidecar it copies each stored secret into the child's environment, unless that
variable is already set in Bulletin's own environment, which wins. A successful
`secret_set` therefore **restarts the sidecar** so that the next mission sees
the new value; calls in flight fail with code `-32000`, and subscriptions end
(subscribe again from the last event ID). The sidecar's own `secret.set` method
(below) is not a store: it changes the running process only and is lost at exit.

The Tauri command `restart_sidecar` (no arguments) restarts the sidecar the same
way; the desktop calls it after the `provider` setting changes, because the sidecar
reads that setting only at start.

The flow for a pasted key is: the UI calls `secret_set` (stored, sidecar
restarts), waits for `health`, then asks `env.check` or `secret.has` to confirm
the name now reads as present.

## `health`

Returns the health object from `GET /health`.

```json
{"jsonrpc":"2.0","id":1,"method":"health"}
{"jsonrpc":"2.0","id":1,"result":{"status":"ok","service":"api"}}
```

## `shutdown`

Takes no parameters. Returns `{"status":"shutting_down"}` and starts shutdown.
Closing stdin has the same effect without a response. The sidecar aborts
running missions, waits for them to finish within the shutdown window, and
closes SQLite before exiting with code 0 within five seconds. If a runner
does not finish in time, the sidecar closes SQLite with its committed events.
When the desktop quits, the native supervisor closes the sidecar's stdin and
allows it this shutdown window.

```json
{"jsonrpc":"2.0","id":1,"method":"shutdown"}
{"jsonrpc":"2.0","id":1,"result":{"status":"shutting_down"}}
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
events in ascending ID order, then follows a running mission. A finished
mission replays its available history and releases the subscription. A cursor
beyond that history produces an empty replay. Each subscription has its own
cursor.
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

## `app.info`

Takes no parameters. Returns `{"data_folder":"<path>"}`, the folder where the sidecar keeps `events.sqlite`, `settings.json` and `scratch` (`BULLETIN_DATA_DIR`, else `%LOCALAPPDATA%Bulletin`). The About page shows it.

```json
{"jsonrpc":"2.0","id":1,"method":"app.info"}
```

## `env.check`

Takes no parameters. Reports what the first-run screen needs to know about this
machine. It never returns a secret value, an account name or an email address,
only the booleans and the version line below. The result always has exactly
these keys:

```json
{"jsonrpc":"2.0","id":4,"method":"env.check"}
{"jsonrpc":"2.0","id":4,"result":{
  "git":{"found":true,"version":"git version 2.51.0.windows.1"},
  "claude":{"found":true,"logged_in":true},
  "provider":{"id":"claude-code","ready":true,"env":{}}
}}
```

- `git.found` is true when `git` resolves on `PATH` (with `PATHEXT` on Windows).
  `git.version` is the first line of `git --version`, or `null` when not found.
- `claude.found` is true when `claude` resolves on `PATH`. `claude.logged_in` is
  true when `claude auth status` reports `loggedIn: true` (if its output is not
  JSON, when it exits 0). Only that one flag is read from the output. The check
  gives up after 15 seconds and reports `false`. It is `false` when not found.
- `provider.id` is the provider the sidecar was started with, in the names the
  desktop uses. When `BULLETIN_PROVIDER` is not set in the environment, the sidecar
  takes it at start from the `provider` setting (`anthropic-key` becomes
  `anthropic`, `bedrock` stays `bedrock`, and then `BULLETIN_RUNNER` defaults to `sdk`
  so the stations call the API directly too); an environment value always wins, and
  changing the setting takes effect when the sidecar next starts. `claude-code` is
  what you get when neither names a provider (stations and the
  General run through the Claude Code login), `anthropic-key` for
  `BULLETIN_PROVIDER=anthropic`, `bedrock` for `BULLETIN_PROVIDER=bedrock`. Any
  other value is not guessed at: `id` is `null`, `env` is empty and `ready` is `false`.
- `provider.env` maps each environment variable the provider reads to whether it
  is set and non-empty: `ANTHROPIC_API_KEY` for `anthropic-key`; `AWS_REGION`,
  `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ACCESS_KEY_ID` and `AWS_PROFILE` for
  `bedrock`; empty for `claude-code`.
- `provider.ready` is true when the provider's credentials look usable:
  for `claude-code`, `claude.found && claude.logged_in`; for the others, no
  credential name is missing (`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`;
  `AWS_REGION` plus one of the three AWS credentials). `env` lists only the names
  above, so `ready` can be true through `ANTHROPIC_AUTH_TOKEN` while
  `ANTHROPIC_API_KEY` shows `false`. It is a hint, not a verdict: a profile or federation
  setup the sidecar cannot see is not counted.

## `repo.inspect`

Send `path`, an absolute folder path. The folder is untrusted: the sidecar runs
`git` with literal arguments and `core.fsmonitor` switched off, reads
`package.json` as data, and never runs the project's own scripts. A folder that
does not exist or is not a repository is a normal result, not an error. The
result always has exactly these keys:

```json
{"jsonrpc":"2.0","id":5,"method":"repo.inspect","params":{"path":"D:\\bulletin-demo"}}
{"jsonrpc":"2.0","id":5,"result":{
  "path":"D:\\bulletin-demo","exists":true,"is_repo":true,"root":"D:/bulletin-demo",
  "branch":"main","dirty":false,"test_command":"npm test","file_count":12,"file_count_capped":false
}}
```

- `exists` is false when `path` is not a folder; every later field is then `false` or `null`.
- `is_repo` is true when `path` itself is the top folder of a git work tree. `root` is the top folder of the work tree that contains `path`: the same folder when `is_repo` is true, a parent folder when `path` is only a subfolder of a repository (so the screen can offer it), `null` otherwise.
- `branch`, `dirty` and `file_count` are `null` unless `is_repo` is true.
- `branch` is the checked-out branch, or `null` when the head is detached.
- `dirty` is true when `git status` shows any change, tracked or untracked.
- `test_command` comes from `scripts.test` in `package.json` at `path`: `pnpm test`, `yarn test` or `npm test`, chosen by the lock file next to it (`pnpm-lock.yaml`, `yarn.lock`, otherwise npm). It is `null` when there is no such script.
- `file_count` is the number of files git tracks, at most 100000; `file_count_capped` is true when the cap applied.
- A relative or empty `path` is rejected with `-32602`.

## `settings.get` and `settings.set`

Non-secret settings live in `settings.json` in the app data folder
(`BULLETIN_DATA_DIR`, else the per-OS folder). Only these keys exist; any other
key is rejected with `-32602` so that nothing secret can be saved here:

| Key | Value |
| --- | --- |
| `provider` | `claude-code`, `anthropic-key` or `bedrock` |
| `repo_path` | a string, at most 1024 characters |
| `setup_complete` | a boolean |

`settings.get` takes no parameters and returns `{"settings":{...}}` holding the
keys that are set. `settings.set` takes `values`, an object of keys to new
values; `null` removes a key. The file is replaced atomically and the result is
the full settings object after the change. Settings are app configuration, not
mission state, so changes do not appear in any mission's event log.

```json
{"jsonrpc":"2.0","id":6,"method":"settings.set","params":{"values":{"provider":"bedrock","repo_path":null}}}
{"jsonrpc":"2.0","id":6,"result":{"settings":{"provider":"bedrock"}}}
```

## `secret.has` and `secret.set`

These work on the sidecar process's own secret view (its environment). They are
for the names listed under Secrets above; any other name is rejected with
`-32602`. Neither method ever returns a value.

- `secret.has` takes `name` and returns `{"name":"ANTHROPIC_API_KEY","present":true}`;
  `present` is true when the variable is set and not blank (whitespace only counts as blank).
- `secret.set` takes `name` and `value` (trimmed; not empty, no null character, at most 8192 characters) and returns `{"name":"ANTHROPIC_API_KEY","stored":true}`.
  This changes the running sidecar only and is lost when it exits. Persistent
  storage is the Tauri `secret_set` command, which also restarts the sidecar.

## Protocol errors

- `-32700` for invalid JSON.
- `-32600` for an invalid request envelope.
- `-32601` for an unknown method.
- `-32602` for invalid parameters or an event-stream response requested through `request`.
- `-32603` for an internal failure.
