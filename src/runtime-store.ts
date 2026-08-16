import path from "node:path";
import { open, readdir, unlink } from "node:fs/promises";
import { ensureDir, fileExists, readJson, writeJson } from "./utils.js";
import type { RuntimeRecord, WorkerResult } from "./types.js";
import { RUNTIME_DIR } from "./config.js";
import { WorkerResultSchema } from "./types.js";

export class RuntimeStore {
  readonly root: string;
  readonly runtime: string;

  constructor(repoRoot: string) {
    this.root = repoRoot;
    this.runtime = path.join(repoRoot, RUNTIME_DIR);
  }

  async initialize(): Promise<void> {
    await ensureDir(this.runtime);
  }

  issueDir(issueNumber: number): string {
    return path.join(this.runtime, String(issueNumber));
  }

  recordPath(issueNumber: number): string {
    return path.join(this.issueDir(issueNumber), "run.json");
  }

  resultPath(issueNumber: number): string {
    return path.join(this.issueDir(issueNumber), "result.json");
  }

  async save(record: RuntimeRecord): Promise<void> {
    await writeJson(this.recordPath(record.issueNumber), record);
  }

  async get(issueNumber: number): Promise<RuntimeRecord | undefined> {
    const filePath = this.recordPath(issueNumber);
    if (!(await fileExists(filePath))) return undefined;
    return readJson<RuntimeRecord>(filePath);
  }

  async list(): Promise<RuntimeRecord[]> {
    await this.initialize();
    const entries = await readdir(this.runtime, { withFileTypes: true });
    const records: RuntimeRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(this.runtime, entry.name, "run.json");
      if (await fileExists(filePath)) {
        try { records.push(await readJson<RuntimeRecord>(filePath)); } catch { /* ignore partial writes */ }
      }
    }
    return records.sort((a, b) => a.issueNumber - b.issueNumber);
  }

  async readResult(issueNumber: number): Promise<WorkerResult | undefined> {
    const filePath = this.resultPath(issueNumber);
    if (!(await fileExists(filePath))) return undefined;
    try {
      return WorkerResultSchema.parse(await readJson<unknown>(filePath));
    } catch (error) {
      throw new Error(`Invalid worker result for #${issueNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async clearResult(issueNumber: number): Promise<void> {
    try { await unlink(this.resultPath(issueNumber)); } catch { /* absent is fine */ }
  }

  async acquireLock(): Promise<() => Promise<void>> {
    await this.initialize();
    const lockPath = path.join(this.runtime, "supervisor.lock");
    let handle;
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      await handle.close();
    } catch (error) {
      throw new Error(`Another factory supervisor may already be running (${lockPath}): ${error instanceof Error ? error.message : String(error)}`);
    }
    return async () => { try { await unlink(lockPath); } catch { /* already released */ } };
  }

  stopPath(): string {
    return path.join(this.runtime, "stop");
  }

  async requestStop(): Promise<void> {
    await ensureDir(this.runtime);
    await writeJson(this.stopPath(), { requestedAt: new Date().toISOString() });
  }

  async clearStop(): Promise<void> {
    try { await unlink(this.stopPath()); } catch { /* absent is fine */ }
  }

  async stopRequested(): Promise<boolean> {
    return fileExists(this.stopPath());
  }
}
