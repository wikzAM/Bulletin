import { useEffect, useMemo, useReducer, useState } from "react";
import { initialRestartNotice, reduceRestartNotice } from "../lib/sidecar-notice";
import type { BulletinEvent } from "@bulletin/core";
import { approveMission, listQuestions, stopMission, subscribeEvents, type ConnectionState } from "../lib/api";
import type { Question } from "../lib/types";
import { InboxDrawer } from "./InboxDrawer";
import { approveMessage, canApprove, type ApproveMessage } from "../lib/approve";
import { copy, LANE_LABELS } from "../lib/copy";
import { heldForYou } from "../lib/decisions";
import { attemptResultLabel, canStop, cardStatus, stopMessage } from "../lib/ending";
import { formatCents, formatPercent } from "../lib/format";
import { summarizeTreasury, type TreasurySummary } from "../lib/treasury";
import type { MissionStatus, PlannedUnit, TreasuryInfo } from "../lib/types";
import {
  applyEvent,
  describeEvent,
  groupWaves,
  initialState,
  unitTitles,
  type AttemptRecord,
  type Ending,
  type UnitCard,
  type WarTableState,
} from "../lib/war-table";
import { PlanFlow } from "./PlanFlow";
import { PlanReview } from "./PlanReview";
import { CourierLayer, ReceiptCard } from "./WarExtras";
import { nextRevisionCount } from "../lib/plan-review";

const t = copy.missionPage;
const tt = copy.treasury;

