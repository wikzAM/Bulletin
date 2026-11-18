import { createHash } from "node:crypto";
import { normalizeQuestion, type AskResult } from "./index";
import type { Answerer } from "./server";

/*
 * The answer pipeline (spec section 10): cache, then the answerer, then a human.
 *
 *   1. Normalize the question and hash it with the current Briefing version.
 *   2. Cache hit: answer with no model call.
 *   3. Otherwise ask the answerer; if it is unsure, retry once on the next rung.
 *   4. A grounded answer (one that cites a real Briefing section) is cached and returned.
 *   5. SILENT, or an answer citing nothing real: open a decision and return `pending`. When a human
 *      answers, the answer is appended to the Briefing's decisions log as a new version, cached, and
 *      delivered to every station waiting on it.
 *
 * Everything outside this file (the Briefing's storage, the model, the decision inbox) is injected.
 */

export interface BriefingVersion {
  version: number;
  markdown: string;
}

export interface PipelineBriefing {
  current(): Promise<BriefingVersion>;
  /** Append one line to the decisions log and return the new version of the Briefing. */
  appendDecision(line: string): Promise<BriefingVersion>;
}

/** One rung of the answerer ladder. Returns an answer with the Briefing section it rests on, or SILENT. */
export type Rung = (input: {
  question: string;
  briefing: string;
  paths?: string[];
}) => Promise<{ answer: string; briefing_ref: string } | "SILENT" | undefined>;

export interface OpenedDecision {
  dispatch_id: string;
  unit_id: string;
  question: string;
}

export interface PipelineOptions {
  briefing: PipelineBriefing;
  /** Cheapest first. At most two are tried per question (spec: "retry once on the next rung"). */
  rungs: readonly Rung[];
  /** Called once per distinct unanswered question: the caller emits `decision.opened`. */
  onDecision: (decision: OpenedDecision) => void | Promise<void>;
  /** Seconds to milliseconds for `wait`. Default 1000 per second; tests shorten it. */
  timeoutMs?: (seconds: number) => number;
}

export interface PipelineStats {
  cacheHits: number;
  modelCalls: number;
  decisionsOpened: number;
}

type Answered = Extract<AskResult, { status: "answered" }>;

interface Group {
  key: string;
  question: string;
  /** Every dispatch waiting on this question. */
  ids: Set<string>;
  answer?: Answered;
}

const MAX_RUNGS = 2;
export const DECISIONS_HEADING = "Decisions log";

/** Insert one line at the end of the decisions log section (creating it if the Briefing has none). */
export function appendDecisionLine(markdown: string, line: string): string {
  // One log line only: answers come from people and models, and must not be able to start a section.
  const flat = line.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}[ \t]+Decisions log[ \t]*$/i.test(l.trimEnd()));
  if (start < 0) return `${markdown.replace(/\s*$/, "\n")}\n## ${DECISIONS_HEADING}\n${flat}\n`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}[ \t]+\S/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === "") insertAt--;
  lines.splice(insertAt, 0, flat);
  return lines.join("\n");
}

