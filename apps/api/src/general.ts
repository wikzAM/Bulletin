import { spawn } from "node:child_process";
import { validatePlan, type Plan, type ValidationContext } from "@bulletin/core";
import { GENERAL_PROMPT, renderGeneralTask } from "@bulletin/prompts";

/** One model call: system prompt and user message in, raw text out. Injected so tests need no model. */
export type ModelCall = (system: string, user: string) => Promise<string>;

export interface GeneralInput {
  briefing: string;
  repoMap: string;
  rules: string;
  lessons: string;
  validation: ValidationContext;
}

export type GeneralResult = { ok: true; plan: Plan; attempts: number } | { ok: false; errors: string[]; attempts: number };

/** Pull a JSON object out of model text: plain, or inside a ``` fence, or surrounded by prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = [text.trim(), fenced?.[1]?.trim(), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {
      /* try the next shape */
    }
  }
  throw new Error("the General's reply contained no JSON object");
}

/** The model cannot read packages/core, so the output shape travels in the task message. */
export const PLAN_SCHEMA_HINT = [
  "OUTPUT: one JSON object, no prose:",
  '{"briefing_version": 1, "units": [{"id": "u1", "title": "...", "task": "...",',
  '  "files": ["glob or path this unit owns"], "acceptance": ["pnpm test"],',
  '  "needs": [{"unit": "u0", "reads": "what exactly it reads from u0"}], "lane": "open", "tier": "station"}]}',
  "Acceptance commands must be runnable shell commands. Use paths that exist in the repository map for files you edit.",
].join("\n");

/** Goal text in, validated plan out. One retry, with the validator's errors as feedback. */
export async function runGeneral(input: GeneralInput, call: ModelCall, maxAttempts = 2): Promise<GeneralResult> {
  let feedback: string | undefined;
  let errors: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const user = renderGeneralTask({ ...input, briefing: `${input.briefing}

${PLAN_SCHEMA_HINT}`, feedback });
    let raw: string;
    try {
      raw = await call(GENERAL_PROMPT.system, user);
    } catch (e) {
      return { ok: false, errors: [`model call failed: ${(e as Error).message}`], attempts: attempt };
    }
    try {
      const result = validatePlan(extractJson(raw), input.validation);
      if (result.ok) return { ok: true, plan: result.plan, attempts: attempt };
      errors = result.errors;
    } catch (e) {
      errors = [(e as Error).message];
    }
    feedback = errors.map((e) => `- ${e}`).join("\n");
  }
  return { ok: false, errors, attempts: maxAttempts };
}

/** The real model call: headless Claude Code, no tools, one answer. Credentials come from its environment. */
export function claudeModelCall(model: string, claudeBin = "claude", cwd?: string): ModelCall {
  return (system, user) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        claudeBin,
        ["-p", user, "--output-format", "json", "--model", model, "--system-prompt", system, "--tools", ""],
        { cwd, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.stderr.on("data", (d) => (err += String(d)));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0 && !out.trim()) return reject(new Error(`claude exited ${code}: ${err.trim().slice(0, 300)}`));
        try {
          const parsed = JSON.parse(out) as { result?: string; is_error?: boolean };
          if (parsed.is_error) return reject(new Error(String(parsed.result)));
          resolve(String(parsed.result ?? ""));
        } catch {
          resolve(out);
        }
      });
    });
}

/** Try the primary model; if the call itself fails (credits, outage), use the fallback. */
export function withFallback(primary: ModelCall, fallback: ModelCall, onFallback?: (why: string) => void): ModelCall {
  return async (system, user) => {
    try {
      return await primary(system, user);
    } catch (e) {
      onFallback?.((e as Error).message);
      return fallback(system, user);
    }
  };
}
