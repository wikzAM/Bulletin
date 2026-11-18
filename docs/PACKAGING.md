# Packaging the sidecar

Bulletin ships as a Tauri app. The Rust core starts one child process, the sidecar
(`apps/sidecar`, protocol in [SIDECAR.md](SIDECAR.md)), and talks to it over stdio. The installer must
not need Node, pnpm or a checkout on the user's machine, so the sidecar is built into a single
Windows executable.

## Build it

```powershell
pnpm install
node scripts/build-sidecar.mjs
```

The result is `src-tauri/binaries/bulletin-sidecar-x86_64-pc-windows-msvc.exe` (about 90 MB, almost all of
it Node itself). `--out-dir <dir>` and `--work-dir <dir>` change where the executable and the
intermediate files go. The script is Windows x64 only for now and refuses other platforms.

The tests in `packages/packaging` build the bundle and, on Windows, the executable, start it, and check
that it answers `health` and exits when stdin closes. They take a couple of minutes on a slow machine.

## Prepare it for a Tauri build

```powershell
pnpm run sidecar:prepare
```

`scripts/prepare-sidecar.mjs` builds the executable (above) into `src-tauri/binaries/` under the name
Tauri's external binary convention needs, `bulletin-sidecar-<target triple>.exe`. The triple is the `host:`
line of `rustc -vV`; `--target <triple>` or Tauri's `TAURI_ENV_TARGET_TRIPLE` overrides it. It refuses any
triple other than `x86_64-pc-windows-msvc` before building, and checks the file exists afterwards. Run it before
`tauri build` (the release workflow draft does).

### What `src-tauri/tauri.conf.json` must set

The Tauri owner makes these changes; they are not made from here.

```json
"bundle": {
  "externalBin": ["binaries/bulletin-sidecar"],
  "resources": {
    "../config/models.json": "config/models.json",
    "../config/prices.json": "config/prices.json"
  }
}
```

- `externalBin` makes Tauri look for `binaries/bulletin-sidecar-<triple>.exe` at build time and install it next to
  `Bulletin.exe` as `bulletin-sidecar.exe`, where the Rust core looks first.
- `resources` is already set. The sidecar reads its configuration from the folder Tauri passes as
  `BULLETIN_RESOURCE_DIR`; without `models.json` and `prices.json` there it will not start.
- `beforeBuildCommand` should run `pnpm run sidecar:prepare` as well as the frontend build, or the release workflow
  must run it first. `src-tauri/binaries/` is a build product and should be git-ignored.

## What the script does

1. **Bundle.** esbuild turns `apps/sidecar/src/main.ts` and everything it imports (workspace packages,
   Fastify, zod, the Anthropic SDK) into one CommonJS file. A single executable's main script cannot be an
   ES module, and nothing may be loaded from `node_modules` at run time. Only Node's own modules
   (`node:*`) stay external. Any esbuild warning fails the build, because a warning means something in
   the bundle will not behave as it was written.
2. **Blob.** `node --experimental-sea-config` turns the bundle into a blob (Node's single executable
   applications feature).
3. **Inject.** The script copies the running `node.exe` and injects the blob with `postject`, using
   Node's fixed sentinel. The blob only fits the Node that made it, so the executable is always a copy
   of the same Node that ran the build. CI pins Node 24 (see the drafts in `docs/ci-drafts`).

`import.meta.url` and `import.meta.dirname` do not exist in CommonJS. The bundle points them at the
executable's own folder. The packaged app always sets `BULLETIN_RESOURCE_DIR`, which wins over both
(`application.ts` reads it first), so they are only a safety net.

## Wiring into Tauri (owned by whoever owns `src-tauri`)

- `src-tauri/tauri.conf.json` needs `"bundle": { "externalBin": ["binaries/bulletin-sidecar"] }`. Tauri
  looks for `binaries/bulletin-sidecar-<target triple>.exe` at build time and installs it next to
  `Bulletin.exe` as `bulletin-sidecar.exe`, which is where the Rust core looks first (SIDECAR.md).
- The `config/models.json` and `config/prices.json` resources are already listed under
  `bundle.resources`; Tauri passes their folder to the sidecar as `BULLETIN_RESOURCE_DIR`.
- `src-tauri/binaries/` holds a build product. It should be git-ignored.
- The release workflow runs `node scripts/build-sidecar.mjs` before `tauri-action`. Drafts of both
  workflows live in `docs/ci-drafts/` until the `gh` token has the `workflow` scope.

## Known limits

