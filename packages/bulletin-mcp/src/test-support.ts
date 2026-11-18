import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryEventLog } from "@bulletin/core";
import type { AskResult } from "./index";
import { appendDecisionLine, BulletinPipeline, type PipelineBriefing, type Rung } from "./pipeline";
import { createBulletinServer, type BulletinStore, type Dispatch } from "./server";

/** Shared fixtures for the end-to-end tests: a fake mission (Briefing, event log, pipeline, dispatch board) and scripted stations. */

export const BRIEFING = [
  "# Briefing: todo app",
  "## Goal",
  "A todo app for students.",
  "## Constraints",
  "All data stays on the student's machine, in a local SQLite file.",
  "## Out of scope",
  "Cloud hosting.",
  "## Decisions log",
  "- 2026-01-01 picked sqlite",
  "",
].join("\n");

/** The mission as the tests see it: one Briefing, one event log, one pipeline, one dispatch board. */
export function mission() {
  const events = new MemoryEventLog();
  const mission_id = "m1";

  let version = 1;
  let markdown = BRIEFING;
  const briefing: PipelineBriefing = {
    async current() {
      return { version, markdown };
    },
    async appendDecision(line) {
      markdown = appendDecisionLine(markdown, line);
      version += 1;
      await events.emit({ mission_id, type: "briefing.versioned", payload: { version } });
      return { version, markdown };
    },
  };

  /** The model: knows one thing, says SILENT about the rest, and counts how often it was asked. */
  const modelCalls: string[] = [];
  const rung: Rung = async ({ question, briefing: text }) => {
    modelCalls.push(question);
    if (/where.*data/i.test(question) && text.includes("## Constraints")) {
      return { answer: "On the student's machine, in a local SQLite file.", briefing_ref: "Constraints" };
    }
    return "SILENT";
  };

  const pipeline = new BulletinPipeline({
    briefing,
    rungs: [rung],
    onDecision: async (d) => {
      await events.emit({ mission_id, type: "decision.opened", unit_id: d.unit_id, payload: { kind: "question", dispatch_id: d.dispatch_id, question: d.question } });
    },
    timeoutMs: (s) => s * 20,
  });

  const dispatches: Dispatch[] = [];
  const store: BulletinStore = {
    async postDispatch(input) {
      const d: Dispatch = { id: `d${dispatches.length + 1}`, created_at: new Date(1_700_000_000_000 + dispatches.length * 1000).toISOString(), ...input };
      dispatches.push(d);
      return d;
    },
    async readDispatches({ unit_id, since }) {
      return dispatches.filter((d) => (!unit_id || d.unit_id === unit_id) && (!since || d.created_at > since));
    },
    async getBriefing(section) {
      const { markdown: text } = await briefing.current();
      if (!section) return text;
      const parts = text.split(/\n(?=## )/);
      return parts.find((p) => p.toLowerCase().startsWith(`## ${section.toLowerCase()}`)) ?? null;
    },
  };

  /** The Commander answering a decision in the inbox. */
  async function humanAnswers(dispatch_id: string, answer: string) {
    const next = await pipeline.resolve(dispatch_id, answer);
    await events.emit({ mission_id, type: "decision.resolved", payload: { dispatch_id, answer, briefing_version: next.version } });
    return next;
  }

  return { events, pipeline, store, modelCalls, humanAnswers, briefing };
}

/** A station: its own MCP session (one server per attempt), driven by a script instead of a model. */
export async function station(m: ReturnType<typeof mission>, unit_id: string) {
  const server = createBulletinServer({ store: m.store, answerer: m.pipeline });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: unit_id, version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const json = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: res.content[0]!.text, isError: res.isError === true };
  };
  return {
    ask: async (question: string, extra: Record<string, unknown> = {}) =>
      JSON.parse((await json("bulletin_ask", { unit_id, question, ...extra })).text) as AskResult,
    askRaw: (question: string) => json("bulletin_ask", { unit_id, question }),
    wait: async (dispatch_id: string, timeout_s = 30) =>
      JSON.parse((await json("bulletin_wait", { dispatch_id, timeout_s })).text) as AskResult,
    post: (kind: "progress" | "blocker" | "note", text: string) => json("bulletin_post", { unit_id, kind, text }),
    read: async (args: Record<string, unknown> = {}) => (await json("bulletin_read", args)).text,
    briefing: async (section?: string) => (await json("briefing_get", section ? { section } : {})).text,
  };
}
