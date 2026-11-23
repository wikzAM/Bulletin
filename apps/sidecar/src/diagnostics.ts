import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const fileSizeLimit = 1024 * 1024;
const fileCount = 3;

// Accept only predefined messages. Error details, model text, request data, and
// environment values never enter the diagnostics writer.
const messages = {
  started: "Sidecar started",
  stopped: "Sidecar stopped",
  failed: "Sidecar failed to start or shut down",
  schemaTooNew: "This database requires a newer version of Bulletin.",
  transportFailed: "Sidecar transport failed",
  apiFailed: "API request failed",
  rpcParseError: "RPC parse error",
  rpcInvalidRequest: "Invalid RPC request",
  rpcUnknownMethod: "RPC method not found",
  rpcInternalError: "Internal RPC error",
} as const;

function missing(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export class SidecarDiagnostics {
  private readonly directory: string;

  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, "logs");
  }

  private path(index: number): string {
    return join(this.directory, index === 0 ? "sidecar.log" : `sidecar.log.${index}`);
  }

  write(event: keyof typeof messages): void {
    const active = this.path(0);
    const line = `${new Date().toISOString()} ${messages[event]}\n`;
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const size = statSync(active, { throwIfNoEntry: false })?.size ?? 0;
      if (size + Buffer.byteLength(line) > fileSizeLimit) {
        for (let index = fileCount - 1; index > 0; index--) {
          try {
            renameSync(this.path(index - 1), this.path(index));
          } catch (error) {
            if (!missing(error)) throw error;
          }
        }
      }
      appendFileSync(active, line, { encoding: "utf8", mode: 0o600 });
    } catch {
      // An unwritable diagnostics directory must not take down the sidecar.
    }
  }

  tail(limit: number): string[] {
    const lines: string[] = [];
    for (let index = 0; index < fileCount && lines.length < limit; index++) {
      try {
        const content = readFileSync(this.path(index), "utf8").trimEnd();
        if (content) lines.unshift(...content.split("\n").slice(-(limit - lines.length)));
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return lines;
  }
}
