import { constants } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
type Decode<T> = (value: unknown, previous: T | undefined) => T;

function readRecords<T>(contents: string, path: string, label: string, decode: Decode<T>): T[] {
  const records: T[] = [];
  for (const [index, line] of contents.split("\n").slice(0, -1).entries()) {
    try {
      records.push(decode(JSON.parse(line), records.at(-1)));
    } catch (cause) {
      throw new Error(`Invalid ${label} in ${path} at line ${index + 1}`, { cause });
    }
  }
  return records;
}

/** One API process owns the file and publishes records after their append reaches disk. */
export class JsonlFile<T> {
  readonly records: readonly T[];
  private pending: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private writeError?: Error;

  private constructor(
    private readonly file: FileHandle,
    private readonly committed: T[],
    private bytesCommitted: number,
    private readonly decode: Decode<T>,
  ) {
    this.records = committed;
  }

  static async open<T>(path: string, label: string, decode: Decode<T>): Promise<JsonlFile<T>> {
    await mkdir(dirname(path), { recursive: true });
    // Windows append-only handles cannot truncate an interrupted last line.
    const file = await open(path, constants.O_CREAT | constants.O_RDWR, 0o600);
    try {
      const contents = await file.readFile();
      const bytesCommitted = contents.lastIndexOf(0x0a) + 1;
      const records = readRecords(contents.subarray(0, bytesCommitted).toString("utf8"), path, label, decode);
      if (bytesCommitted !== contents.length) {
        // A record is complete once its terminating newline has been written.
        await file.truncate(bytesCommitted);
        await file.sync();
      }
      return new JsonlFile(file, records, bytesCommitted, decode);
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
    this.closing ??= this.pending.then(() => this.file.close());
    return this.closing;
  }

  private async write(create: (previous: T | undefined) => T): Promise<T> {
    if (this.writeError) throw this.writeError;
    const previous = this.committed.at(-1);
    const json = JSON.stringify(create(previous));
    const stored = this.decode(JSON.parse(json), previous);
    const line = Buffer.from(`${json}\n`);

    try {
      let offset = 0;
      while (offset < line.length) {
        const { bytesWritten } = await this.file.write(line, offset, line.length - offset, this.bytesCommitted + offset);
        if (bytesWritten === 0) throw new Error("Could not append a JSONL record");
        offset += bytesWritten;
      }
      await this.file.sync();
    } catch (error) {
      try {
        await this.file.truncate(this.bytesCommitted);
        await this.file.sync();
      } catch (cause) {
        this.writeError = new Error("Could not recover the JSONL file after an append failed", { cause });
        throw this.writeError;
      }
      throw error;
    }

    this.bytesCommitted += line.length;
    this.committed.push(stored);
    return stored;
  }
}