function headings(markdown: string): string[] {
  return [...markdown.matchAll(/^#{1,6}[ \t]+([^\r\n]+)$/gm)].map((m) => m[1]!.trim());
}

/** The heading a ref names (case-insensitive, `#` marks ignored), or undefined if the Briefing has none. */
function realSection(markdown: string, ref: string): string | undefined {
  const wanted = ref.replace(/^#{1,6}\s+/, "").trim().toLowerCase();
  return headings(markdown).find((h) => h.toLowerCase() === wanted);
}

export class BulletinPipeline implements Answerer {
  readonly stats: PipelineStats = { cacheHits: 0, modelCalls: 0, decisionsOpened: 0 };
  private readonly cache = new Map<string, { answer: string; briefing_ref: string }>();
  private readonly pending = new Map<string, Group>(); // by question key, while unanswered
  private readonly byDispatch = new Map<string, Group>();
  private readonly waiters = new Map<string, Array<(result: AskResult) => void>>();

  constructor(private readonly options: PipelineOptions) {}

  private static key(question: string, version: number): string {
    return createHash("sha256").update(`${normalizeQuestion(question)}\n${version}`).digest("hex");
  }

  async ask(input: { unit_id: string; question: string; dispatch_id: string; paths?: string[] }): Promise<AskResult> {
    const { briefing } = this.options;
    const current = await briefing.current();
    const key = BulletinPipeline.key(input.question, current.version);

    const cached = this.cache.get(key);
    if (cached) {
      this.stats.cacheHits += 1;
      return { status: "answered", answer: cached.answer, source: "cache", briefing_ref: cached.briefing_ref };
    }

    // The same question is already waiting on a human: join it rather than ask again.
    const waiting = this.pending.get(key);
    if (waiting) {
      waiting.ids.add(input.dispatch_id);
      this.byDispatch.set(input.dispatch_id, waiting);
      return { status: "pending", dispatch_id: input.dispatch_id };
    }

    for (const rung of this.options.rungs.slice(0, MAX_RUNGS)) {
      this.stats.modelCalls += 1;
      const result = await rung({
        question: input.question,
        briefing: current.markdown,
        ...(input.paths ? { paths: input.paths } : {}),
      });
      if (result === "SILENT" || result === undefined) continue;
      const section = realSection(current.markdown, result.briefing_ref);
      if (!section || result.answer.trim() === "") continue; // an answer that cites nothing real is SILENT
      this.cache.set(key, { answer: result.answer, briefing_ref: section });
      return { status: "answered", answer: result.answer, source: "briefing", briefing_ref: section };
    }

    const group: Group = { key, question: input.question, ids: new Set([input.dispatch_id]) };
    this.pending.set(key, group);
    this.byDispatch.set(input.dispatch_id, group);
    this.stats.decisionsOpened += 1;
    await this.options.onDecision({ dispatch_id: input.dispatch_id, unit_id: input.unit_id, question: input.question });
    return { status: "pending", dispatch_id: input.dispatch_id };
  }

  async wait(input: { dispatch_id: string; timeout_s: number }): Promise<AskResult> {
    const group = this.byDispatch.get(input.dispatch_id);
    if (!group) throw new Error(`unknown dispatch: ${input.dispatch_id}`);
    if (group.answer) return group.answer;
    const toMs = this.options.timeoutMs ?? ((s: number) => s * 1000);
    return new Promise<AskResult>((resolve) => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(input.dispatch_id) ?? [];
        this.waiters.set(input.dispatch_id, list.filter((w) => w !== done));
        resolve({ status: "pending", dispatch_id: input.dispatch_id });
      }, toMs(input.timeout_s));
      const done = (result: AskResult) => {
        clearTimeout(timer);
        resolve(result);
      };
      this.waiters.set(input.dispatch_id, [...(this.waiters.get(input.dispatch_id) ?? []), done]);
    });
  }

  /**
   * A human answered the decision for `dispatchId`. Appends it to the decisions log (a new Briefing
   * version), caches it under that version, and delivers it to every station waiting on the question.
   */
  async resolve(dispatchId: string, humanAnswer: string): Promise<BriefingVersion> {
    const group = this.byDispatch.get(dispatchId);
    if (!group) throw new Error(`unknown dispatch: ${dispatchId}`);
    if (group.answer) throw new Error(`dispatch already resolved: ${dispatchId}`);

    const next = await this.options.briefing.appendDecision(`- Q: ${group.question} A: ${humanAnswer}`);
    const answered: Answered = { status: "answered", answer: humanAnswer, source: "human", briefing_ref: DECISIONS_HEADING };
    group.answer = answered;
    this.pending.delete(group.key);
    this.cache.set(BulletinPipeline.key(group.question, next.version), { answer: humanAnswer, briefing_ref: DECISIONS_HEADING });
    for (const id of group.ids) {
      for (const deliver of this.waiters.get(id) ?? []) deliver(answered);
      this.waiters.delete(id);
    }
    return next;
  }
}
