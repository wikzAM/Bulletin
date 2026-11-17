import { z } from "zod";

/** Every state change is one of these, appended to the event log (spec section 13). */
export const EVENT_TYPES = [
  "mission.created",
  "briefing.versioned",
  "plan.proposed",
  "plan.approved",
  "wave.started",
  "unit.started",
  "attempt.started",
  "attempt.ended",
  "dispatch.asked",
  "dispatch.answered",
  "dispatch.escalated",
  "dispatch.posted",
  "decision.opened",
  "decision.resolved",
  "pass.green",
  "pass.red",
  "unit.sent_back",
  "unit.merged",
  "unit.held",
  "unit.failed",
  "unit.blocked",
  "ledger.charged",
  "budget.paused",
  "mission.finished",
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const BulletinEventSchema = z.object({
  id: z.number().int().nonnegative(),
  mission_id: z.string().min(1),
  ts: z.string(),
  type: EventTypeSchema,
  unit_id: z.string().nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type BulletinEvent = z.infer<typeof BulletinEventSchema>;

/** An event before the log assigns its id and timestamp. */
export type NewEvent = Pick<BulletinEvent, "mission_id" | "type"> &
  Partial<Pick<BulletinEvent, "unit_id" | "payload">>;

/** Anything that can append to the event log. The Postgres log and in-memory logs implement it. */
export interface EventSink {
  emit(event: NewEvent): Promise<BulletinEvent>;
}

/** In-memory log for tests and the command-line runner. */
export class MemoryEventLog implements EventSink {
  readonly events: BulletinEvent[] = [];

  async emit(event: NewEvent): Promise<BulletinEvent> {
    const full: BulletinEvent = {
      id: this.events.length + 1,
      mission_id: event.mission_id,
      ts: new Date().toISOString(),
      type: event.type,
      unit_id: event.unit_id ?? null,
      payload: event.payload ?? {},
    };
    this.events.push(full);
    return full;
  }
}
