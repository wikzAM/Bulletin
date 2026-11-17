"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import type { Unit } from "@bulletin/core";
import { answerBriefing, createMission, startBriefing, usingMock } from "../../lib/api";
import type { BriefingReply } from "../../lib/api-adapters";
import { copy, LANE_LABELS } from "../../lib/copy";
import {
  answersPayload,
  currentQuestion,
  flowReducer,
  initialFlow,
  progress,
  validateBriefing,
  type FlowAction,
  type FlowState,
  type FlowStep,
} from "../../lib/interview";
import { GOAL_MAX_LENGTH, planBatches, validateNewMission, type NewMissionInput } from "../../lib/new-mission";
import type { CreateMissionResponse } from "../../lib/types";

const t = copy.newMission;

function PlanUnit({ unit, titles }: { unit: Unit; titles: Record<string, string> }) {
  return (
    <article className="card" aria-label={unit.title}>
      <h4>{unit.title}</h4>
      <p className="plan-task">{unit.task}</p>
      <dl>
        <dt>{copy.missionPage.stage}</dt>
        <dd>{LANE_LABELS[unit.lane]}</dd>
        <dt>{t.files}</dt>
        <dd>{unit.files.join(", ")}</dd>
        {unit.acceptance.length > 0 && (
          <>
            <dt>{t.checks}</dt>
            <dd>
              <code>{unit.acceptance.join("; ")}</code>
            </dd>
          </>
        )}
      </dl>
      {unit.needs.length > 0 && (
        <ul className="needs">
          {unit.needs.map((n) => (
            <li key={n.unit}>{t.needs(titles[n.unit] ?? n.unit, n.reads)}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function PlanResult({ result }: { result: CreateMissionResponse }) {
  if (!result.ok) {
    return (
      <section className="plan-errors" role="alert" aria-labelledby="plan-title">
        <h2 id="plan-title">{t.planTitle}</h2>
        <p>{t.planInvalid}</p>
        <ul>
          {result.errors.map((e) => (
            <li key={e}>
              <code>{e}</code>
            </li>
          ))}
        </ul>
        <p className="muted">{t.attempts(result.attempts)}</p>
      </section>
    );
  }

  const { waves, unplaced } = planBatches(result.plan);
  const titles = Object.fromEntries(result.plan.units.map((u) => [u.id, u.title]));
  return (
    <section aria-labelledby="plan-title">
      <h2 id="plan-title">{t.planTitle}</h2>
      <p className="muted">
        {t.attempts(result.attempts)}{" "}
        {!usingMock && <Link href={`/missions/${encodeURIComponent(result.mission_id)}`}>{t.openProject}</Link>}
      </p>
      <div className="waves">
        {waves.map((wave, i) => (
          <div className="wave" key={i}>
            <h3>{copy.missionPage.batch(i + 1)}</h3>
            <div className="cards">
              {wave.map((u) => (
                <PlanUnit key={u.id} unit={u} titles={titles} />
              ))}
            </div>
          </div>
        ))}
        {unplaced.length > 0 && (
          <div className="wave">
            <h3>{t.unplaced}</h3>
            <div className="cards">
              {unplaced.map((u) => (
                <PlanUnit key={u.id} unit={u} titles={titles} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}


const STEPS: FlowStep[] = ["goal", "interview", "review", "plan"];

function StepList({ step }: { step: FlowStep }) {
  const at = STEPS.indexOf(step);
  return (
    <ol className="steps" aria-label={t.stepsLabel}>
      {STEPS.map((s, i) => (
        <li key={s} className={i < at ? "done" : i === at ? "current" : undefined} aria-current={i === at ? "step" : undefined}>
          {t.steps[s]}
        </li>
      ))}
    </ol>
  );
}

/** Steps after the first replace the content under the user's focus, so focus moves to the new heading. */
function useHeadingFocus() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

function GoalStep({ state, onStart }: { state: FlowState; onStart: (input: NewMissionInput) => void }) {
  const [input, setInput] = useState<NewMissionInput>({ goal: state.goal, repo: state.repo });
  const [errors, setErrors] = useState<Partial<Record<keyof NewMissionInput, string>>>({});

  const update = (field: keyof NewMissionInput) => (value: string) => {
    setInput((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const check = validateNewMission(input);
    if (!check.ok) {
      setErrors(check.errors);
      document.getElementById(check.errors.goal ? "goal" : "repo")?.focus();
      return;
    }
    onStart(check.value);
  };

  return (
    <form className="mission-form" onSubmit={submit} noValidate aria-busy={state.busy}>
      <label htmlFor="goal">{t.goalLabel}</label>
      <textarea
        id="goal"
        rows={3}
        value={input.goal}
        maxLength={GOAL_MAX_LENGTH}
        onChange={(e) => update("goal")(e.target.value)}
        aria-invalid={errors.goal !== undefined}
        aria-describedby={errors.goal ? "goal-hint goal-error" : "goal-hint"}
        disabled={state.busy}
      />
      <p id="goal-hint" className="hint">
        {t.goalHint}
      </p>
      {errors.goal && (
        <p id="goal-error" className="form-error">
          {errors.goal}
        </p>
      )}

      <label htmlFor="repo">{t.repoLabel}</label>
      <input
        id="repo"
        type="text"
        value={input.repo}
        onChange={(e) => update("repo")(e.target.value)}
        aria-invalid={errors.repo !== undefined}
        aria-describedby={errors.repo ? "repo-hint repo-error" : "repo-hint"}
        disabled={state.busy}
        autoComplete="off"
        spellCheck={false}
      />
      <p id="repo-hint" className="hint">
        {t.repoHint}
      </p>
      {errors.repo && (
        <p id="repo-error" className="form-error">
          {errors.repo}
        </p>
      )}

      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={state.busy}>
        {state.busy ? t.submitting : t.submit}
      </button>
    </form>
  );
}

function InterviewStep({
  state,
  onAction,
  onRetry,
}: {
  state: FlowState;
  onAction: (action: FlowAction) => void;
  onRetry: () => void;
}) {
  const question = currentQuestion(state);
  const [draft, setDraft] = useState(question ? (state.answers[question.id] ?? "") : "");
  const heading = useHeadingFocus();
  const { n, total } = progress(state);

  if (!question) {
    return (
      <section className="interview" aria-busy={state.busy}>
        <h2 ref={heading} tabIndex={-1}>
          {t.questionsTitle}
        </h2>
        {state.busy && <p role="status">{t.writing}</p>}
        {state.error && (
          <>
            <p className="form-error" role="alert">
              {state.error}
            </p>
            <div className="actions">
              <button type="button" onClick={onRetry}>
                {copy.states.error.retry}
              </button>
              <button type="button" className="secondary" onClick={() => onAction({ type: "back" })}>
                {t.back}
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAction({ type: "answer", text: draft });
  };

  return (
    <form key={question.id} className="mission-form interview" onSubmit={submit} noValidate>
      <p className="hint">{t.questionOf(n, total)}</p>
      <h2 ref={heading} tabIndex={-1} id="question-text">
        {question.text}
      </h2>
      <label htmlFor="answer">{t.answerLabel}</label>
      <textarea id="answer" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} aria-describedby="question-text" />
      <div className="actions">
        <button type="submit">{t.next}</button>
        <button type="button" className="secondary" onClick={() => onAction({ type: "skip" })}>
          {t.skip}
        </button>
        {state.index > 0 && (
          <button type="button" className="secondary" onClick={() => onAction({ type: "back" })}>
            {t.back}
          </button>
        )}
      </div>
    </form>
  );
}

function ReviewStep({
  state,
  onAction,
  onPlan,
}: {
  state: FlowState;
  onAction: (action: FlowAction) => void;
  onPlan: () => void;
}) {
  const heading = useHeadingFocus();
  return (
    <form
      className="mission-form"
      noValidate
      aria-busy={state.busy}
      onSubmit={(e) => {
        e.preventDefault();
        onPlan();
      }}
    >
      <h2 ref={heading} tabIndex={-1}>
        {t.reviewTitle}
      </h2>
      <p className="hint">{t.reviewIntro}</p>
      {state.notice === "noInterviewer" && (
        <p className="notice info" role="status">
          {t.noInterviewer}
        </p>
      )}
      <label htmlFor="briefing">{t.briefingLabel}</label>
      <textarea
        id="briefing"
        className="briefing"
        rows={18}
        value={state.briefing}
        onChange={(e) => onAction({ type: "edit", markdown: e.target.value })}
        aria-invalid={state.error !== null}
        aria-describedby={state.error ? "briefing-error" : undefined}
        disabled={state.busy}
        spellCheck
      />
      {state.error && (
        <p id="briefing-error" className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={state.busy}>
          {state.busy ? t.planning : t.makePlan}
        </button>
        <button type="button" className="secondary" onClick={() => onAction({ type: "restart" })} disabled={state.busy}>
          {t.startOver}
        </button>
      </div>
    </form>
  );
}

export function NewMissionForm() {
  const [state, dispatch] = useReducer(flowReducer, initialFlow);

  const applyReply = (reply: BriefingReply) =>
    dispatch(
      reply.kind === "questions"
        ? { type: "questions", briefingId: reply.briefingId, questions: reply.questions }
        : { type: "briefing", markdown: reply.markdown },
    );

  const start = async ({ goal, repo }: NewMissionInput) => {
    dispatch({ type: "start", goal, repo });
    try {
      const reply = await startBriefing(goal, repo);
      if (reply.kind === "unavailable") dispatch({ type: "noInterviewer" });
      else applyReply(reply);
    } catch {
      dispatch({ type: "fail", message: t.errors.interviewFailed });
    }
  };

  const sendAnswers = async (from: FlowState) => {
    if (!from.briefingId) return;
    dispatch({ type: "submit" });
    try {
      applyReply(await answerBriefing(from.briefingId, answersPayload(from)));
    } catch {
      dispatch({ type: "fail", message: t.errors.interviewFailed });
    }
  };

  const interviewAction = (action: FlowAction) => {
    const next = flowReducer(state, action);
    dispatch(action);
    if (next.index >= next.questions.length && state.index < state.questions.length) void sendAnswers(next);
  };

  const plan = async () => {
    const check = validateBriefing(state.briefing);
    if (!check.ok) {
      dispatch({ type: "fail", message: check.error });
      document.getElementById("briefing")?.focus();
      return;
    }
    dispatch({ type: "submit" });
    try {
      dispatch({ type: "plan", result: await createMission(check.value, state.repo) });
    } catch {
      dispatch({ type: "fail", message: t.errors.failed });
    }
  };

  return (
    <>
      <StepList step={state.step} />
      {state.step === "goal" && <GoalStep state={state} onStart={(input) => void start(input)} />}
      {state.step === "interview" && (
        <InterviewStep key={state.index} state={state} onAction={interviewAction} onRetry={() => void sendAnswers(state)} />
      )}
      {state.step === "review" && <ReviewStep state={state} onAction={dispatch} onPlan={() => void plan()} />}
      {state.step === "plan" && state.plan && (
        <>
          <PlanResult result={state.plan} />
          <div className="actions">
            <button type="button" onClick={() => dispatch({ type: "review" })}>
              {t.editRequirements}
            </button>
            <button type="button" className="secondary" onClick={() => dispatch({ type: "restart" })}>
              {t.startOver}
            </button>
          </div>
        </>
      )}
    </>
  );
}