function TreasuryPanel({ summary }: { summary: TreasurySummary }) {
  const level = tt.levels[summary.level];
  const pct = summary.ratio === null ? 0 : Math.min(100, Math.round(summary.ratio * 100));
  return (
    <section className={`treasury level-${summary.level}`} aria-labelledby="treasury-title">
      <h2 id="treasury-title">{tt.title}</h2>
      <p className="treasury-total">
        {summary.budget_cents === null
          ? tt.spentNoBudget(formatCents(summary.spent_cents))
          : tt.spentOf(formatCents(summary.spent_cents), formatCents(summary.budget_cents))}
      </p>
      {summary.budget_cents !== null && summary.ratio !== null && (
        <div
          className="meter"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={formatPercent(summary.ratio)}
          aria-label={tt.title}
        >
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="status">
        <span aria-hidden="true">{level.icon}</span> {level.label}
        {summary.ratio !== null && ` · ${formatPercent(summary.ratio)}`}
        {summary.remaining_cents !== null && ` · ${tt.remaining(formatCents(summary.remaining_cents))}`}
      </p>
      {summary.paused && <p role="alert">{tt.paused}</p>}
      <h3>{tt.perTask}</h3>
      {summary.units.length === 0 ? (
        <p className="muted">{tt.none}</p>
      ) : (
        <ul className="spend-list">
          {summary.units.map((u) => (
            <li key={u.id}>
              <span>{u.title}</span>
              <span>{formatCents(u.spent_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function History({ history, ending }: { history: AttemptRecord[]; ending: Ending | null }) {
  const h = t.history;
  return (
    <details className="history">
      <summary>{h.summary(history.length)}</summary>
      <ol>
        {history.map((a) => (
          <li key={a.attempt}>
            <strong>{h.tryLabel(a.attempt)}</strong>: {attemptResultLabel(a, ending)}
            {a.reason && a.result !== "green" && ` (${a.reason})`}
            {a.spent_cents > 0 && ` · ${formatCents(a.spent_cents)}`}
            {a.sent_back && <div className="muted">{h.sentBack}</div>}
            {a.evidence && (
              <>
                <div className="muted">{h.evidence}</div>
                <pre>{a.evidence}</pre>
              </>
            )}
            {a.packet && (
              <>
                <div className="muted">{h.packet}</div>
                <pre>{a.packet}</pre>
              </>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function TaskCard({ unit, ending }: { unit: UnitCard; ending: Ending | null }) {
  const status = cardStatus(unit, ending);
  return (
    <article className={`card status-${unit.status}${unit.started ? "" : " dim"}`} aria-label={unit.title}>
      <h4>{unit.title}</h4>
      <div className="status">
        <span aria-hidden="true">{status.icon}</span> {status.label}
      </div>
      <dl>
        <dt>{t.stage}</dt>
        <dd>{LANE_LABELS[unit.lane]}</dd>
        <dt>{t.attempts}</dt>
        <dd>{unit.attempts}</dd>
        <dt>{t.spent}</dt>
        <dd>{formatCents(unit.spent_cents)}</dd>
        {unit.last_reason && (
          <>
            <dt>{t.lastReason}</dt>
            <dd>{unit.last_reason}</dd>
          </>
        )}
      </dl>
      {unit.history.length > 0 && <History history={unit.history} ending={ending} />}
    </article>
  );
}

export function WarTable({
  missionId,
  status,
  units,
  treasury,
}: {
  missionId: string;
  status: MissionStatus;
  units: PlannedUnit[];
  treasury: TreasuryInfo | null;
}) {
  const [state, dispatch] = useReducer(applyEvent, units, initialState);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [restart, noteRestart] = useReducer(reduceRestartNotice, initialRestartNotice);
  const heldCount = heldForYou(state, {}).length;
  const [drawerOpen, setDrawerOpen] = useState(heldCount > 0);
  const [revisionsUsed, setRevisionsUsed] = useState(0);
  const [revising, setRevising] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(
    () => subscribeEvents(missionId, { onEvent: (e: BulletinEvent) => dispatch(e), onState: setConnection }),
    [missionId],
  );

  useEffect(() => {
    noteRestart({ type: "connection", state: connection });
  }, [connection]);

  useEffect(() => {
    const internals = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    if (internals === undefined) return;
    let stop: (() => void) | undefined;
    let cancel = false;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const unlisten = await listen<{ status?: string }>("bulletin://sidecar", (ev) => {
        const status = ev.payload && typeof ev.payload.status === "string" ? ev.payload.status : "";
        noteRestart({ type: "sidecar", source: "bulletin://sidecar", status });
      });
      if (cancel) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancel = true;
      stop?.();
    };
  }, [missionId]);

  useEffect(() => {
    void listQuestions()
      .then((all) => setQuestions(all.filter((q) => q.mission_id === missionId)))
      .catch(() => setQuestions([]));
  }, [missionId]);

  useEffect(() => {
    if (heldCount > 0 || questions.some((q) => q.status === "open")) setDrawerOpen(true);
  }, [heldCount, questions]);

  const onRevise = async (comment: string) => {
    setRevising(true);
    try {
      // Revision request is recorded locally until a revise route exists; count enforces the one-revision rule.
      void comment;
      setRevisionsUsed((n) => nextRevisionCount(n));
    } finally {
      setRevising(false);
    }
  };

  return (
    <div className="war-shell">
      {restart.notice ? (
        <p className="notice" role="status">
          {restart.notice}
        </p>
      ) : null}
      {canApprove(status, state) && (
        <PlanReview
          units={units}
          estimateCents={treasury?.budget_cents ?? 500}
          revisionsUsed={revisionsUsed}
          onRevise={onRevise}
          revising={revising}
        />
      )}
      <div className="war-top">
        <div className="war-actions">
          {canApprove(status, state) && <ApprovePanel missionId={missionId} />}
          {canStop(status, state) && <StopPanel missionId={missionId} />}
        </div>
        <div className="war-treasury">
          <TreasuryPanel summary={summarizeTreasury(state, treasury)} />
        </div>
      </div>
      <div className="war-main">
        <WarTableView
          units={units}
          state={state}
          treasury={null}
          badge={state.ending ? t.endings[state.ending] : t.connection[connection]}
          hideTreasury
        />
        <InboxDrawer
          missionId={missionId}
          state={state}
          questions={questions}
          open={drawerOpen}
          onToggle={() => setDrawerOpen((o) => !o)}
        />
      </div>
      <CourierLayer state={state} />
      <ReceiptCard state={state} />
    </div>
  );
}

function ApprovePanel({ missionId }: { missionId: string }) {
  const ta = copy.approve;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ApproveMessage | null>(null);
  const [done, setDone] = useState(false);

  const approve = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await approveMission(missionId);
      setMessage(approveMessage(result));
      setDone(result.ok || result.reason === "already");
    } catch {
      setMessage({ tone: "error", text: ta.failed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="approve" aria-labelledby="approve-title" aria-busy={busy}>
      <h2 id="approve-title">{ta.title}</h2>
      <p className="muted">{ta.intro}</p>
      {!done && (
        <button type="button" onClick={() => void approve()} disabled={busy}>
          {busy ? ta.approving : ta.button}
        </button>
      )}
      {message &&
        (message.tone === "ok" ? (
          <p className="notice" role="status">
            {message.text}
          </p>
        ) : (
          <p className="form-error" role="alert">
            {message.text}
          </p>
        ))}
    </section>
  );
}

function StopPanel({ missionId }: { missionId: string }) {
  const ts = copy.stop;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const stop = async () => {
    setBusy(true);
    try {
      const result = await stopMission(missionId);
      setMessage(stopMessage(result));
      if (result.ok || result.reason === "not_running") setAsking(false);
    } catch {
      setMessage({ tone: "error", text: ts.failed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stop" aria-busy={busy}>
      {!asking && message?.tone !== "ok" && (
        <button type="button" className="secondary" onClick={() => setAsking(true)}>
          {ts.button}
        </button>
      )}
      {asking && (
        <div role="group" aria-label={ts.button}>
          <p>{ts.confirm}</p>
          <div className="actions">
            <button type="button" onClick={() => void stop()} disabled={busy}>
              {busy ? ts.stopping : ts.yes}
            </button>
            <button type="button" className="secondary" onClick={() => setAsking(false)} disabled={busy}>
              {ts.no}
            </button>
          </div>
        </div>
      )}
      {message &&
        (message.tone === "ok" ? (
          <p className="notice" role="status">
            {message.text}
          </p>
        ) : (
          <p className="form-error" role="alert">
            {message.text}
          </p>
        ))}
    </div>
  );
}
export function WarTableView({
  units,
  state,
  treasury,
  badge,
  hideTreasury = false,
}: {
  units: PlannedUnit[];
  state: WarTableState;
  treasury: TreasuryInfo | null;
  badge: string;
  hideTreasury?: boolean;
}) {
  const waves = useMemo(() => groupWaves(state), [state]);
  const titles = useMemo(() => unitTitles(state), [state]);

  return (
    <div className="mission-layout war-board">
      <section className="war-board-main">
        <h2>
          {t.tasks} <span className="badge">{badge}</span>
        </h2>
        <div className="war-flow-wrap">
          <PlanFlow units={units} cards={state.units} />
        </div>
        {waves.length === 0 && <p className="muted">{t.tasksEmpty}</p>}
        <div className="waves">
          {waves.map(([wave, cards]) => (
            <div className="wave" key={wave}>
              <h3>{wave === 0 ? t.unplanned : t.batch(wave)}</h3>
              <div className="cards">
                {cards.map((unit) => (
                  <TaskCard key={unit.id} unit={unit} ending={state.ending} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      {!hideTreasury && (
        <section className="side">
          <TreasuryPanel summary={summarizeTreasury(state, treasury)} />
        </section>
      )}
      <section className="war-feed" aria-labelledby="activity-title">
        <h2 id="activity-title">{t.activity}</h2>
        {state.feed.length === 0 ? (
          <p className="muted">{t.activityEmpty}</p>
        ) : (
          <div role="log" aria-label={t.activity}>
            <ol className="feed">
              {[...state.feed].reverse().map((item) => (
                <li key={item.id}>
                  <time dateTime={item.ts} suppressHydrationWarning>
                    {new Date(item.ts).toLocaleTimeString("en-US")}
                  </time>{" "}
                  {describeEvent(item, titles)}
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}
