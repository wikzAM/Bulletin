import { useMemo, useState } from "react";
import { answerQuestion, resolveDecision } from "../lib/api";
import { copy } from "../lib/copy";
import { heldForYou } from "../lib/decisions";
import { answerPayload, groupInbox, resolvePayload, type InboxItem } from "../lib/inbox";
import type { Question } from "../lib/types";
import type { DecisionChoice, WarTableState } from "../lib/war-table";
import { DecisionDrawer } from "./WarExtras";

function heldToInbox(state: WarTableState): InboxItem[] {
  return heldForYou(state, {}).map((h) => {
    const unit = state.units[h.id];
    const kind = unit?.decision?.kind === "gated_retry" || unit?.lane === "gated" ? "gated_retry" : "closed_lane_merge";
    return {
      id: h.id,
      kind,
      title: h.title,
      detail: h.why,
      unitId: h.id,
      branch: h.branch ?? undefined,
    };
  });
}

function questionsToInbox(questions: Question[]): InboxItem[] {
  return questions
    .filter((q) => q.status === "open")
    .map((q) => ({
      id: q.id,
      kind: "question" as const,
      title: q.body.slice(0, 80),
      detail: q.body,
      unitId: q.unit_id,
    }));
}

export function InboxDrawer({
  missionId,
  state,
  questions,
  open,
  onToggle,
}: {
  missionId: string;
  state: WarTableState;
  questions: Question[];
  open: boolean;
  onToggle: () => void;
}) {
  const t = copy.inbox;
  const th = copy.held;
  const items = useMemo(() => [...questionsToInbox(questions), ...heldToInbox(state)], [questions, state]);
  const groups = groupInbox(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const decide = async (unitId: string, choice: DecisionChoice) => {
    setBusy(unitId);
    try {
      void resolvePayload(choice);
      const result = await resolveDecision(missionId, unitId, choice);
      setNotes((n) => ({ ...n, [unitId]: result.ok ? th.choice[choice] : th.failed }));
    } finally {
      setBusy(null);
    }
  };

  const sendAnswer = async (questionId: string) => {
    const text = answers[questionId]?.trim() ?? "";
    if (!text) return;
    setBusy(questionId);
    try {
      void answerPayload(text);
      await answerQuestion(questionId, text);
      setNotes((n) => ({ ...n, [questionId]: copy.questions.chips.answered.label }));
      setAnswers((a) => ({ ...a, [questionId]: "" }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <DecisionDrawer open={open} onToggle={onToggle} count={items.length}>
      {groups.length === 0 ? (
        <p className="muted">{t.empty}</p>
      ) : (
        groups.map((g) => (
          <section key={g.kind} className="inbox-group">
            <h3>{g.label}</h3>
            <ul>
              {g.items.map((item) => (
                <li key={item.id}>
                  <h4>{item.title}</h4>
                  <p>{item.detail}</p>
                  {item.branch && <p className="muted">{th.branch(item.branch)}</p>}
                  {item.kind === "question" ? (
                    <div className="inbox-answer">
                      <label htmlFor={`ans-${item.id}`}>{t.answerLabel}</label>
                      <textarea
                        id={`ans-${item.id}`}
                        rows={2}
                        value={answers[item.id] ?? ""}
                        onChange={(e) => setAnswers((a) => ({ ...a, [item.id]: e.target.value }))}
                      />
                      <button type="button" onClick={() => void sendAnswer(item.id)} disabled={busy !== null}>
                        {t.answerSend}
                      </button>
                    </div>
                  ) : item.kind !== "budget" && item.unitId ? (
                    <div className="actions">
                      <button type="button" onClick={() => void decide(item.unitId!, "approve")} disabled={busy !== null}>
                        {th.approve}
                      </button>
                      <button type="button" className="secondary" onClick={() => void decide(item.unitId!, "reject")} disabled={busy !== null}>
                        {th.reject}
                      </button>
                    </div>
                  ) : null}
                  {notes[item.id] && <p className="notice">{notes[item.id]}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </DecisionDrawer>
  );
}
