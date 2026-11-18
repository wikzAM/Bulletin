# @bulletin/desktop

Tauri 2 UI shell (React + Vite + Tailwind). For now it runs in the browser; the Rust host comes later.

```bash
pnpm --filter @bulletin/desktop dev
```

Leave `VITE_API_URL` unset to use mock data from `src/lib/mock.ts`. Point it at the API to talk to a local server:

```bash
$env:VITE_API_URL = "http://localhost:4000"; pnpm --filter @bulletin/desktop dev
```

Pure logic and tests live under `src/lib` and `test` (ported from `apps/web`).
