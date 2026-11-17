import type { BulletinEvent, EventSink } from "@bulletin/core";

export interface EventLog extends EventSink {
  /** Persisted events in ascending ID order. The same array grows as events are committed. */
  readonly events: readonly BulletinEvent[];
}
