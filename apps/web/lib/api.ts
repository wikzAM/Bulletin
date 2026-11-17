import type { BulletinEvent } from "@bulletin/core";
import {
  toApproveResult,
  toBriefingReply,
  toCreateMissionResponse,
  type BriefingReply,
  toMissionDetail,
  toMissionSummaries,
  toQuestion,
  toQuestions,
  toResolveResult,
  toRulesInfo,
  toStopResult,
  toSettings,
  toSpendInfo,
  toTreasuryInfo,
} from "./api-adapters";
import { EVENT_TYPE_LIST, parseEventData } from "./guards";
import { mockAnswerBriefing, mockApproveMission, mockCreateMission, mockEvents, mockStartBriefing, mockMissions, mockQuestions, mockResolveDecision, mockRules, mockSettings, mockSpend, mockStopMission, mockSummaries, mockTreasury } from "./mock";
import type { ProjectSpend } from "./spend";
import type { ApproveResult, CreateMissionResponse, MissionDetail, MissionSummary, Question, ResolveResult, SettingsInfo, StopResult, TreasuryInfo } from "./types";

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

/** Every project with its total spend and budget, from GET /missions and each treasury route. */
export async function listProjectSpend(): Promise<ProjectSpend[]> {
  const missions = await listMissions();
  const spend = await Promise.all(
    missions.map(async (m) => (usingMock ? mockSpend(m.id) : toSpendInfo(await getJson(`/missions/${encodeURIComponent(m.id)}/treasury`)))),
  );
  return missions.map((m, i) => ({ id: m.id, goal: m.goal, status: m.status, spent_cents: spend[i]?.spent_cents ?? 0, budget_cents: spend[i]?.budget_cents ?? null }));
}

export type RulesResult = { kind: "ok"; rules: string; lessons: string } | { kind: "unavailable" } | { kind: "not_found" };

/** .bulletin/rules.md and lessons.md for a project. A server without the route reads as unavailable. */
export async function getRules(missionId: string): Promise<RulesResult> {
  if (usingMock) {
    const files = mockRules(missionId);
    return files ? { kind: "ok", ...files } : { kind: "not_found" };
  }
  const res = await fetch(`${API_URL}/missions/${encodeURIComponent(missionId)}/rules`, { cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 404 || res.status === 405) {
    const error = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : null;
    return error === "Mission not found" ? { kind: "not_found" } : { kind: "unavailable" };
  }
  if (!res.ok) throw new Error(`GET /missions/${missionId}/rules failed: ${res.status}`);
  const files = toRulesInfo(body);
  return files ? { kind: "ok", ...files } : { kind: "unavailable" };
}

/** Null when the server has no GET /config yet. */
export async function getSettings(): Promise<SettingsInfo | null> {
  if (usingMock) return toSettings(mockSettings());
  return toSettings(await getJson("/config"));
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

/** 404/405 (no such route) and 503 (no Interviewer model configured) both mean "start from the goal". */
export async function startBriefing(goal: string): Promise<BriefingStep> {
  if (usingMock) return mockStartBriefing(goal);
  const res = await postJson("/briefings", { goal });
  if (res.status === 404 || res.status === 405 || res.status === 503) return { kind: "unavailable" };
  const reply = res.status < 300 ? toBriefingReply(res.body) : null;
  if (!reply) throw new Error(`POST /briefings failed: ${res.status}`);
  return reply;
}

/** One answer per call, in order; `answer: null` skips the question. */
export async function answerBriefing(briefingId: string, questionId: string, answer: string | null): Promise<BriefingReply> {
  if (usingMock) return mockAnswerBriefing(briefingId, questionId, answer);
  const res = await postJson(`/briefings/${encodeURIComponent(briefingId)}/answers`, { question_number: Number(questionId), answer });
  const reply = res.status < 300 ? toBriefingReply(res.body) : null;
  if (!reply) throw new Error(`POST /briefings/${briefingId}/answers failed: ${res.status}`);
  return reply;
}

/** Ask the General for a plan. Planning failures come back as { ok: false, errors }, not as a throw. */
export async function createMission(goal: string, repo: string, briefingId: string | null = null): Promise<CreateMissionResponse> {
  if (usingMock) return mockCreateMission(goal, repo);
  const res = await postJson("/missions", briefingId ? { goal, repo, briefing_id: briefingId } : { goal, repo });
  return toCreateMissionResponse(res.status, res.body);
}

/** Ask the runner to stop. The stream's mission.finished with payload.stopped confirms it. */
export async function stopMission(missionId: string): Promise<StopResult> {
  if (usingMock) return mockStopMission(missionId);
  const { status, body } = await postJson(`/missions/${encodeURIComponent(missionId)}/stop`, {});
  return toStopResult(status, body);
}

/** Record a person's OK or rejection for a held task. The engine does not act on it yet (docs/API.md). */
export async function resolveDecision(missionId: string, unitId: string, choice: "approve" | "reject"): Promise<ResolveResult> {
  if (usingMock) return mockResolveDecision(missionId, unitId, choice);
  const { status, body } = await postJson(`/missions/${encodeURIComponent(missionId)}/decisions/${encodeURIComponent(unitId)}/resolve`, { choice });
  return toResolveResult(status, body);
}

/** Approve the proposed plan and start the work. Refusals (budget, already approved) come back as a reason, not a throw. */
export async function approveMission(missionId: string): Promise<ApproveResult> {
  if (usingMock) return mockApproveMission(missionId);
  const res = await postJson(`/missions/${encodeURIComponent(missionId)}/approve`, {});
  return toApproveResult(res.status, res.body);
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
