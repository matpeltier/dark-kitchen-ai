import type { CommandRunner, CommandSpec, OrcaRepo, OrcaWorktree } from "./types.js";
import { commandFailure } from "./command.js";
import { parseJsonOutput } from "./utils.js";

export class OrcaClient {
  constructor(
    private readonly spec: CommandSpec,
    private readonly run: CommandRunner,
  ) {}

  async invoke(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return this.run(this.spec.command, [...this.spec.args, ...args]);
  }

  async status(): Promise<unknown> {
    const result = await this.invoke(["status", "--json"]);
    if (result.code !== 0) throw commandFailure(result);
    return parseJsonOutput(result.stdout, "orca status");
  }

  async listRepos(): Promise<OrcaRepo[]> {
    const result = await this.invoke(["repo", "list", "--json"]);
    if (result.code !== 0) throw commandFailure(result);
    const raw = unwrapOrcaResult(parseJsonOutput<unknown>(result.stdout, "orca repo list"));
    const rows = Array.isArray(raw) ? raw : ((raw as { repos?: unknown[] }).repos ?? []);
    return rows.map((item) => {
      const value = item as Record<string, unknown>;
      return { id: String(value.id ?? value.repoId ?? ""), path: typeof value.path === "string" ? value.path : undefined, name: typeof value.name === "string" ? value.name : undefined };
    }).filter((repo) => repo.id);
  }

  async ensureRepo(repoPath: string): Promise<OrcaRepo> {
    const existing = (await this.listRepos()).find((repo) => repo.path === repoPath);
    if (existing) return existing;
    const result = await this.invoke(["repo", "add", "--path", repoPath, "--json"]);
    if (result.code !== 0) throw commandFailure(result);
    const raw = unwrapOrcaResult(parseJsonOutput<Record<string, unknown>>(result.stdout, "orca repo add"));
    const value = (raw.repo ?? raw) as Record<string, unknown>;
    const repo = { id: String(value.id ?? value.repoId ?? ""), path: repoPath, name: typeof value.name === "string" ? value.name : undefined };
    if (!repo.id) throw new Error("orca repo add returned no repository id");
    return repo;
  }

  async createWorktree(repo: OrcaRepo, name: string): Promise<OrcaWorktree> {
    const result = await this.invoke(["worktree", "create", "--repo", `id:${repo.id}`, "--name", name, "--no-parent", "--json"]);
    if (result.code !== 0) throw commandFailure(result);
    const raw = unwrapOrcaResult(parseJsonOutput<Record<string, unknown>>(result.stdout, "orca worktree create"));
    const value = (raw.worktree ?? raw) as Record<string, unknown>;
    const worktree = {
      id: String(value.id ?? ""),
      path: String(value.path ?? value.worktreePath ?? ""),
      branch: typeof value.branch === "string" ? value.branch : undefined,
      startupTerminal: typeof value.startupTerminal === "object" && value.startupTerminal !== null
        ? { handle: typeof (value.startupTerminal as Record<string, unknown>).handle === "string" ? (value.startupTerminal as Record<string, unknown>).handle as string : undefined }
        : undefined,
    };
    if (!worktree.id || !worktree.path) throw new Error("orca worktree create returned no full id/path");
    return worktree;
  }

  async createTerminal(worktreeId: string, title: string, command: string): Promise<{ handle: string }> {
    const result = await this.invoke(["terminal", "create", "--worktree", `id:${worktreeId}`, "--title", title, "--command", command, "--json"]);
    if (result.code !== 0) throw commandFailure(result);
    const raw = unwrapOrcaResult(parseJsonOutput<Record<string, unknown>>(result.stdout, "orca terminal create"));
    const terminal = raw.terminal as Record<string, unknown> | undefined;
    const handle = String(raw.handle ?? terminal?.handle ?? raw.terminalHandle ?? "");
    if (!handle) throw new Error("orca terminal create returned no terminal handle");
    return { handle };
  }

  async terminalFinished(handle: string): Promise<boolean> {
    const result = await this.invoke(["terminal", "wait", "--terminal", handle, "--for", "exit", "--timeout-ms", "1000", "--json"]);
    if (result.code === 0) return true;
    const output = `${result.stdout}\n${result.stderr}`;
    if (/timeout|timed out|still running|pending/i.test(output)) return false;
    return true;
  }

  async removeWorktree(worktreeId: string): Promise<void> {
    const result = await this.invoke(["worktree", "rm", "--worktree", `id:${worktreeId}`, "--force", "--json"]);
    if (result.code !== 0) throw commandFailure(result);
  }
}

function unwrapOrcaResult<T>(value: T): T {
  if (typeof value === "object" && value !== null && "result" in value) {
    return (value as { result: T }).result;
  }
  return value;
}
