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

## Release build (2026-11-18)

`pnpm run tauri:build` (release profile), after `pnpm run sidecar:prepare`:

| | |
| --- | --- |
| Time | 451 s on this machine (4 min 36 s of Rust with a cold release cache, plus the frontend build and both bundlers) |
| NSIS installer | `src-tauri/target/release/bundle/nsis/Bulletin_0.1.0_x64-setup.exe`, 24.48 MiB |
| MSI | `src-tauri/target/release/bundle/msi/Bulletin_0.1.0_x64_en-US.msi`, 36.22 MiB |
| App executable | `src-tauri/target/release/bulletin-desktop.exe`, 8.97 MB (the 97 MB sidecar is a separate file in the installer) |
| Errors | none. NSIS and WiX were already cached from the debug build, so no downloads. |

The installers are unsigned (see "Signing").

## Install test (2026-11-18): what was done, and what was not

**The real installer was not run.** The task says to stop and note if anything would touch the system outside the
scratch folder. Reading the generated installer script (`src-tauri/target/release/nsis/x64/installer.nsi`) shows a
per-user NSIS install (`INSTALLMODE currentUser`, `RequestExecutionLevel user`, so no admin rights) that still writes
outside the folder you choose:

- registry: `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bulletin` and `HKCU\Software\bulletin\Bulletin`;
- a Start Menu shortcut (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Bulletin`), and a desktop shortcut if the
  option is chosen;
- if WebView2 were missing it would download and run Microsoft's bootstrapper (it is present here).

It writes nothing under `...\CurrentVersion\Run`; the uninstaller deletes the `Run` value `Bulletin` if present. All of
this is removed by `uninstall.exe`, but it is a change to the machine, so the question is on `BULLETIN.md` and the
install and uninstall steps below are still to do. Baseline before any install, for comparison afterwards: no
`Bulletin` key under `HKCU\...\Uninstall` or `HKCU\Software`, no Bulletin Start Menu folder, no Bulletin desktop shortcut;
`HKCU\...\Run` holds 10 values, none for Bulletin.

**What was tested instead, entirely inside a scratch folder:** the installer places exactly these files in the install
folder (from the script): `bulletin-desktop.exe`, `bulletin-sidecar.exe`, `config\models.json`, `config\prices.json`
(and `uninstall.exe`). I copied the release `bulletin-desktop.exe`, the prepared sidecar renamed `bulletin-sidecar.exe`
and the two config files into a scratch folder with that layout, and ran the release exe from there with
`BULLETIN_SIDECAR_PATH` and `BULLETIN_RESOURCE_DIR` unset and `BULLETIN_DATA_DIR` pointing at a scratch folder. After 20
seconds there was one `bulletin-desktop` process and one `bulletin-sidecar` child, both running from the scratch
folder, and the data folder held `events.sqlite`. So the packaged path works: the release profile starts the bundled
sidecar next to the exe, and the sidecar finds `config\` through the resource directory. I stopped the app by its
process id; both processes were gone 6 seconds later. A window opened briefly. Nothing was written to the registry
or outside the scratch folder.

Still to do once the install is approved: `Bulletin_0.1.0_x64-setup.exe /S /D=<scratch dir>`, launch the installed exe
headlessly, run `<scratch dir>\uninstall.exe /S`, then check the folder is gone and the registry and Start Menu match the baseline above.

## Updates (skeleton, off by default)

Nothing here turns updates on. It prepares the configuration and the build switch.

- `src-tauri/tauri.updater.conf.json` holds the updater plugin configuration: a placeholder public key
  (`PLACEHOLDER-...`), a placeholder endpoint (`https://UPDATE-ENDPOINT-PLACEHOLDER.invalid/...`, using Tauri's
  `{{target}}`, `{{arch}}` and `{{current_version}}` variables) and `bundle.createUpdaterArtifacts`. Tauri does not read this file by
  itself; it is merged only when passed with `--config`.
- The plugin is an optional Cargo dependency behind the `updater` feature of `src-tauri`. A default build does not
  contain it, so a default build cannot update itself. `src-tauri/Cargo.lock` gained the plugin's dependencies, and
  `tauri-utils` moved from 2.10.3 to 2.10.4 with them.
- A test (`packages/packaging/src/updater-config.test.ts`) checks that the default config has no updater section, that the
  keys are placeholders, that the feature gate exists, and that no private key material is anywhere under `src-tauri`.

### Turning updates on (the person who owns the release does this)

1. **Generate the signing keypair yourself, on a machine you control:** `pnpm exec tauri signer generate -w <path outside
   the repository>\bulletin-updater.key`. It asks for a password. **The private key and password must never be committed,
   pasted into a chat, or stored in this repository or in this environment.** Keep them in a password manager and, for CI, in
   the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
2. Put the **public** key (the content of `bulletin-updater.key.pub`) in `tauri.updater.conf.json` as `pubkey`, replacing the placeholder.
3. Host the update manifest and the signed installers somewhere, and set `endpoints` to its URL. Tauri expects JSON with
   `version`, `platforms.<target>.url` and `signature` (or a static file with that shape).
4. Add the permission `updater:default` to `src-tauri/capabilities/default.json` (it is not added now, because a permission for a
   plugin that is not compiled in makes the default build fail), and call the plugin's `check()` from the frontend.
5. Build with both switches: `pnpm exec tauri build --features updater --config src-tauri/tauri.updater.conf.json`, with
   `TAURI_SIGNING_PRIVATE_KEY` set in the environment. The build then also produces `.sig` signature files next to the installers.
6. Releases made without step 5 contain no updater and keep working as before.

## Signing

Installers and `bulletin-sidecar.exe` are unsigned. Windows SmartScreen will warn. Code signing needs a certificate that does
not exist yet; it is a separate thing from the updater keypair above (which signs update payloads, not the Windows executables).
