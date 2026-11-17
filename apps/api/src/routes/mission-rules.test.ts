import { MemoryEventLog } from "@bulletin/core";
import { expect, it, vi } from "vitest";
import { buildServer } from "../server";

const repo = "/repos/demo";
const branch = "bulletin/demo/integration";
const commit = "ab".repeat(20);
const success = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const missing = { code: 128, stdout: "", stderr: "Git object not found" };

async function missionLog() {
  const log = new MemoryEventLog();
  await log.emit({ mission_id: "demo", type: "mission.created", payload: { repo, base: "main" } });
  return log;
}

it("reads both Markdown files from the same integration-branch commit", async () => {
  const rules = "# Rules\n- Use the existing test command.\n";
  const lessons = "# Lessons\n- Keep fixture data small.\n";
  const readGit = vi.fn().mockResolvedValueOnce(success(`${commit}\n`))
    .mockResolvedValueOnce(success(rules)).mockResolvedValueOnce(success(lessons));
  const app = buildServer(await missionLog(), { readGit });
  try {
    const res = await app.inject("/missions/demo/rules");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mission_id: "demo", branch, rules, lessons });
    expect(readGit.mock.calls).toEqual([
      [repo, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
      [repo, "show", `${commit}:.bulletin/rules.md`],
      [repo, "show", `${commit}:.bulletin/lessons.md`],
    ]);
  } finally {
    await app.close();
  }
});

it("returns null for a missing file on an existing integration branch", async () => {
  const readGit = vi.fn().mockResolvedValueOnce(success(commit))
    .mockResolvedValueOnce(success("# Rules\n")).mockResolvedValueOnce(missing);
  const app = buildServer(await missionLog(), { readGit });
  try {
    const res = await app.inject("/missions/demo/rules");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mission_id: "demo", branch, rules: "# Rules\n", lessons: null });
  } finally {
    await app.close();
  }
});

it("reports a missing mission or integration branch without reading the base branch", async () => {
  const readGit = vi.fn(async () => missing);
  const app = buildServer(await missionLog(), { readGit });
  try {
    const unknown = await app.inject("/missions/missing/rules");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "Mission not found" });
    expect(readGit).not.toHaveBeenCalled();

    const res = await app.inject("/missions/demo/rules");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Mission integration branch not found" });
    expect(readGit).toHaveBeenCalledExactlyOnceWith(repo, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`);
  } finally {
    await app.close();
  }
});
