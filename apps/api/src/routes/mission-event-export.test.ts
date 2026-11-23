import { MemoryEventLog } from "@bulletin/core";
import { expect, it, vi } from "vitest";
import { buildServer } from "../server";

it("streams a redacted snapshot in event order while a mission is running", async () => {
  const log = new MemoryEventLog();
  const fakeKey = "sk-ant-fixture-never-export";
  const opaqueKey = "opaque-fixture-value";
  const rawContent = "PRIVATE_FILE_CONTENTS_IN_THE_EVENT";
  const created = await log.emit({
    mission_id: "demo",
    type: "mission.created",
    payload: { base: "main", apiKey: opaqueKey, env: { SETTINGS: rawContent }, goal: rawContent },
  });
  await log.emit({ mission_id: "other", type: "mission.created", payload: { base: "other-mission" } });
  const approved = await log.emit({ mission_id: "demo", type: "plan.approved", payload: { budget_cents: 250 } });
  const attempt = await log.emit({
    mission_id: "demo",
    unit_id: fakeKey,
    type: "attempt.started",
    payload: {
      attempt: 1,
      input_tokens: 250,
      GITHUB_TOKEN: opaqueKey,
      FileContents: rawContent,
      fileContentBase64: rawContent,
      command_output: rawContent,
      details: [
        { authorizationHeader: opaqueKey, stderr: rawContent, path: "src/check.ts" },
        `provider returned ${fakeKey}`,
        `echo ${opaqueKey}`,
        "http://user:private-password@example.test/",
        "safe",
      ],
      labels: { [fakeKey]: true, stage: "run" },
    },
  });
  vi.stubEnv("ANTHROPIC_API_KEY", opaqueKey);
  const app = buildServer(log);
  try {
    const response = await app.inject("/missions/demo/events.ndjson");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="events.ndjson"');
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.payload.endsWith("\n")).toBe(true);
    expect(response.payload.trimEnd().split("\n").map((line) => JSON.parse(line) as unknown)).toEqual([
      { ...created, payload: { base: "main" } },
      approved,
      {
        ...attempt,
        unit_id: "[redacted]",
        payload: { attempt: 1, input_tokens: 250, details: [{ path: "src/check.ts" }, "safe"], labels: { stage: "run" } },
      },
    ]);
    for (const secret of [fakeKey, opaqueKey, rawContent, "private-password", "other-mission"]) {
      expect(response.payload).not.toContain(secret);
    }
    expect(log.events[0]?.payload).toMatchObject({ apiKey: opaqueKey, goal: rawContent });
    expect(log.events[3]?.payload).toMatchObject({ FileContents: rawContent, labels: { [fakeKey]: true } });
  } finally {
    vi.unstubAllEnvs();
    await app.close();
  }
});

it("returns a missing mission response and can export archived history", async () => {
  const log = new MemoryEventLog();
  await log.emit({ mission_id: "orphan", type: "plan.approved" });
  const created = await log.emit({ mission_id: "archived", type: "mission.created" });
  const archived = await log.emit({ mission_id: "archived", type: "mission.archived" });
  const app = buildServer(log);
  try {
    const missing = await app.inject("/missions/orphan/events.ndjson");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Mission not found" });

    const response = await app.inject("/missions/archived/events.ndjson");
    expect(response.statusCode).toBe(200);
    expect(response.payload).toBe(`${JSON.stringify(created)}\n${JSON.stringify(archived)}\n`);
  } finally {
    await app.close();
  }
});
