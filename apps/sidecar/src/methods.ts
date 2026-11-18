import { isAbsolute } from "node:path";
import { checkEnvironment as defaultCheckEnvironment, type EnvCheckResult } from "../../api/src/platform/env-check";
import { isSecretName, type Keychain } from "../../api/src/platform/keychain";
import { inspectRepo as defaultInspectRepo, type RepoInfo } from "../../api/src/platform/repo-inspect";
import { SettingsError, SettingsStore } from "../../api/src/platform/settings";
import { RpcError } from "./rpc-error";

type Params = Record<string, unknown>;
export type Method = (params: Params) => Promise<unknown>;

export interface DesktopMethodDeps {
  /** The app data folder (`settings.json` lives here). */
  dataDirectory: string;
  keychain: Keychain;
  env?: NodeJS.Dict<string>;
  checkEnvironment?: () => Promise<EnvCheckResult>;
  inspectRepo?: (path: string) => Promise<RepoInfo>;
}

const MAX_SECRET_LENGTH = 8192;

function secretName(params: Params) {
  if (!isSecretName(params.name)) throw new RpcError(-32602, "Unknown secret name");
  return params.name;
}

/**
 * The methods the desktop first-run screen calls (docs/SIDECAR.md): environment check, repository inspection,
 * non-secret settings, and presence of secrets. Nothing here returns a secret value.
 */
export function createDesktopMethods(deps: DesktopMethodDeps): Record<string, Method> {
  const env = deps.env ?? process.env;
  const settings = new SettingsStore(deps.dataDirectory);
  const checkEnvironment = deps.checkEnvironment ?? (() => defaultCheckEnvironment({ env }));
  const inspectRepo = deps.inspectRepo ?? ((path: string) => defaultInspectRepo(path, { env }));

  return {
    "env.check": () => checkEnvironment(),

    "repo.inspect": async ({ path }) => {
      if (typeof path !== "string" || path.includes("\0") || !isAbsolute(path)) {
        throw new RpcError(-32602, "Expected an absolute folder path");
      }
      return inspectRepo(path);
    },

    "settings.get": async () => ({ settings: await settings.get() }),

    "settings.set": async ({ values }) => {
      if (typeof values !== "object" || values === null || Array.isArray(values)) {
        throw new RpcError(-32602, "Expected values, an object of settings");
      }
      try {
        return { settings: await settings.set(values as Record<string, unknown>) };
      } catch (error) {
        if (error instanceof SettingsError) throw new RpcError(-32602, error.message);
        throw error;
      }
    },

    "secret.has": async (params) => {
      const name = secretName(params);
      return { name, present: Boolean((await deps.keychain.getSecret(name))?.trim()) };
    },

    "secret.set": async (params) => {
      const name = secretName(params);
      const { value } = params;
      if (typeof value !== "string" || value.trim() === "" || value.length > MAX_SECRET_LENGTH || value.includes("\0")) {
        throw new RpcError(-32602, "Expected a non-empty value without a null character");
      }
      await deps.keychain.setSecret(name, value);
      return { name, stored: true };
    },
  };
}
