import { accessSync, constants, statSync } from "node:fs";
import { delimiter as hostDelimiter, posix, win32 } from "node:path";
import { spawnCommand } from "./process";

type Env = NodeJS.Dict<string>;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExecutable(path: string): boolean {
  if (!isFile(path)) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function lookup(env: Env, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/**
 * Finds a program by bare name the way the system shell would: every PATH folder in order, and on Windows each
 * PATHEXT extension (`claude` finds `claude.exe` or an npm `claude.cmd`). Returns an absolute path or undefined.
 */
export function resolveExecutable(name: string, env: Env = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  if (!name || /[\\/\0]/.test(name)) return undefined;
  const windows = platform === "win32";
  const paths = windows ? win32 : posix;
  const path = lookup(env, "PATH", platform) ?? "";
  const folders = path.split(windows ? ";" : platform === process.platform ? hostDelimiter : ":").map((folder) => folder.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
  const extensions = windows
    ? (lookup(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD").split(";").map((extension) => extension.trim()).filter(Boolean)
    : [];
  const hasExtension = windows && extensions.some((extension) => name.toLowerCase().endsWith(extension.toLowerCase()));
  const candidates = windows ? (hasExtension ? [name] : extensions.map((extension) => `${name}${extension}`)) : [name];
  for (const folder of folders) {
    for (const candidate of candidates) {
      const full = paths.join(folder, candidate);
      if (windows ? isFile(full) : isExecutable(full)) return full;
    }
  }
  return undefined;
}

export interface ToolOptions {
  cwd: string;
  env: Env;
  timeoutMs: number;
  /** Output kept per run; more is dropped and `truncated` is set. Default 1 MiB. */
  maxBytes?: number;
}

export interface ToolResult {
  /** Exit code, or null when the program could not start or was stopped. */
  code: number | null;
  stdout: string;
  timedOut: boolean;
  truncated: boolean;
}

const SHIM_ARGUMENT = /^[A-Za-z0-9_.:=@%+,-]+$/;

/**
 * Runs one program to completion with literal arguments, a time limit and capped output. A Windows `.cmd` or `.bat`
 * shim cannot be started without a shell, so it goes through the platform shell; its arguments must then be plain
 * words (no spaces or shell characters), which every caller here satisfies.
 */
export async function runTool(executable: string, args: readonly string[], options: ToolOptions): Promise<ToolResult> {
  const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
  if (shim) {
    for (const arg of args) if (!SHIM_ARGUMENT.test(arg)) throw new Error(`Unsupported argument for a Windows shim: ${JSON.stringify(arg)}`);
  }
  const command = shim ? { script: [`"${executable}"`, ...args].join(" ") } : { executable, args };
  const limit = options.maxBytes ?? 1024 * 1024;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawnCommand>;
    try {
      child = spawnCommand(command, { cwd: options.cwd, env: options.env as NodeJS.ProcessEnv });
    } catch {
      resolve({ code: null, stdout: "", timedOut: false, truncated: false });
      return;
    }
    let stdout = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, timedOut, truncated });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop(child.pid);
      child.kill();
    }, options.timeoutMs);
    child.stdin.end();
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length + chunk.length > limit) {
        truncated = true;
        stdout += chunk.slice(0, Math.max(0, limit - stdout.length));
      } else stdout += chunk;
    });
    child.stderr.resume();
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

/** A shell wrapper (cmd.exe running a shim) leaves its child behind when killed; take the whole tree on Windows. */
function stop(pid: number | undefined): void {
  if (pid === undefined || process.platform !== "win32") return;
  try {
    spawnCommand({ executable: "taskkill", args: ["/pid", String(pid), "/t", "/f"] }, { cwd: process.cwd(), env: process.env }).on("error", () => undefined);
  } catch {
    // The direct kill below still runs.
  }
}
