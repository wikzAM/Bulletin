import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getMission } from "../lib/api";
import { copy } from "../lib/copy";
import { mockEvents } from "../lib/mock";
import { eventsThrough, frameAt, replaySchedule, REPLAY_DURATION_MS } from "../lib/replay";
import type { MissionDetail } from "../lib/types";
import { prefersReducedMotion } from "../lib/war-extras";
import { describeEvent, reduceEvents, unitTitles } from "../lib/war-table";
import { PlanFlow } from "../components/PlanFlow";
import { ReceiptCard } from "../components/WarExtras";
import { NotFoundPage } from "./NotFoundPage";
import { PageError, PageLoading, PageShell } from "./PageStates";

export function ReplayPage() {
  const { id: raw } = useParams<{ id: string }>();
  const missionId = raw ? decodeURIComponent(raw) : "";
  const [mission, setMission] = useState<MissionDetail | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [cursorMs, setCursorMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const reduce = prefersReducedMotion();

  useEffect(() => {
    if (!missionId) return;
    void getMission(missionId)
      .then(setMission)
      .catch(() => setFailed(true));
  }, [missionId]);

  const events = useMemo(() => mockEvents[missionId] ?? [], [missionId]);
  const schedule = useMemo(() => replaySchedule(events), [events]);
  const visible = useMemo(() => eventsThrough(schedule, cursorMs), [schedule, cursorMs]);
  const state = useMemo(() => reduceEvents(mission?.units ?? [], visible), [mission, visible]);
  const titles = useMemo(() => unitTitles(state), [state]);
  const current = frameAt(schedule, cursorMs);

  useEffect(() => {
    if (reduce || paused || !mission) return;
    const origin = performance.now() - cursorMs / speed;
    let raf = 0;
    const tick = (now: number) => {
      const next = Math.min(REPLAY_DURATION_MS, (now - origin) * speed);
      setCursorMs(next);
      if (next < REPLAY_DURATION_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Restart the clock when pause/speed/mission change; cursor is captured at start.
  }, [paused, speed, reduce, mission]);

  if (!missionId) return <NotFoundPage />;
  if (failed) return <PageError onRetry={() => setFailed(false)} />;
  if (mission === undefined) return <PageLoading />;
  if (mission === null) return <NotFoundPage />;

  const t = copy.replay;

  return (
    <PageShell>
      <p>
        <Link to={`/missions/${encodeURIComponent(missionId)}`}>{copy.missionPage.back}</Link>
      </p>
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>
      {reduce ? (
        <ol className="replay-timeline">
          {schedule.frames.map((f) => (
            <li key={f.event.id}>
              <time>{Math.round(f.atMs / 1000)}s</time> {describeEvent(f.event, titles)}
            </li>
          ))}
        </ol>
      ) : (
        <>
          <div className="replay-controls" role="group" aria-label={t.controls}>
            <button type="button" onClick={() => setPaused((p) => !p)}>
              {paused ? t.play : t.pause}
            </button>
            <button type="button" onClick={() => setCursorMs(REPLAY_DURATION_MS)}>
              {t.skip}
            </button>
            <label>
              {t.speed}{" "}
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </label>
            <input
              type="range"
              min={0}
              max={REPLAY_DURATION_MS}
              value={cursorMs}
              onChange={(e) => setCursorMs(Number(e.target.value))}
              aria-label={t.scrub}
            />
          </div>
          <p className="muted">
            {current ? describeEvent(current.event, titles) : t.waiting} · {Math.round(cursorMs / 1000)}s
          </p>
          <PlanFlow units={mission.units} cards={state.units} />
          <ReceiptCard state={state} />
        </>
      )}
    </PageShell>
  );
}
