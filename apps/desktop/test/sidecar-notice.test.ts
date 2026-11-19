import { describe, expect, it } from "vitest";
import { initialRestartNotice, reduceRestartNotice, type NoticeEvent } from "../src/lib/sidecar-notice";

const started: NoticeEvent = { type: "sidecar", source: "bulletin://sidecar", status: "started" };

describe("restart notice", () => {
  it("stays quiet when the service starts before the project is live", () => {
    const after = reduceRestartNotice(initialRestartNotice, started);
    expect(after.notice).toBeNull();
  });

  it("shows a notice when the service starts again mid-project, then clears once the stream is live", () => {
    const live = reduceRestartNotice(initialRestartNotice, { type: "connection", state: "live" });
    const restarted = reduceRestartNotice(live, started);
    expect(restarted.notice).toBe("The background service restarted. Picking the work back up.");
    const resumed = reduceRestartNotice(restarted, { type: "connection", state: "live" });
    expect(resumed.notice).toBeNull();
    expect(resumed.seenLive).toBe(true);
  });

  it("ignores a fake event that is not the sidecar starting", () => {
    const live = reduceRestartNotice(initialRestartNotice, { type: "connection", state: "live" });
    const other = reduceRestartNotice(live, { type: "sidecar", source: "bulletin://sidecar", status: "idle" });
    expect(other.notice).toBeNull();
  });
});
