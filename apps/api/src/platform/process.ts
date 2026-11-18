import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";

type Command = { executable: string; args?: readonly string[] } | { script: string };
type CommandOptions = Pick<SpawnOptions, "env" | "signal"> & { cwd: string };

export function systemShell(platform = process.platform, env: NodeJS.Dict<string> = process.env): string {
  return platform === "win32" ? (env.ComSpec || env.COMSPEC || "cmd.exe") : "/bin/sh";
}

/** Executables receive literal arguments. A check that needs shell syntax supplies a complete script. */
export function spawnCommand(command: Command, options: CommandOptions): ChildProcessWithoutNullStreams {
  const spawnOptions = { ...options, windowsHide: true, stdio: "pipe" as const };
  if ("script" in command) {
    return spawn(command.script, { ...spawnOptions, shell: systemShell(process.platform, options.env) });
  }
  return spawn(command.executable, command.args ?? [], spawnOptions);
}
