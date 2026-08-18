import path from "node:path";
import { commandFailure, runCommand } from "./command.js";
import { buildIssueGraph, computeReadyIssues, isOpen } from "./graph.js";
import { GitHubClient } from "./github.js";
import { notify } from "./notifications.js";
import { OrcaClient } from "./orca.js";
import { RuntimeStore } from "./runtime-store.js";
import { shellQuote, slugify } from "./utils.js";
import { DARK_KITCHEN_LABEL } from "./types.js";
import type { CommandRunner, FactoryConfig, GitHubIssue, OrcaWorktree, RuntimeRecord, WorkerResult, WorkflowInput } from "./types.js";

export type GitHubPort = Pick<GitHubClient, "listIssues" | "viewIssue" | "addLabel" | "removeLabel" | "editLabels" | "comment" | "closeIssue" | "createPullRequest" | "waitForChecks" | "mergePullRequest" | "issueIsClosed">;
export type OrcaPort = Pick<OrcaClient, "ensureRepo" | "createWorktree" | "createTerminal" | "terminalFinished" | "removeWorktree">;

export type SupervisorDependencies = {
  github: GitHubPort;
  orca: OrcaPort;
  store: RuntimeStore;
  run: CommandRunner;
  sleep?: (milliseconds: number) => Promise<void>;
  notify?: (title: string, message: string) => Promise<void>;
};

export function defaultDependencies(root: string, config: FactoryConfig): SupervisorDependencies {
  return {
    github: new GitHubClient(runCommand),
    orca: new OrcaClient(config.orca, runCommand),
    store: new RuntimeStore(root),
    run: runCommand,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    notify,
  };
}

export class Supervisor {
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly notify: (title: string, message: string) => Promise<void>;

  constructor(
    private readonly root: string,
    private readonly config: FactoryConfig,
    private readonly deps: SupervisorDependencies,
  ) {
    this.sleep = deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.notify = deps.notify ?? (async () => undefined);
  }

  async run(once = false): Promise<void> {
    const release = await this.deps.store.acquireLock();
    await this.deps.store.clearStop();
    try {
      do {
        await this.tick();
        if (once || await this.deps.store.stopRequested()) break;
        await this.sleep(this.config.pollIntervalSeconds * 1000);
      } while (true);
    } finally {
      await release();
    }
  }

  async retry(issueNumber: number): Promise<void> {
    const release = await this.deps.store.acquireLock();
    try {
      const issue = await this.deps.github.viewIssue(issueNumber);
      const records = await this.deps.store.list();
      const record = records.find((item) => item.issueNumber === issueNumber);
      if (issue.labels.includes(DARK_KITCHEN_LABEL.running) || record?.status === "running" || record?.status === "pr_open") {
        throw new Error(`Issue #${issueNumber} already has an active Dark Kitchen AI run`);
      }
      await this.deps.github.editLabels(issueNumber, [], [DARK_KITCHEN_LABEL.failed, DARK_KITCHEN_LABEL.needsHuman]);
      await this.startIssue(issue, record);
    } finally {
      await release();
    }
  }

