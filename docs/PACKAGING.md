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
