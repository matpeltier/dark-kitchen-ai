import type { CommandRunner, GitHubIssue, IssueDependency, PullRequest } from "./types.js";
import { commandFailure } from "./command.js";
import { parseJsonOutput } from "./utils.js";

export type GitHubRepository = {
  nameWithOwner: string;
  defaultBranch: string;
};

type GhLabel = { name?: string };

export class GitHubClient {
  private resolvedRepo?: string;

  constructor(
    private readonly run: CommandRunner,
    private readonly repo?: string,
  ) {}

  private args(args: string[]): string[] {
    const repo = this.repo || this.resolvedRepo;
    return repo ? [...args, "--repo", repo] : args;
  }

  async repository(): Promise<GitHubRepository> {
    const repositoryArgs = [
      "repo",
      "view",
      ...(this.repo ? [this.repo] : []),
      "--json",
      "nameWithOwner,defaultBranchRef",
    ];
    const result = await this.run("gh", repositoryArgs);
    if (result.code !== 0) throw commandFailure(result);
    const data = parseJsonOutput<{ nameWithOwner: string; defaultBranchRef?: { name?: string } | null }>(result.stdout, "gh repo view");
    this.resolvedRepo = data.nameWithOwner;
    return { nameWithOwner: data.nameWithOwner, defaultBranch: data.defaultBranchRef?.name || "main" };
  }

  async authStatus(): Promise<{ ok: boolean; output: string }> {
    const result = await this.run("gh", ["auth", "status"]);
    return { ok: result.code === 0, output: result.stderr || result.stdout };
  }

  async listIssues(): Promise<GitHubIssue[]> {
    await this.repository();
    const result = await this.run("gh", this.args([
      "issue", "list", "--state", "all", "--limit", "1000",
      "--json", "number,title,body,state,labels,url,closedAt",
    ]));
    if (result.code !== 0) throw commandFailure(result);
    const rows = parseJsonOutput<Array<Record<string, unknown>>>(result.stdout, "gh issue list");
    const issues: GitHubIssue[] = [];
    for (const row of rows) {
      const issue = await this.viewIssue(Number(row.number));
      issues.push(issue);
    }
    return issues;
  }

  async viewIssue(number: number): Promise<GitHubIssue> {
    await this.ensureRepositoryName();
    const result = await this.run("gh", this.args([
      "issue", "view", String(number),
      "--json", "number,title,body,state,labels,url,closedAt",
    ]));
    if (result.code !== 0) throw commandFailure(result);
    const raw = parseJsonOutput<Record<string, unknown>>(result.stdout, `gh issue view #${number}`);
    const [blockedBy, blocking] = await Promise.all([
      this.listDependencyEndpoint(number, "blocked_by"),
      this.listDependencyEndpoint(number, "blocking"),
    ]);
    return { ...normalizeIssue(raw, number), blockedBy, blocking };
  }

  private async ensureRepositoryName(): Promise<string> {
    if (this.repo) return this.repo;
    if (this.resolvedRepo) return this.resolvedRepo;
    return (await this.repository()).nameWithOwner;
  }

  private async listDependencyEndpoint(number: number, endpoint: "blocked_by" | "blocking"): Promise<IssueDependency[]> {
    const repo = await this.ensureRepositoryName();
    const result = await this.run("gh", ["api", `repos/${repo}/issues/${number}/dependencies/${endpoint}?per_page=100`]);
    if (result.code !== 0) throw commandFailure(result);
    return normalizeDependencies(parseJsonOutput<unknown>(result.stdout, `gh api issue ${endpoint}`));
  }

  async addLabel(number: number, label: string): Promise<void> {
    await this.editLabels(number, [label], []);
  }

  async removeLabel(number: number, label: string): Promise<void> {
    await this.editLabels(number, [], [label]);
  }

  async editLabels(number: number, add: string[], remove: string[]): Promise<void> {
    const args = ["issue", "edit", String(number)];
    for (const label of add) args.push("--add-label", label);
    for (const label of remove) args.push("--remove-label", label);
    if (add.length === 0 && remove.length === 0) return;
    const result = await this.run("gh", this.args(args));
    if (result.code !== 0) throw commandFailure(result);
  }

