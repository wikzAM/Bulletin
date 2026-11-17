import { constants } from "node:fs";
import { mkdir, open, readdir, type FileHandle } from "node:fs/promises";
import { basename, dirname } from "node:path";

const DEFAULT_SEGMENT_BYTES = 16 * 1024 * 1024;
type Decode<T> = (value: unknown, previous: T | undefined) => T;

function readRecords<T>(contents: string, path: string, label: string, decode: Decode<T>, records: T[]): void {
  for (const [index, line] of contents.split("\n").slice(0, -1).entries()) {
    try {
      records.push(decode(JSON.parse(line), records.at(-1)));
    } catch (cause) {
      throw new Error(`Invalid ${label} in ${path} at line ${index + 1}`, { cause });
    }
  }
}

function segmentPath(path: string, index: number): string {
  return index === 0 ? path : `${path}.${index}`;
}

async function restoreSegment<T>(
  file: FileHandle, path: string, label: string, decode: Decode<T>, records: T[], archived: boolean,
): Promise<number> {
  const contents = await file.readFile();
  const bytesCommitted = contents.lastIndexOf(0x0a) + 1;
  const hasIncompleteRecord = bytesCommitted !== contents.length;
  if (archived && hasIncompleteRecord) throw new Error(`Incomplete record in archived JSONL segment ${path}`);

  readRecords(contents.subarray(0, bytesCommitted).toString("utf8"), path, label, decode, records);
  if (hasIncompleteRecord) {
    // A record is complete once its terminating newline has been written.
    await file.truncate(bytesCommitted);
    await file.sync();
  }
  return bytesCommitted;
}

interface ActiveSegment {
  file: FileHandle;
  index: number;
  bytesCommitted: number;
}

/** One API process owns the file and publishes records after their append reaches disk. */
export class JsonlFile<T> {
  readonly records: readonly T[];
  private pending: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private writeError?: Error;

  private constructor(
    private readonly path: string,
    private active: ActiveSegment,
    private readonly committed: T[],
    private readonly decode: Decode<T>,
    private readonly segmentBytes: number,
  ) {
    this.records = committed;
  }

  static async open<T>(path: string, label: string, decode: Decode<T>, segmentBytes = DEFAULT_SEGMENT_BYTES): Promise<JsonlFile<T>> {
    if (!Number.isSafeInteger(segmentBytes) || segmentBytes < 1) throw new Error("JSONL segment size must be a positive integer");
    const directory = dirname(path);
    await mkdir(directory, { recursive: true });
    const prefix = `${basename(path)}.`;
    const segments = (await readdir(directory)).filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length)).filter((suffix) => /^[1-9]\d*$/.test(suffix))
      .map(Number).sort((a, b) => a - b);
    if (segments.some((index, position) => index !== position + 1)) throw new Error(`Missing JSONL segment for ${path}`);

    const records: T[] = [];
    for (let index = 0; index < segments.length; index++) {
      const archivedPath = segmentPath(path, index);
      const archived = await open(archivedPath, "r");
      try {
        await restoreSegment(archived, archivedPath, label, decode, records, true);
      } finally {
        await archived.close();
      }
    }

    const activePath = segmentPath(path, segments.length);
    const flags = segments.length === 0 ? constants.O_CREAT | constants.O_RDWR : constants.O_RDWR;
    // Windows append-only handles cannot truncate an interrupted last line.
    const file = await open(activePath, flags, 0o600);
    try {
      const bytesCommitted = await restoreSegment(file, activePath, label, decode, records, false);
      return new JsonlFile(path, { file, index: segments.length, bytesCommitted }, records, decode, segmentBytes);
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  async append(create: (previous: T | undefined) => T): Promise<T> {
    if (this.closing) throw new Error("JSONL file is closed");
    const append = this.pending.then(() => this.write(create));
    this.pending = append.then(() => undefined, () => undefined);
    return append;
  }

  close(): Promise<void> {
    this.closing ??= this.pending.then(() => this.active.file.close());
    return this.closing;
  }

  private async write(create: (previous: T | undefined) => T): Promise<T> {
    if (this.writeError) throw this.writeError;
    const previous = this.committed.at(-1);
    const json = JSON.stringify(create(previous));
    const stored = this.decode(JSON.parse(json), previous);
    const line = Buffer.from(`${json}\n`);
    if (this.active.bytesCommitted > 0 && this.active.bytesCommitted + line.length > this.segmentBytes) {
      const index = this.active.index + 1;
      const file = await open(segmentPath(this.path, index), "wx+", 0o600);
      const archived = this.active.file;
      this.active = { file, index, bytesCommitted: 0 };
      await archived.close();
    }

    const segment = this.active;
    try {
      let offset = 0;
      while (offset < line.length) {
        const { bytesWritten } = await segment.file.write(line, offset, line.length - offset, segment.bytesCommitted + offset);
        if (bytesWritten === 0) throw new Error("Could not append a JSONL record");
        offset += bytesWritten;
      }
      await segment.file.sync();
    } catch (error) {
      try {
        await segment.file.truncate(segment.bytesCommitted);
        await segment.file.sync();
      } catch (cause) {
        this.writeError = new Error("Could not recover the JSONL file after an append failed", { cause });
        throw this.writeError;
      }
      throw error;
    }

    segment.bytesCommitted += line.length;
    this.committed.push(stored);
    return stored;
  }
}