  async tick(): Promise<void> {
    const issues = await this.deps.github.listIssues();
    const graph = buildIssueGraph(issues);
    if (graph.cycles.length > 0) {
      throw new Error(`Refusing to run cyclic GitHub dependency graph: ${graph.cycles.map((cycle) => cycle.map((number) => `#${number}`).join(" -> ")).join("; ")}`);
    }

    const records = await this.deps.store.list();
    await this.processPendingTransitions(records);
    await this.processScheduledRetries(records);
    for (const record of records.filter((item) => item.status === "running")) {
      await this.processFinishedRun(record);
    }
    if (await this.deps.store.stopRequested()) return;

    const refreshedIssues = await this.deps.github.listIssues();
    const refreshedGraph = buildIssueGraph(refreshedIssues);
    const currentRecords = await this.deps.store.list();
    const active = new Set([
      ...currentRecords.filter((record) => record.status === "running" || record.status === "pr_open").map((record) => record.issueNumber),
      ...refreshedIssues.filter((issue) => issue.labels.includes(DARK_KITCHEN_LABEL.running)).map((issue) => issue.number),
    ]);
    const activeCount = new Set([
      ...currentRecords.filter((record) => record.status === "running").map((record) => record.issueNumber),
      ...refreshedIssues.filter((issue) => issue.labels.includes(DARK_KITCHEN_LABEL.running)).map((issue) => issue.number),
    ]).size;
    const available = Math.max(0, this.config.maxParallelIssues - activeCount);
    const ready = computeReadyIssues(refreshedGraph, active).slice(0, available);
    for (const issue of ready) await this.startIssue(issue, currentRecords.find((record) => record.issueNumber === issue.number));
  }

  private async startIssue(issue: GitHubIssue, existing?: RuntimeRecord): Promise<void> {
    await this.deps.github.editLabels(issue.number, [DARK_KITCHEN_LABEL.running], [DARK_KITCHEN_LABEL.failed]);
    let worktree: OrcaWorktree | undefined;
    let branch = existing?.branch || "";
    let terminalHandle: string | undefined;
    try {
      if (existing?.worktreeId && existing.worktreePath) {
        worktree = { id: existing.worktreeId, path: existing.worktreePath, branch: existing.branch };
        await this.prepareRetry(worktree.path);
      } else {
        const repo = await this.deps.orca.ensureRepo(this.root);
        worktree = await this.deps.orca.createWorktree(repo, `issue-${issue.number}-${slugify(issue.title)}`);
      }
      if (!branch) branch = worktree.branch || await this.gitBranch(worktree.path);
      await this.deps.store.clearResult(issue.number);
      const input = this.workflowInput(issue);
      await this.deps.store.writeInput(issue.number, input);
      const terminal = await this.deps.orca.createTerminal(worktree.id, `Dark Kitchen AI #${issue.number}`, this.workflowCommand(input, worktree.path));
      terminalHandle = terminal.handle;
      const now = new Date().toISOString();
      const record: RuntimeRecord = {
        issueNumber: issue.number,
        issueTitle: issue.title,
        status: "running",
        attempt: (existing?.attempt ?? 0) + 1,
        startedAt: now,
        updatedAt: now,
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        branch,
        terminalHandle,
        resultPath: this.deps.store.resultPath(issue.number),
        attempts: existing?.attempts ?? [],
        nextRetryAt: undefined,
      };
      await this.deps.store.save(record);
    } catch (error) {
      const message = `Could not start Orca/workflow: ${errorMessage(error)}`;
      const now = new Date().toISOString();
      const failedRecord: RuntimeRecord = {
        issueNumber: issue.number,
        issueTitle: issue.title,
        status: "failed",
        attempt: (existing?.attempt ?? 0) + 1,
        startedAt: existing?.startedAt ?? now,
        updatedAt: now,
        worktreeId: worktree?.id ?? existing?.worktreeId ?? "",
        worktreePath: worktree?.path ?? existing?.worktreePath ?? this.root,
        branch: branch || worktree?.branch || "",
        terminalHandle,
        resultPath: this.deps.store.resultPath(issue.number),
        attempts: [...(existing?.attempts ?? []), message],
      };
      await this.handleFailureRecord(issue, failedRecord, message);
    }
  }

  private workflowInput(issue: GitHubIssue): WorkflowInput {
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      blockedBy: issue.blockedBy,
      resultPath: this.deps.store.resultPath(issue.number),
    };
  }

  private workflowCommand(input: WorkflowInput, worktreePath: string): string {
    const inputPath = path.resolve(this.deps.store.inputPath(input.number));
    const configPath = path.resolve(this.root, ".factory", "config.json");
    const workflowFile = path.resolve(worktreePath, this.config.workflowFile);
    const workflowConfig = path.resolve(worktreePath, this.config.workflowConfig);
    return [
      this.config.workflowCommand,
      "run", shellQuote(workflowFile),
      "--config", shellQuote(workflowConfig),
      "--cwd", shellQuote(worktreePath),
      "--arg", shellQuote(`inputPath=${inputPath}`),
      "--arg", shellQuote(`configPath=${configPath}`),
      "--report", "json",
    ].join(" ") + "; exit $?";
  }

  private async processFinishedRun(record: RuntimeRecord): Promise<void> {
    if (record.terminalHandle) {
      try {
        if (!(await this.deps.orca.terminalFinished(record.terminalHandle))) return;
      } catch {
        // An unavailable terminal is treated as finished so a stale run can recover.
      }
    }
    let result: WorkerResult | undefined;
    try { result = await this.deps.store.readResult(record.issueNumber); } catch (error) {
      await this.handleFailure(record, errorMessage(error));
      return;
    }
    if (!result) {
      await this.handleFailure(record, "Workflow terminal exited without .factory/runtime/result.json");
      return;
    }
    if (result.status === "success") await this.completeSuccess(record, result);
    else if (result.status === "needs_human") await this.humanBlocker(record, result);
    else await this.handleFailure(record, result.summary);
  }

