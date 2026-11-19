import type { BulletinEvent } from "@bulletin/core";
import type { EventLog } from "../store/event-log";
import { endsMissionExecution, startsMissionExecution } from "../store/mission-state";

interface EventSink {
  event(event: BulletinEvent): void | Promise<void>;
  end(): void;
  error(error: unknown): void;
}

interface Subscription {
  missionId: string;
  after: number;
  sink: EventSink;
  next: number;
  end?: number;
  busy: boolean;
}

/** Each subscriber has its own cursor and backpressure, with one poll while listeners exist. */
export class MissionEventFeed {
  private readonly subscriptions = new Set<Subscription>();
  private readonly deliveries = new Set<Promise<void>>();
  private readonly finished = new Set<string>();
  private observed = 0;
  private poll?: NodeJS.Timeout;

  constructor(private readonly log: EventLog) {}

  isFinished(missionId: string): boolean {
    while (this.observed < this.log.events.length) {
      const event = this.log.events[this.observed++];
      if (!event) continue;
      if (endsMissionExecution(event)) this.finished.add(event.mission_id);
      if (startsMissionExecution(event)) this.finished.delete(event.mission_id);
    }
    return this.finished.has(missionId);
  }

  subscribe(missionId: string, after: number, sink: EventSink): () => void {
    const length = this.log.events.length;
    const first = this.log.events.findIndex(({ id }) => id > after);
    const subscription: Subscription = {
      missionId, after, sink, next: first < 0 ? length : first,
      end: this.isFinished(missionId) ? length : undefined, busy: false,
    };
    this.subscriptions.add(subscription);
    this.poll ??= setInterval(() => {
      for (const listener of this.subscriptions) this.schedule(listener);
    }, 50).unref();
    queueMicrotask(() => this.schedule(subscription));
    return () => this.remove(subscription);
  }

  listenerCount(missionId: string): number {
    let count = 0;
    for (const listener of this.subscriptions) if (listener.missionId === missionId) count++;
    return count;
  }

  async close(): Promise<void> {
    for (const listener of this.subscriptions) this.remove(listener);
    await Promise.all(this.deliveries);
  }

  private remove(subscription: Subscription): void {
    this.subscriptions.delete(subscription);
    if (this.subscriptions.size === 0) {
      clearInterval(this.poll);
      this.poll = undefined;
    }
  }

  private schedule(subscription: Subscription): void {
    if (subscription.busy || !this.subscriptions.has(subscription)) return;
    subscription.busy = true;
    const delivery = this.flush(subscription).finally(() => {
      subscription.busy = false;
      this.deliveries.delete(delivery);
    });
    this.deliveries.add(delivery);
  }

  private async flush(subscription: Subscription): Promise<void> {
    const length = this.log.events.length;
    if (subscription.end === undefined && this.isFinished(subscription.missionId)) subscription.end = length;
    const end = subscription.end ?? length;
    try {
      while (subscription.next < end && this.subscriptions.has(subscription)) {
        const event = this.log.events[subscription.next++];
        if (event && event.mission_id === subscription.missionId && event.id > subscription.after) {
          await subscription.sink.event(event);
        }
      }
      if (subscription.end !== undefined && this.subscriptions.has(subscription)) {
        this.remove(subscription);
        subscription.sink.end();
      }
    } catch (error) {
      this.remove(subscription);
      subscription.sink.error(error);
    }
  }
}
