import type { BulletinEvent } from "@bulletin/core";
import {
  toBriefingReply,
  toCreateMissionResponse,
  type BriefingReply,
  toMissionDetail,
  toMissionSummaries,
  toQuestion,
  toQuestions,
  toTreasuryInfo,
} from "./api-adapters";
import { EVENT_TYPE_LIST, parseEventData } from "./guards";
import { mockAnswerBriefing, mockCreateMission, mockEvents, mockStartBriefing, mockMissions, mockQuestions, mockSummaries, mockTreasury } from "./mock";
import type { CreateMissionResponse, MissionDetail, MissionSummary, Question, TreasuryInfo } from "./types";

/**
 * The only module that talks to the API (routes in docs/API.md). With NEXT_PUBLIC_API_URL unset,
 * it serves lib/mock.ts instead.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

export const usingMock = API_URL === "";

const MOCK_EVENT_INTERVAL_MS = 900;
const RECONNECT_DELAY_MS = 2_000;

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function listMissions(): Promise<MissionSummary[]> {
  if (usingMock) return mockSummaries();
  return toMissionSummaries(await getJson("/missions"));
}

export async function getMission(id: string): Promise<MissionDetail | null> {
  if (usingMock) return mockMissions.find((m) => m.id === id) ?? null;
  return toMissionDetail(await getJson(`/missions/${encodeURIComponent(id)}`));
}

export async function getTreasury(id: string): Promise<TreasuryInfo | null> {
  if (usingMock) return mockTreasury[id] ?? null;
  return toTreasuryInfo(await getJson(`/missions/${encodeURIComponent(id)}/treasury`));
}

export async function listQuestions(): Promise<Question[]> {
  if (usingMock) return mockQuestions.map((q) => ({ ...q }));
  return toQuestions(await getJson("/questions"));
}

/** Answer a question as a person. Mock mode answers in memory, in whichever runtime calls it. */
export async function answerQuestion(id: string, answer: string): Promise<Question> {
  if (usingMock) {
    const q = mockQuestions.find((m) => m.id === id);
    if (!q) throw new Error(`unknown question ${id}`);
    Object.assign(q, { status: "answered", answer, source: "human", answered_at: new Date().toISOString() });
    return { ...q };
  }
  const res = await postJson(`/questions/${encodeURIComponent(id)}/answer`, { answer });
  const question = res.status === 200 ? toQuestion(res.body) : null;
  if (!question) throw new Error(`POST /questions/${id}/answer failed: ${res.status}`);
  return question;
}

/** "unavailable" when the API has no Briefing routes yet; the page then starts from the goal alone. */
export type BriefingStep = BriefingReply | { kind: "unavailable" };

export async function startBriefing(goal: string, repo: string): Promise<BriefingStep> {
  if (usingMock) return mockStartBriefing(goal);
  const res = await postJson("/briefings", { goal, repo });
  if (res.status === 404 || res.status === 405) return { kind: "unavailable" };
  const reply = res.status < 300 ? toBriefingReply(res.body) : null;
  if (!reply) throw new Error(`POST /briefings failed: ${res.status}`);
  return reply;
}

export async function answerBriefing(briefingId: string, answers: { question_id: string; answer: string | null }[]): Promise<BriefingReply> {
  if (usingMock) return mockAnswerBriefing(briefingId, answers);
  const res = await postJson(`/briefings/${encodeURIComponent(briefingId)}/answers`, { answers });
  const reply = res.status < 300 ? toBriefingReply(res.body) : null;
  if (!reply) throw new Error(`POST /briefings/${briefingId}/answers failed: ${res.status}`);
  return reply;
}

/** Ask the General for a plan. Planning failures come back as { ok: false, errors }, not as a throw. */
export async function createMission(goal: string, repo: string): Promise<CreateMissionResponse> {
  if (usingMock) return mockCreateMission(goal, repo);
  const res = await postJson("/missions", { goal, repo });
  return toCreateMissionResponse(res.status, res.body);
}

export type ConnectionState = "connecting" | "live" | "reconnecting";

export interface EventSubscription {
  /** Called once per event, in log order. Events at or below the last seen id are never delivered twice. */
  onEvent: (event: BulletinEvent) => void;
  onState?: (state: ConnectionState) => void;
}

/**
 * Stream a mission's events from the start of the log, reconnecting with ?after=<last id> on errors.
 * Returns a function that closes the stream.
 */
export function subscribeEvents(missionId: string, sub: EventSubscription): () => void {
  let lastId = 0;
  const deliver = (event: BulletinEvent) => {
    if (event.id <= lastId) return;
    lastId = event.id;
    sub.onEvent(event);
  };

  if (usingMock) return replayMock(missionId, deliver, sub.onState);

  let closed = false;
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const onFrame = (msg: MessageEvent<string>) => {
    const event = parseEventData(msg.data);
    if (event) deliver(event);
  };

  const open = () => {
    sub.onState?.(lastId === 0 ? "connecting" : "reconnecting");
    const url = `${API_URL}/missions/${encodeURIComponent(missionId)}/events?after=${lastId}`;
    const es = new EventSource(url);
    source = es;
    es.onopen = () => sub.onState?.("live");
    // Frames are named by event type; unnamed frames are accepted too.
    es.onmessage = onFrame;
    for (const type of EVENT_TYPE_LIST) es.addEventListener(type, onFrame);
    es.onerror = () => {
      es.close();
      if (closed) return;
      sub.onState?.("reconnecting");
      retry = setTimeout(open, RECONNECT_DELAY_MS);
    };
  };
  open();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    source?.close();
  };
}

function replayMock(
  missionId: string,
  deliver: (event: BulletinEvent) => void,
  onState: EventSubscription["onState"],
): () => void {
  const events = mockEvents[missionId] ?? [];
  let i = 0;
  onState?.("live");
  const timer = setInterval(() => {
    const next = events[i++];
    if (next) deliver(next);
    else clearInterval(timer);
  }, MOCK_EVENT_INTERVAL_MS);
  return () => clearInterval(timer);
}