  private async completeSuccess(record: RuntimeRecord, result: Extract<WorkerResult, { status: "success" }>): Promise<void> {
    const issue = await this.deps.github.viewIssue(record.issueNumber);
    let merged = false;
    let mergedPullRequest: { number: number; url: string } | undefined;
    try {
      await this.verifyWorktree(record);
      const push = await this.deps.run("git", ["push", "--set-upstream", "origin", record.branch], { cwd: record.worktreePath });
      if (push.code !== 0) throw commandFailure(push);
      const pullRequest = await this.deps.github.createPullRequest(
        record.branch,
        this.config.baseBranch,
        `[Dark Kitchen AI] #${issue.number} ${issue.title}`,
        `## Summary\n${result.summary}\n\n## Tests\n${result.tests.map((test) => `- ${test}`).join("\n")}\n\n## Review\n${result.reviewSummary}\n\nCloses #${issue.number}`,
      );
      mergedPullRequest = pullRequest;
      const checks = await this.deps.github.waitForChecks(pullRequest.number, this.config.checkTimeoutSeconds * 1000);
      if (!checks.passed) throw new Error(`PR checks failed or timed out: ${checks.output}`);
      const checkSummary = checks.noChecks ? "No GitHub checks configured; local workflow tests were the available gate." : "GitHub checks passed.";
      if (!this.config.autoMerge) {
        await this.saveRecord({ ...record, status: "pr_open", pullRequestNumber: pullRequest.number, pullRequestUrl: pullRequest.url, checkSummary, updatedAt: new Date().toISOString() });
        await this.deps.github.removeLabel(issue.number, DARK_KITCHEN_LABEL.running);
        return;
      }
      await this.deps.github.mergePullRequest(pullRequest.number);
      merged = true;
      if (!(await this.deps.github.issueIsClosed(issue.number))) await this.deps.github.closeIssue(issue.number);
      if (!(await this.deps.github.issueIsClosed(issue.number))) throw new Error(`Issue #${issue.number} did not close after merging PR #${pullRequest.number}`);
      await this.deps.github.editLabels(issue.number, [], [DARK_KITCHEN_LABEL.running, DARK_KITCHEN_LABEL.failed, DARK_KITCHEN_LABEL.needsHuman]);
      const completedRecord: RuntimeRecord = { ...record, status: "completed", pullRequestNumber: pullRequest.number, pullRequestUrl: pullRequest.url, checkSummary, updatedAt: new Date().toISOString(), nextRetryAt: undefined, transitionPending: undefined };
      await this.saveRecord(completedRecord);
      await this.removeWorktreeBestEffort(completedRecord);
    } catch (error) {
      if (merged && mergedPullRequest) {
        await this.saveRecord({
          ...record,
          status: "pr_open",
          pullRequestNumber: mergedPullRequest.number,
          pullRequestUrl: mergedPullRequest.url,
          lastError: `PR merged; final issue transition will be retried: ${errorMessage(error)}`,
          updatedAt: new Date().toISOString(),
          transitionPending: true,
        });
        await this.deps.github.removeLabel(issue.number, DARK_KITCHEN_LABEL.running);
      }
      else await this.handleFailure(record, errorMessage(error));
    }
  }

  private async humanBlocker(record: RuntimeRecord, result: Extract<WorkerResult, { status: "needs_human" }>): Promise<void> {
    const body = [
      "## Dark Kitchen AI needs human input",
      "",
      `**Category:** ${result.category}`,
      "",
      "**Problem**",
      result.summary,
      "",
      "**Question**",
      result.question,
      "",
      "**Recommendation**",
      result.recommendation || "No recommendation provided.",
      "",
      "**Evidence**",
      ...(result.evidence?.map((item) => `- ${item}`) || ["- The preserved Orca worktree contains the current work."]),
    ].join("\n");
    await this.deps.github.editLabels(record.issueNumber, [DARK_KITCHEN_LABEL.needsHuman], [DARK_KITCHEN_LABEL.running]);
    await this.deps.github.comment(record.issueNumber, body);
    await this.saveRecord({ ...record, status: "needs_human", updatedAt: new Date().toISOString(), lastError: result.summary, nextRetryAt: undefined });
    await this.notify("Dark Kitchen AI needs human input", `Issue #${record.issueNumber}: ${result.question}`);
  }

  private async handleFailure(record: RuntimeRecord, message: string): Promise<void> {
    const issue = await this.deps.github.viewIssue(record.issueNumber);
    const attempts = [...(record.attempts ?? []), message];
    await this.handleFailureRecord(issue, { ...record, status: "failed", attempts }, message);
  }

