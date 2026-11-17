"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import type { BulletinEvent } from "@bulletin/core";
import { subscribeEvents, type ConnectionState } from "../../../lib/api";
import { copy, LANE_LABELS, STATUS_LABELS } from "../../../lib/copy";
import { formatCents, formatPercent } from "../../../lib/format";
import { summarizeTreasury, type TreasurySummary } from "../../../lib/treasury";
import type { PlannedUnit, TreasuryInfo } from "../../../lib/types";
import {
  applyEvent,
  describeEvent,
  groupWaves,
  initialState,
  unitTitles,
  type AttemptRecord,
  type UnitCard,
  type WarTableState,
} from "../../../lib/war-table";

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

function History({ history }: { history: AttemptRecord[] }) {
  const h = t.history;
  return (
    <details className="history">
      <summary>{h.summary(history.length)}</summary>
      <ol>
        {history.map((a) => (
          <li key={a.attempt}>
            <strong>{h.tryLabel(a.attempt)}</strong>: {h.results[a.result ?? "none"]}
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

function TaskCard({ unit }: { unit: UnitCard }) {
  const status = STATUS_LABELS[unit.status];
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
      {unit.history.length > 0 && <History history={unit.history} />}
    </article>
  );
}

export function WarTable({
  missionId,
  units,
  treasury,
}: {
  missionId: string;
  units: PlannedUnit[];
  treasury: TreasuryInfo | null;
}) {
  const [state, dispatch] = useReducer(applyEvent, units, initialState);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(
    () => subscribeEvents(missionId, { onEvent: (e: BulletinEvent) => dispatch(e), onState: setConnection }),
    [missionId],
  );

  return <WarTableView state={state} treasury={treasury} badge={state.finished ? t.finished : t.connection[connection]} />;
}

/** The task board, spending and activity for one project state; no data fetching. */
export function WarTableView({ state, treasury, badge }: { state: WarTableState; treasury: TreasuryInfo | null; badge: string }) {
  const waves = useMemo(() => groupWaves(state), [state]);
  const titles = useMemo(() => unitTitles(state), [state]);

  return (
    <div className="mission-layout">
      <section>
        <h2>
          {t.tasks} <span className="badge">{badge}</span>
        </h2>
        <div className="waves">
          {waves.map(([wave, cards]) => (
            <div className="wave" key={wave}>
              <h3>{wave === 0 ? t.unplanned : t.batch(wave)}</h3>
              <div className="cards">
                {cards.map((unit) => (
                  <TaskCard key={unit.id} unit={unit} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="side">
        <TreasuryPanel summary={summarizeTreasury(state, treasury)} />
        <h2>{t.activity}</h2>
        {state.feed.length === 0 ? (
          <p className="muted">{t.activityEmpty}</p>
        ) : (
          <div role="log" aria-label={t.activity}>
            <ol className="feed">
              {[...state.feed].reverse().map((item) => (
                <li key={item.id}>
                  <time dateTime={item.ts} suppressHydrationWarning>{new Date(item.ts).toLocaleTimeString("en-US")}</time>
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
