"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { Unit } from "@bulletin/core";
import { createMission, usingMock } from "../../lib/api";
import { copy, LANE_LABELS } from "../../lib/copy";
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

export function NewMissionForm() {
  const [input, setInput] = useState<NewMissionInput>({ goal: "", repo: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof NewMissionInput, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateMissionResponse | null>(null);

  const update = (field: keyof NewMissionInput) => (value: string) => {
    setInput((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const check = validateNewMission(input);
    if (!check.ok) {
      setErrors(check.errors);
      document.getElementById(check.errors.goal ? "goal" : "repo")?.focus();
      return;
    }
    setSubmitting(true);
    setFailure(null);
    setResult(null);
    try {
      setResult(await createMission(check.value.goal, check.value.repo));
    } catch {
      setFailure(t.errors.failed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <form className="mission-form" onSubmit={submit} noValidate aria-busy={submitting}>
        <label htmlFor="goal">{t.goalLabel}</label>
        <textarea
          id="goal"
          rows={3}
          value={input.goal}
          maxLength={GOAL_MAX_LENGTH}
          onChange={(e) => update("goal")(e.target.value)}
          aria-invalid={errors.goal !== undefined}
          aria-describedby={errors.goal ? "goal-hint goal-error" : "goal-hint"}
          disabled={submitting}
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
          disabled={submitting}
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

        {failure && (
          <p className="form-error" role="alert">
            {failure}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? t.submitting : t.submit}
        </button>
      </form>
      {result && <PlanResult result={result} />}
    </>
  );
}
