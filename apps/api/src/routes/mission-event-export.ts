import { Readable } from "node:stream";
import type { BulletinEvent } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import { SECRET_NAMES } from "../platform/keychain";
import type { EventLog } from "../store/event-log";
import { validateIdParams } from "./request-validation";

const privateFields = new Set([
  "answer", "blob", "blobs", "body", "bytes", "comment", "data", "description", "error", "errors", "evidence", "file",
  "files", "goal", "log", "logs", "markdown", "message", "messages", "notes", "prompt", "raw", "reason", "response",
  "snippet", "source", "stack", "stacktrace", "summary", "text",
]);
const privateFieldPatterns = [
  /^(?:keys?|tokens?|env|environment(?:variables)?|databaseurl)$/,
  /(?:api|access|client|private|public|secret|signing|ssh)key/,
  /(?:access|api|auth|bearer|oauth|refresh|session|security)token|token(?:value|header)?$/,
  /authorization|cookie|credential|password|passwd|passphrase|secret/,
  /file(?:blob|body|bytes|content|data|text)|sourcecode|stdout|stderr|transcript/,
  /(?:contents?|diffs?|patch(?:es)?|outputs?|errordetails|errormessage)$/,
];

const credentialPatterns = [
  /\b(?:sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-)[a-z0-9_-]{8,}/i,
  /\b(?:(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35})\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:Basic|Bearer)[ \t]+[A-Za-z0-9+/_.=-]{8,}/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s@]+:[^/\s@]+@/i,
];

const credentialVariables = [
  ...SECRET_NAMES, "BULLETIN_API_TOKEN", "BULLETIN_TOKEN_SECRET", "ANTHROPIC_AUTH_TOKEN",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
];

function isPrivateField(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return privateFields.has(key) || privateFieldPatterns.some((pattern) => pattern.test(key));
}

function redactPayload(value: unknown, hasCredential: (value: string) => boolean): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item !== "string" || !hasCredential(item))
      .map((item: unknown) => redactPayload(item, hasCredential));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !isPrivateField(key) && !hasCredential(key) &&
      (typeof item !== "string" || !hasCredential(item)))
    .map(([key, item]) => [key, redactPayload(item, hasCredential)]));
}

function exportEvents(events: readonly BulletinEvent[], missionId: string): Readable {
  const lastId = events.at(-1)?.id ?? -1;
  const configured = credentialVariables.map((name) => process.env[name]?.trim())
    .filter((secret): secret is string => Boolean(secret));
  function hasCredential(value: string): boolean {
    return credentialPatterns.some((pattern) => pattern.test(value)) ||
      configured.some((secret) => secret.length >= 8 ? value.includes(secret) : value === secret);
  }
  function* lines() {
    for (const event of events) {
      if (event.id > lastId) break;
      if (event.mission_id !== missionId) continue;
      yield JSON.stringify({
        ...event,
        mission_id: hasCredential(event.mission_id) ? "[redacted]" : event.mission_id,
        unit_id: event.unit_id !== null && hasCredential(event.unit_id) ? "[redacted]" : event.unit_id,
        payload: redactPayload(event.payload, hasCredential),
      }) + "\n";
    }
  }
  return Readable.from(lines(), { objectMode: false });
}

export function registerMissionEventExport(app: FastifyInstance, log: EventLog): void {
  app.get<{ Params: { id: string } }>("/missions/:id/events.ndjson", { preValidation: validateIdParams }, async (request, reply) => {
    const { id } = request.params;
    const events = log.events;
    if (!events.some((event) => event.mission_id === id && event.type === "mission.created")) {
      return reply.code(404).send({ error: "Mission not found" });
    }
    return reply.type("application/x-ndjson; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="events.ndjson"')
      .header("Cache-Control", "no-store")
      .send(exportEvents(events, id));
  });
}
