import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Thrown for a key or value the settings file does not allow. The message never contains the offending value. */
export class SettingsError extends Error {}

export type SettingValue = string | boolean;
export type Settings = Record<string, SettingValue>;

const PROVIDERS = ["claude-code", "anthropic-key", "bedrock"];

/** The only settings that exist. Anything else (an API key, a token) is refused, so none can end up in the file. */
const VALIDATORS: Record<string, (value: unknown) => boolean> = {
  provider: (value) => typeof value === "string" && PROVIDERS.includes(value),
  repo_path: (value) => typeof value === "string" && value.length <= 1024 && !value.includes("\0"),
  setup_complete: (value) => typeof value === "boolean",
  // A region name such as us-east-1 or us-gov-west-1 (Bedrock).
  aws_region: (value) => typeof value === "string" && /^[a-z]{2}(?:-[a-z]+)+-[0-9]$/.test(value),
};

export const SETTING_KEYS = Object.keys(VALIDATORS);

function sanitize(raw: unknown): Settings {
  const settings: Settings = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return settings;
  for (const [key, value] of Object.entries(raw)) {
    if (Object.hasOwn(VALIDATORS, key) && VALIDATORS[key]!(value)) settings[key] = value as SettingValue;
  }
  return settings;
}

/** Non-secret settings in `settings.json` in the app data folder. Changes are serialized and replace the file atomically. */
export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string) {}

  private get file(): string {
    return join(this.directory, "settings.json");
  }

  private async read(): Promise<Settings> {
    try {
      return sanitize(JSON.parse(await readFile(this.file, "utf8")));
    } catch {
      return {};
    }
  }

  get(): Promise<Settings> {
    return this.enqueue(() => this.read());
  }

  async set(values: Record<string, unknown>): Promise<Settings> {
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(VALIDATORS, key)) throw new SettingsError("Unknown setting");
      if (value !== null && !VALIDATORS[key]!(value)) throw new SettingsError(`Invalid value for setting ${key}`);
    }
    return this.enqueue(async () => {
      const settings = await this.read();
      for (const [key, value] of Object.entries(values)) {
        if (value === null) delete settings[key];
        else settings[key] = value as SettingValue;
      }
      await mkdir(this.directory, { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`);
        await rename(temporary, this.file);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return settings;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
