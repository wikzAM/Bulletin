export interface Keychain {
  getSecret(name: string): Promise<string | undefined>;
  setSecret(name: string, value: string): Promise<void>;
}

export class EnvKeychain implements Keychain {
  constructor(private readonly env: NodeJS.Dict<string> = process.env) {}

  async getSecret(name: string): Promise<string | undefined> {
    validateName(name);
    return Object.hasOwn(this.env, name) ? this.env[name] : undefined;
  }

  async setSecret(name: string, value: string): Promise<void> {
    validateName(name);
    if (value.includes("\0")) throw new Error("Secret values cannot contain a null character");
    this.env[name] = value;
  }
}

function validateName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Secret name must be an environment variable name");
}

export function nativeKeychainStub(platform: string): Keychain {
  const unavailable = async (): Promise<never> => {
    throw new Error(`${platform} keychain is unavailable in the TypeScript platform layer`);
  };
  return { getSecret: unavailable, setSecret: unavailable };
}

/**
 * The secrets Bulletin stores for the desktop, in the system keychain on the Rust side (docs/SIDECAR.md, "Secrets").
 * The same list is enforced by the Tauri commands; the sidecar sees these only as environment variables.
 */
export const SECRET_NAMES = ["ANTHROPIC_API_KEY", "AWS_BEARER_TOKEN_BEDROCK", "BULLETIN_GITHUB_TOKEN"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export function isSecretName(name: unknown): name is SecretName {
  return typeof name === "string" && (SECRET_NAMES as readonly string[]).includes(name);
}
