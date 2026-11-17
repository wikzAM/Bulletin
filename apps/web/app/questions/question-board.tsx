"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { answerQuestion } from "../../lib/api";
import { copy } from "../../lib/copy";
import {
  ANSWER_MAX_LENGTH,
  answeredBy,
  countQuestions,
  handoverReason,
  filterQuestions,
  questionChip,
  replaceQuestion,
  sortQuestions,
  validateAnswer,
  type QuestionFilter,
} from "../../lib/questions";
import type { Question } from "../../lib/types";

const t = copy.questions;
const FILTERS: QuestionFilter[] = ["open", "answered", "all"];

function AnswerForm({ question, onAnswered }: { question: Question; onAnswered: (q: Question) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = validateAnswer(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSending(true);
    setError(null);
    try {
      onAnswered(await answerQuestion(question.id, result.value));
    } catch {
      setError(t.errors.failed);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="answer-form" onSubmit={submit} noValidate>
      <label htmlFor={fieldId}>{t.answerLabel}</label>
      <textarea
        id={fieldId}
        value={text}
        rows={3}
        maxLength={ANSWER_MAX_LENGTH}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        disabled={sending}
      />
      {error && (
        <p id={errorId} className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={sending}>
        {sending ? t.sending : t.submit}
      </button>
    </form>
  );
}

function QuestionItem({
  question,
  goal,
  onAnswered,
}: {
  question: Question;
  goal: string | undefined;
  onAnswered: (q: Question) => void;
}) {
  const chip = questionChip(question);
  const by = answeredBy(question);
  const handover = handoverReason(question);
  return (
    <li className="question">
      <div className="question-meta">
        <span className={`chip chip-${chip.tone}`}>
          <span aria-hidden="true">{chip.icon}</span> {chip.label}
        </span>
        <span className="muted">
          {goal && (
            <>
              <Link href={`/missions/${encodeURIComponent(question.mission_id)}`}>{goal}</Link> ·{" "}
            </>
          )}
          {question.unit_id && t.askedBy(question.unit_id)}
        </span>
      </div>
      <p className="question-body">{question.body}</p>
      {question.status === "answered" ? (
        <div className="question-answer">
          <strong>{t.answer}:</strong> {question.answer}
          {by && by.text !== chip.label && <div className={`muted answered-by answered-by-${by.who}`}>{by.text}</div>}
        </div>
      ) : (
        <>
          {handover && <p className="handover">{handover}</p>}
          <AnswerForm question={question} onAnswered={onAnswered} />
        </>
      )}
    </li>
  );
}

export function QuestionBoard({
  initial,
  filter,
  goals,
}: {
  initial: Question[];
  filter: QuestionFilter;
  goals: Record<string, string>;
}) {
  const [questions, setQuestions] = useState(initial);
  const [notice, setNotice] = useState("");
  const counts = countQuestions(questions);
  const visible = sortQuestions(filterQuestions(questions, filter));

  const onAnswered = (updated: Question) => {
    setQuestions((list) => replaceQuestion(list, updated));
    setNotice(t.sent(updated.body));
  };

  return (
    <>
      <p className="notice" role="status">
        {notice}
      </p>
      <nav className="tabs" aria-label={t.title}>
        {FILTERS.map((f) => (
          <Link key={f} href={`/questions?status=${f}`} aria-current={f === filter ? "page" : undefined}>
            {t.filters[f]} <span className="badge">{counts[f]}</span>
          </Link>
        ))}
      </nav>
      {visible.length === 0 ? (
        <p className="muted">{t.empty[filter]}</p>
      ) : (
        <ul className="questions">
          {visible.map((q) => (
            <QuestionItem
              key={q.id}
              question={q}
              goal={goals[q.mission_id]}
              onAnswered={onAnswered}
            />
          ))}
        </ul>
      )}
    </>
  );
}
