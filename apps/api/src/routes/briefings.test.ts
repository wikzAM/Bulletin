import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryEventLog } from "@bulletin/core";
import { expect, it, vi } from "vitest";
import { buildServer } from "../server";
import { JsonlBriefingStore } from "../store/briefing-store";

const markdown = [
  "# Briefing: Demo seed", "## Goal", "Seed demo data.", "## Users", "Local developers.",
  "## Features", "1. Seed data - Acceptance: the demo loads fixture records.",
  "## Constraints", "Local execution.", "## Out of scope", "Cloud hosting.", "## Decisions log",
].join("\n");

it("asks one question at a time, persists the interview, and accepts a skip", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-briefings-"));
  const path = join(directory, "briefings.jsonl");
  let store = await JsonlBriefingStore.open(path);
  const interviewerCall = vi.fn<(system: string, user: string) => Promise<string>>()
    .mockResolvedValueOnce("invalid response")
    .mockResolvedValueOnce('{"question":"Who uses the demo?"}')
    .mockResolvedValueOnce('{"question":"Does it run locally?"}')
    .mockResolvedValueOnce(JSON.stringify({ markdown }));
  let app = buildServer(undefined, { briefingStore: store, interviewerCall });
  try {
    const created = await app.inject({ method: "POST", url: "/briefings", payload: { goal: " Seed demo data. " } });
    expect(created.statusCode).toBe(201);
    const initial = created.json();
    expect(initial).toEqual({
      id: expect.any(String), goal: "Seed demo data.", status: "interview", question: "Who uses the demo?",
      question_number: 1, version: null, markdown: null,
    });
    expect(interviewerCall.mock.calls[0]?.[0]).toBe(interviewerCall.mock.calls[1]?.[0]);
    expect(interviewerCall.mock.calls[1]?.[1]).toContain("invalid");
    const url = `/briefings/${initial.id}`;
    const skipped = await app.inject({ method: "POST", url: `${url}/answers`, payload: { question_number: 1, answer: null } });
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json()).toMatchObject({ question: "Does it run locally?", question_number: 2 });
    await app.close();
    await store.close();

    store = await JsonlBriefingStore.open(path);
    app = buildServer(undefined, { briefingStore: store, interviewerCall });
    expect((await app.inject(url)).json()).toEqual(skipped.json());
    const complete = await app.inject({
      method: "POST", url: `${url}/answers`, payload: { question_number: 2, answer: "Yes, locally." },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toEqual({ ...initial, status: "complete", question: null, question_number: null, version: 1, markdown });
    expect((await app.inject(url)).json()).toEqual(complete.json());
    expect(interviewerCall.mock.calls[3]?.[1]).toContain('"answer":null');
    expect(interviewerCall.mock.calls[3]?.[1]).toContain("Yes, locally.");
    const stale = await app.inject({ method: "POST", url: `${url}/answers`, payload: { question_number: 2, answer: "Again" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: "Briefing is not awaiting this answer" });
    expect(interviewerCall).toHaveBeenCalledTimes(4);
  } finally {
    await app.close();
    await store.close();
    await rm(path, { force: true });
    await rmdir(directory);
  }
});

it("finishes after at most ten questions and keeps stale submissions from consuming a turn", async () => {
  const interviewerCall = vi.fn<(system: string, user: string) => Promise<string>>()
    .mockResolvedValue('{"question":"Anything else?"}');
  const app = buildServer(undefined, { interviewerCall });
  try {
    const created = await app.inject({ method: "POST", url: "/briefings", payload: { goal: "Seed demo data." } });
    expect(created.statusCode).toBe(201);
    const url = `/briefings/${created.json().id}/answers`;
    const answer = (question_number: number) => app.inject({ method: "POST", url, payload: { question_number, answer: null } });
    for (let number = 1; number < 10; number++) {
      const res = await answer(number);
      expect(res.statusCode).toBe(200);
      expect(res.json().question_number).toBe(number + 1);
    }
    expect((await answer(9)).statusCode).toBe(409);
    interviewerCall.mockResolvedValueOnce('{"question":"An eleventh question?"}').mockResolvedValueOnce(JSON.stringify({ markdown }));
    const last = await answer(10);
    expect(last.statusCode).toBe(200);
    expect(last.json()).toMatchObject({ status: "complete", question: null, markdown });
    expect(interviewerCall).toHaveBeenCalledTimes(12);
  } finally {
    await app.close();
  }
});

it("uses a completed briefing as the General's context and publishes it on the mission", async () => {
  const events = new MemoryEventLog();
  const interviewerCall = vi.fn(async () => JSON.stringify({ markdown }));
  const modelCall = vi.fn<(system: string, user: string) => Promise<string>>(async () => JSON.stringify({
    briefing_version: 1, units: [{ id: "seed", title: "Seed", task: "Seed data", files: ["src/seed.ts"] }],
  }));
  const app = buildServer(events, { interviewerCall, modelCall });
  try {
    const created = await app.inject({ method: "POST", url: "/briefings", payload: { goal: "Seed demo data." } });
    expect(created.statusCode).toBe(201);
    const briefing_id = created.json().id;
    const repo = fileURLToPath(new URL("../../../../", import.meta.url));
    const planned = await app.inject({ method: "POST", url: "/missions", payload: { goal: "Seed demo data.", repo, briefing_id } });
    expect(planned.statusCode).toBe(201);
    expect(modelCall.mock.calls[0]?.[1]).toContain("## Constraints\nLocal execution.");
    expect(events.events.map(({ type }) => type)).toEqual(["mission.created", "briefing.versioned", "plan.proposed"]);
    expect(events.events[1]).toMatchObject({ mission_id: planned.json().mission_id, payload: { briefing_id, version: 1, markdown } });
  } finally {
    await app.close();
  }
});