  async ensureLabels(): Promise<void> {
    const labels = [
      ["factory:auto", "3b82f6", "Factory may launch this issue"],
      ["factory:running", "f59e0b", "Factory is actively running this issue"],
      ["factory:needs-human", "ef4444", "Factory needs human input"],
      ["factory:failed", "991b1b", "Factory worker failed"],
    ];
    for (const [name, color, description] of labels) {
      const result = await this.run("gh", this.args(["label", "create", name, "--color", color, "--description", description, "--force"]));
      if (result.code !== 0) throw commandFailure(result);
    }
  }

  async comment(number: number, body: string): Promise<void> {
    const result = await this.run("gh", this.args(["issue", "comment", String(number), "--body", body]));
    if (result.code !== 0) throw commandFailure(result);
  }

  async closeIssue(number: number): Promise<void> {
    const result = await this.run("gh", this.args(["issue", "close", String(number), "--reason", "completed"]));
    if (result.code !== 0) throw commandFailure(result);
  }

  async findPullRequest(branch: string): Promise<PullRequest | undefined> {
    const result = await this.run("gh", this.args(["pr", "list", "--head", branch, "--state", "all", "--json", "number,url,state"]));
    if (result.code !== 0) throw commandFailure(result);
    const rows = parseJsonOutput<Array<{ number: number; url: string; state?: string }>>(result.stdout, "gh pr list");
    return rows[0];
  }

  async createPullRequest(branch: string, base: string, title: string, body: string): Promise<PullRequest> {
    const existing = await this.findPullRequest(branch);
    if (existing) return existing;
    const result = await this.run("gh", this.args([
      "pr", "create", "--head", branch, "--base", base, "--title", title, "--body", body,
    ]));
    if (result.code !== 0) throw commandFailure(result);
    const url = (result.stdout.trim().split(/\s+/).find((value) => value.startsWith("http")) || result.stdout.trim());
    const number = Number(url.match(/\/pull\/(\d+)/)?.[1] || 0);
    if (!number) {
      const created = await this.findPullRequest(branch);
      if (created) return created;
      throw new Error(`Could not determine pull request number from gh output: ${result.stdout}`);
    }
    return { number, url };
  }

  async waitForChecks(prNumber: number, timeoutMs: number): Promise<{ passed: boolean; noChecks: boolean; output: string }> {
    const result = await this.run("gh", this.args([
      "pr", "checks", String(prNumber), "--watch", "--fail-fast", "--interval", "10",
    ]), { timeoutMs });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const noChecks = /no checks|no check runs|no checks reported/i.test(output);
    return { passed: result.code === 0 || noChecks, noChecks, output };
  }

  async mergePullRequest(prNumber: number): Promise<void> {
    const result = await this.run("gh", this.args(["pr", "merge", String(prNumber), "--squash", "--delete-branch"]));
    if (result.code !== 0) throw commandFailure(result);
  }

  async issueIsClosed(number: number): Promise<boolean> {
    const issue = await this.viewIssue(number);
    return issue.state.toUpperCase() === "CLOSED";
  }
}

function normalizeIssue(raw: Record<string, unknown>, fallbackNumber: number): GitHubIssue {
  return {
    number: Number(raw.number ?? fallbackNumber),
    title: String(raw.title ?? `Issue #${fallbackNumber}`),
    body: String(raw.body ?? ""),
    state: String(raw.state ?? "OPEN").toUpperCase(),
    labels: Array.isArray(raw.labels)
      ? raw.labels.map((label) => typeof label === "string" ? label : String((label as GhLabel).name ?? "")).filter(Boolean)
      : [],
    blockedBy: normalizeDependencies(raw.blockedBy),
    blocking: normalizeDependencies(raw.blocking),
    url: typeof raw.url === "string" ? raw.url : undefined,
    closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
  };
}

function normalizeDependencies(value: unknown): IssueDependency[] {
  if (!Array.isArray(value)) return [];
  return value.map((dependency) => {
    if (typeof dependency === "number") return { number: dependency };
    const raw = dependency as Record<string, unknown>;
    return {
      number: Number(raw.number ?? raw.issueNumber ?? 0),
      title: typeof raw.title === "string" ? raw.title : undefined,
      state: typeof raw.state === "string" ? raw.state.toUpperCase() : undefined,
      url: typeof raw.url === "string" ? raw.url : undefined,
    };
  }).filter((dependency) => dependency.number > 0);
}
