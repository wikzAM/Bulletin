import { mkdir, mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadModelsConfig } from "@bulletin/core";
import { expect, it, vi } from "vitest";
import { createApplication } from "./application";
import type * as GeneralModule from "./general";
import { modelCallFactory } from "./general";

vi.mock("./general", async (importOriginal) => ({
  ...await importOriginal<typeof GeneralModule>(),
  claudeModelCall: () => async () => { throw new Error("Unexpected Claude Code call"); },
  modelCallFactory: vi.fn(),
}));

it("uses the configured provider for the General, Interviewer and Answerer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-model-config-"));
  const data = join(directory, "api");
  await mkdir(data);
  vi.stubEnv("BULLETIN_PROVIDER", "bedrock");
  vi.stubEnv("BULLETIN_RUNNER", "claude");
  vi.stubEnv("BULLETIN_SCRATCH_DIR", directory);
  vi.stubEnv("BULLETIN_RESOURCE_DIR", "");
  vi.stubEnv("BULLETIN_EVENT_STORE", "jsonl");
  vi.stubEnv("BULLETIN_API_TOKEN", "");
  const models = loadModelsConfig(resolve(import.meta.dirname, "../../../config/models.json"));
  const createCall = vi.fn((_model: string) => async () => '{"question":"What should the demo do?"}');
  const factory = vi.mocked(modelCallFactory).mockReturnValue(createCall);
  let application: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    application = await createApplication();
    expect(factory.mock.calls[0]?.[0].BULLETIN_PROVIDER).toBe("bedrock");
    expect(factory.mock.calls[0]?.[1]?.bedrockModels).toEqual(models.providers?.bedrock?.models);
    for (const role of ["general", "interviewer", "answerer"]) {
      expect(createCall).toHaveBeenCalledWith(models.roles[role]?.model);
    }

    const response = await application.app.inject({ method: "POST", url: "/briefings", payload: { goal: "Make a demo" } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ question: "What should the demo do?" });
  } finally {
    await application?.app.close();
    vi.unstubAllEnvs();
    await rm(join(data, "events.jsonl"), { force: true });
    await rm(join(data, "briefings.jsonl"), { force: true });
    await rmdir(data);
    await rmdir(directory);
  }
}, 30_000);
