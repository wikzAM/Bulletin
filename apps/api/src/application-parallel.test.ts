import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "@bulletin/runners";
import { git } from "@bulletin/runners/git";
import { StubRunner } from "@bulletin/runners/stub-runner";
import { expect, it, vi } from "vitest";
import { createApplication } from "./application";

it("honors the saved cap when a wave has more ready stations than the limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "bulletin-parallel-"));
  const repo = join(root, "repo");
  const files = ["one.txt", "two.txt", "three.txt", "four.txt"];
  let application: Awaited<ReturnType<typeof createApplication>> | undefined;
  let started = 0;
  let active = 0;
  let peak = 0;
  let releaseWave!: () => void;
  const twoStarted = new Promise<void>((resolve) => { releaseWave = resolve; });

  try {
    vi.stubEnv("BULLETIN_DATA_DIR", root);
    vi.stubEnv("BULLETIN_SCRATCH_DIR", root);
    vi.stubEnv("BULLETIN_EVENT_STORE", "sqlite");
    vi.stubEnv("BULLETIN_RESOURCE_DIR", "");
    vi.stubEnv("BULLETIN_API_TOKEN", "");
    vi.stubEnv("BULLETIN_PROVIDER", "");
    vi.stubEnv("BULLETIN_RUNNER", "claude");
    await writeFile(join(root, "settings.json"), JSON.stringify({ max_parallel_stations: 2 }));
    await mkdir(repo);
    await git(repo, "init", "-q", "-b", "main");
    await git(repo, "config", "user.name", "Fixture");
    await git(repo, "config", "user.email", "fixture@example.invalid");
    await git(repo, "config", "commit.gpgsign", "false");
    await Promise.all(files.map((file) => writeFile(join(repo, file), "0\n")));
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "fixture base");

    application = await createApplication({
      async createRunner(repoPath, scratchDir): Promise<Runner> {
        const stub = new StubRunner(repoPath, join(scratchDir, "stations"), ({ unit }) => ({
          files: { [unit.files[0]!]: "1\n" },
        }));
        return {
          kind: stub.kind,
          async startAttempt(input) {
            active++;
            peak = Math.max(peak, active);
            if (++started === 2) releaseWave();
            return stub.startAttempt(input);
          },
          async *events(handle) {
            try {
              await twoStarted;
              yield* stub.events(handle);
            } finally {
              active--;
            }
          },
          cancel: (handle) => stub.cancel(handle),
        };
      },
      testCommand: "node --version",
    });

    const { app, log } = application;
    const mission_id = "parallel";
    await log.emit({ mission_id, type: "mission.created", payload: { repo, base: "main", budget_cents: 50 } });
    await log.emit({ mission_id, type: "plan.proposed", payload: { plan: {
      briefing_version: 1,
      units: files.map((file, index) => ({
        id: `unit-${index}`, title: `Write ${file}`, task: "Set the fixture value", files: [file],
        estimate: { input_tokens: 1000, output_tokens: 100 },
      })),
    } } });

    expect((await app.inject({ method: "POST", url: "/missions/parallel/approve" })).statusCode).toBe(202);
    await vi.waitFor(() => expect(log.events.at(-1)).toMatchObject({ type: "mission.finished", payload: { shipped: 4 } }), {
      timeout: 90_000,
    });
    expect(started).toBe(4);
    expect(peak).toBe(2);
  } finally {
    releaseWave();
    await application?.app.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}, 120_000);