  private async handleFailureRecord(issue: GitHubIssue, record: RuntimeRecord, message: string): Promise<void> {
    const nextRetryAt = new Date(Date.now() + this.retryDelayMs(record.attempt)).toISOString();
    await this.deps.github.editLabels(issue.number, [DARK_KITCHEN_LABEL.failed], [DARK_KITCHEN_LABEL.running]);
    await this.saveRecord({
      ...record,
      status: "failed",
      attempts: record.attempts ?? [],
      updatedAt: new Date().toISOString(),
      lastError: message,
      nextRetryAt,
    });
  }

  private async processScheduledRetries(records: RuntimeRecord[]): Promise<void> {
    if (await this.deps.store.stopRequested()) return;
    const now = Date.now();
    for (const record of records.filter((item) => item.status === "failed" && (!item.nextRetryAt || Date.parse(item.nextRetryAt) <= now))) {
      if (await this.deps.store.stopRequested()) return;
      const issue = await this.deps.github.viewIssue(record.issueNumber);
      if (!isOpen(issue) || !issue.labels.includes(DARK_KITCHEN_LABEL.auto) || issue.labels.includes(DARK_KITCHEN_LABEL.needsHuman)) continue;
      await this.startIssue(issue, record);
    }
  }

  private async processPendingTransitions(records: RuntimeRecord[]): Promise<void> {
    for (const record of records.filter((item) => item.status === "pr_open" && item.transitionPending && item.pullRequestNumber)) {
      const issue = await this.deps.github.viewIssue(record.issueNumber);
      try {
        if (!(await this.deps.github.issueIsClosed(issue.number))) await this.deps.github.closeIssue(issue.number);
        if (!(await this.deps.github.issueIsClosed(issue.number))) throw new Error(`Issue #${issue.number} did not close after merged PR #${record.pullRequestNumber}`);
        await this.deps.github.editLabels(issue.number, [], [DARK_KITCHEN_LABEL.running, DARK_KITCHEN_LABEL.failed, DARK_KITCHEN_LABEL.needsHuman]);
        const completedRecord: RuntimeRecord = { ...record, status: "completed", updatedAt: new Date().toISOString(), lastError: undefined, transitionPending: undefined };
        await this.saveRecord(completedRecord);
        await this.removeWorktreeBestEffort(completedRecord);
      } catch (error) {
        await this.saveRecord({ ...record, updatedAt: new Date().toISOString(), lastError: `PR merged; final issue transition will be retried: ${errorMessage(error)}` });
      }
    }
  }

  private retryDelayMs(attempt: number): number {
    const multiplier = Math.min(16, Math.max(1, attempt));
    return Math.min(300_000, this.config.pollIntervalSeconds * 1_000 * multiplier);
  }

  private async verifyWorktree(record: RuntimeRecord): Promise<void> {
    const status = await this.deps.run("git", ["status", "--porcelain"], { cwd: record.worktreePath });
    if (status.code !== 0) throw commandFailure(status);
    if (status.stdout.trim()) throw new Error("Worker reported success but left uncommitted changes in the worktree");
    const commits = await this.deps.run("git", ["rev-list", "--count", `origin/${this.config.baseBranch}..HEAD`], { cwd: record.worktreePath });
    if (commits.code === 0 && Number(commits.stdout.trim()) < 1) throw new Error("Worker reported success but the branch has no committed changes beyond the base branch");
  }

  private async prepareRetry(worktreePath: string): Promise<void> {
    const status = await this.deps.run("git", ["status", "--porcelain"], { cwd: worktreePath });
    if (status.code !== 0 || status.stdout.trim()) return;
    const fetch = await this.deps.run("git", ["fetch", "origin", this.config.baseBranch], { cwd: worktreePath });
    if (fetch.code !== 0) return;
    const rebase = await this.deps.run("git", ["rebase", `origin/${this.config.baseBranch}`], { cwd: worktreePath });
    if (rebase.code !== 0) await this.deps.run("git", ["rebase", "--abort"], { cwd: worktreePath });
  }

  private async gitBranch(worktreePath: string): Promise<string> {
    const result = await this.deps.run("git", ["branch", "--show-current"], { cwd: worktreePath });
    if (result.code !== 0 || !result.stdout.trim()) throw new Error(`Could not determine branch: ${result.stderr || result.stdout}`);
    return result.stdout.trim();
  }

  private async removeWorktreeBestEffort(record: RuntimeRecord): Promise<void> {
    try { await this.deps.orca.removeWorktree(record.worktreeId); } catch (error) {
      await this.saveRecord({ ...record, lastError: `Merged, but Orca worktree cleanup failed: ${errorMessage(error)}` });
    }
  }

  private async saveRecord(record: RuntimeRecord): Promise<void> {
    await this.deps.store.save(record);
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