- **No native add-ons.** A single executable cannot load `.node` files from inside itself. The sidecar
  uses `node:sqlite` (built into Node), not `better-sqlite3`. Keep it that way, or ship the add-on beside
  the executable and load it by path.
- **SQLite prints an experimental warning on stderr.** Harmless; the Rust core only reads stdout.
- **Unsigned.** `postject` prints "The signature seems corrupted!" because Node's own Authenticode
  signature no longer matches once the blob is injected. The executable still runs. Windows SmartScreen
  will warn about the installer until it is signed. When a certificate exists, sign the sidecar and the
  installer in the release workflow with the certificate held as repository secrets (never in a file in
  this repository).
- **Antivirus.** A node.exe copy with an injected blob can be flagged by overeager scanners. Signing is
  the fix; until then, keep the installer unsigned warning in the release notes.
- **Size.** About 90 MB per installer for the runtime. Shrinking it means a different runtime, not a
  different bundler.

## Build log: the first debug build (2026-11-18, Windows 11, Node 24, Rust 1.100)

Every result of getting `tauri build` to produce an installer, in the order it happened.

| Step | Command | Result |
| --- | --- | --- |
| 1 | `cargo check --locked` in `src-tauri` | Passed, 6 min 27 s cold (about 400 crates). No Rust errors, no changes needed. |
| 2 | `cargo test --locked` | First attempt failed: "Could not resolve host: static.crates.io" while downloading the dev-dependency `tempfile`, which `cargo check` does not need. A retry compiled it. A second retry under the shell's 280 s limit was killed (exit 143, only slow). Run to completion in the background it passed: 3 tests (two supervisor tests that reap a process tree, one sidecar restart test). |
| 3 | `pnpm run lint` | Failed after the Rust build: eslint read generated `src-tauri/target/debug/build/**/__global-api-script.js`. Fixed by `--ignore-pattern "src-tauri/target/**"` in the root `lint` script. |
| 4 | `pnpm run sidecar:prepare` | Passed. 97 MB `src-tauri/binaries/bulletin-sidecar-x86_64-pc-windows-msvc.exe`. Prints `warning: The signature seems corrupted!` (node.exe's own signature no longer matches; harmless). |
| 5 | `pnpm run tauri:build -- --debug` | Failed after the frontend build: `error: unexpected argument '--debug' found`. pnpm forwards the `--` as well, so the Tauri CLI passes `--debug` on to `cargo build`. **Use `pnpm run tauri:build --debug`** (no `--`), or `pnpm exec tauri build --debug`. |
| 6 | `pnpm run tauri:build --debug` | Passed, about 5 minutes including the 8 s frontend build and 2 min 5 s of Rust. Tauri downloaded NSIS 3.13, its `nsis_tauri_utils` plugin and WiX 3.14 from github.com on first use (hash-checked), so the first build needs internet. |

### Result

Unsigned installers (debug profile, so `debug_assertions` is on):

- `src-tauri/target/debug/bundle/nsis/Bulletin_0.1.0_x64-setup.exe` (25.0 MiB)
- `src-tauri/target/debug/bundle/msi/Bulletin_0.1.0_x64_en-US.msi` (37.4 MiB)

The release profile (`pnpm run tauri:build`) has not been run. I did not install either installer.

### Running the built app headlessly

I ran `src-tauri/target/debug/bulletin-desktop.exe` itself (not an installed copy) with `BULLETIN_SIDECAR_PATH` pointing at the prepared executable, `BULLETIN_RESOURCE_DIR` at the repository and `BULLETIN_DATA_DIR` at an empty scratch folder. After 25 seconds there was one `bulletin-desktop` process and, started 6 seconds after it, one `bulletin-sidecar` child. The data folder contained `events.sqlite` and `scratch`, written by the sidecar. I stopped the app by its process id; both processes were gone 6 seconds later (the Job Object took the sidecar with it). A window did open briefly.

What this does not show: a debug build with `debug_assertions` starts the sidecar from source (`node --import tsx apps/sidecar/src/main.ts`) unless `BULLETIN_SIDECAR_PATH` is set, because `apps/sidecar` has no `package.json`; the bundled `bulletin-sidecar.exe` next to the app is only used by the release profile. The packaged path (release build, installer, bundled sidecar finding `config/` through the resource directory) is untested.

### Signing

None of this is signed. Windows SmartScreen will warn when the installers are run. Signing needs a code-signing certificate, which does not exist yet; when it does, keep it in repository secrets, never in a file, and sign both `bulletin-sidecar.exe` and the installers in the release workflow (draft: `docs/ci-drafts/release.yml`).
