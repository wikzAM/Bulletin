import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SidecarDiagnostics } from "./diagnostics";

it("keeps only three bounded log files and tails them in chronological order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-diagnostics-"));
  try {
    const diagnostics = new SidecarDiagnostics(directory);
    expect(diagnostics.tail(500)).toEqual([]);

    const logs = join(directory, "logs");
    const base = "2026-11-23T12:00:00.000Z RPC parse error";
    const previous = "2026-11-22T12:00:00.000Z Sidecar started";
    const oldest = "2026-11-21T12:00:00.000Z Sidecar stopped";
    const limit = 1024 * 1024;
    const line = base + "\n";
    await mkdir(logs);
    await writeFile(join(logs, "sidecar.log"), line.repeat(Math.floor(limit / Buffer.byteLength(line))));
    await writeFile(join(logs, "sidecar.log.1"), previous + "\n");
    await writeFile(join(logs, "sidecar.log.2"), oldest + "\n");
    expect(diagnostics.tail(500)).toHaveLength(500);
    expect(diagnostics.tail(1)).toEqual([base]);

    diagnostics.write("started");
    expect((await readdir(logs)).sort()).toEqual(["sidecar.log", "sidecar.log.1", "sidecar.log.2"]);
    expect((await stat(join(logs, "sidecar.log.1"))).size).toBeLessThanOrEqual(limit);
    expect((await stat(join(logs, "sidecar.log"))).size).toBeLessThanOrEqual(limit);
    expect(diagnostics.tail(2)).toEqual([base, expect.stringMatching(/^\S+ Sidecar started$/)]);

    // Use small generations to verify ordering across all three files after rotation.
    await writeFile(join(logs, "sidecar.log.1"), base + "\n");
    expect(diagnostics.tail(500)).toEqual([previous, base, expect.stringMatching(/^\S+ Sidecar started$/)]);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
