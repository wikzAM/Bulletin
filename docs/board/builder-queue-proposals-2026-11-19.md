# Queue proposals from the Claude builder (2026-11-19, night)

User asked: get Cursor and Codex working before they sleep; keep Claude usage for the morning. Cursor's window is click-only for me (computer-use tier), so I cannot type a prompt into it. Cursor's thread says it is "polling main on the Worker loop", so tasks put in docs/board/cursor.md ON MAIN should be picked up if that loop is alive. Please add these to the queues on main (coordinator owns main).

## For docs/board/cursor.md (apps/desktop, owner: Cursor)
1. ReportPage: replace the "Coming soon" stub with real numbers from GET /missions/:id/report via the transport (touch_rate, auto_answer_rate, cost_per_green_unit_cents, shipped/held/failed/blocked, touches, cost_cents, elapsed_ms; null = "not available yet" in plain words). Removes the curl step in docs/DOGFOOD.md. Test first.
2. SetupPage: when Amazon Bedrock is chosen show an AWS region field, saved with bridge.setSettings({aws_region}) (builder adds the `aws_region` setting in the sidecar).
3. "Choose folder": show the picked path and run bridge.inspectRepo on it with plain-language results (not a git repo / no commits / uncommitted changes). Builder adds the Rust `pick_folder` command.
4. Reconnecting notice: when the sidecar restarts mid-mission, show it and resume (builder adds the `bulletin://sidecar` "started" event and the transport resubscribe).
5. Click through every page at 900x600; fix or log rough edges.
Do NOT touch AboutPage.tsx, lib/diagnostics.ts, lib/transport.ts, lib/desktop-bridge.ts (builder is editing them on claude/general).
Also: Cursor/Codex should set up an Automation or timer to re-wake after the usage window resets (user request).

## For docs/board/codex.md (apps/api, owner: Codex)
A. GET /missions/:id/report: add `repeat_returns` and a `sent_back` list (task id + reason), counting a send-back as a repeat when its reason matches a rule that already existed (rules.md) at that time. Removes the hand-count in docs/DOGFOOD.md.
B. Make the slow-host failures go away without weakening tests: briefings.test.ts, mission-planning.test.ts, run-mission.test.ts "the report" group (hook timeout, EPERM on temp cleanup), platform.test.ts, server.test.ts (/health 5s). Use per-file vi.setConfig timeouts and retrying temp cleanup, as the builder did in its slow test files.
C. Item 11 (lint failure in application.test.ts) still blocks Codex's merge.

## Builder (me), next on claude/general
About page fix (app.info), Rust pick_folder, bulletin://sidecar event + transport resubscribe, aws_region setting, rebuild + real installer test (user said "get these done by tonight").
