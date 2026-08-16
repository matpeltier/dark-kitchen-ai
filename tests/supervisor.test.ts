import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { RuntimeStore } from "../src/runtime-store.js";
import { Supervisor, type GitHubPort, type OrcaPort, type SupervisorDependencies } from "../src/supervisor.js";
import type { CommandResult, GitHubIssue, OrcaRepo, OrcaWorktree, PullRequest, RuntimeRecord } from "../src/types.js";
import { writeJson } from "../src/utils.js";

function makeIssue(number: number, blockedBy: number[] = []): GitHubIssue {
  return { number, title: `Issue ${number}`, body: "Implement it", state: "OPEN", labels: ["dark-kitchen:auto"], blockedBy: blockedBy.map((value) => ({ number: value })), blocking: [] };
}

async function fixture(initialIssues: GitHubIssue[], options: { maxParallelIssues?: number; retries?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "factory-test-"));
  const issues = initialIssues.map((item) => ({ ...item, labels: [...item.labels], blockedBy: [...item.blockedBy] }));
  const events: string[] = [];
  const github = {
    listIssues: async () => issues.map((item) => ({ ...item, labels: [...item.labels] })),
    viewIssue: async (number: number) => issues.find((item) => item.number === number)!,
    addLabel: async (number: number, label: string) => { issues.find((item) => item.number === number)!.labels.push(label); },
    removeLabel: async (number: number, label: string) => { issues.find((item) => item.number === number)!.labels = issues.find((item) => item.number === number)!.labels.filter((item) => item !== label); },
    editLabels: async (number: number, add: string[], remove: string[]) => {
      const issue = issues.find((item) => item.number === number)!;
      issue.labels = [...new Set([...issue.labels.filter((label) => !remove.includes(label)), ...add])];
      events.push(`labels:${number}:${add.join(",")}:${remove.join(",")}`);
    },
    comment: async (number: number, body: string) => events.push(`comment:${number}:${body.split("\n")[0]}`),
    closeIssue: async (number: number) => { issues.find((item) => item.number === number)!.state = "CLOSED"; },
    createPullRequest: async () => ({ number: 10, url: "https://github.com/test/test/pull/10" }),
    waitForChecks: async () => ({ passed: true, noChecks: true, output: "no checks" }),
    mergePullRequest: async () => { events.push("merge"); },
    issueIsClosed: async (number: number) => issues.find((item) => item.number === number)!.state === "CLOSED",
  } satisfies GitHubPort;
  let terminalFinished = false;
  let terminalCount = 0;
  const orca = {
    ensureRepo: async (repoPath: string): Promise<OrcaRepo> => ({ id: "repo-1", path: repoPath }),
    createWorktree: async (_repo: OrcaRepo, name: string): Promise<OrcaWorktree> => ({ id: `repo-1::${root}/${name}`, path: root, branch: name }),
    createTerminal: async (): Promise<{ handle: string }> => ({ handle: `terminal-${++terminalCount}` }),
    terminalFinished: async () => terminalFinished,
    removeWorktree: async () => { events.push("remove-worktree"); },
  } satisfies OrcaPort;
  const command = async (_command: string, args: string[], _options?: { cwd?: string }): Promise<CommandResult> => {
    if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-list") return { code: 0, stdout: "1\n", stderr: "" };
    if (args[0] === "branch") return { code: 0, stdout: "issue-1\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const config = { ...defaultConfig(), maxParallelIssues: options.maxParallelIssues ?? 2, maxWorkflowRetries: options.retries ?? 0 };
  const store = new RuntimeStore(root);
  const deps: SupervisorDependencies = { github, orca, store, run: command, sleep: async () => undefined, notify: async (_title, message) => events.push(`notify:${message}`) };
  return { root, issues, events, github, orca, store, deps, config, setFinished: (value: boolean) => { terminalFinished = value; } };
}

describe("Dark Kitchen AI supervisor", () => {
  it("launches each ready issue once and respects max concurrency", async () => {
    const test = await fixture([makeIssue(1), makeIssue(2)], { maxParallelIssues: 1 });
    await new Supervisor(test.root, test.config, test.deps).run(true);
    expect(test.events.filter((event) => event.startsWith("labels:") && event.includes("dark-kitchen:running"))).toHaveLength(1);
    expect((await test.store.list()).filter((record) => record.status === "running")).toHaveLength(1);
  });

  it("escalates one issue without stopping an unrelated ready issue", async () => {
    const test = await fixture([makeIssue(1), makeIssue(2)]);
    const record: RuntimeRecord = { issueNumber: 1, issueTitle: "Issue 1", status: "running", attempt: 1, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), worktreeId: "repo-1::worktree-1", worktreePath: test.root, branch: "issue-1", terminalHandle: "terminal-1", resultPath: test.store.resultPath(1) };
    await test.store.save(record);
    await writeJson(test.store.resultPath(1), { status: "needs_human", category: "requirement_ambiguity", summary: "Two valid behaviors", question: "Which behavior?", recommendation: "Choose one", evidence: ["Issue text"] });
    test.setFinished(true);
    await new Supervisor(test.root, test.config, test.deps).run(true);
    expect(test.issues[0].labels).toContain("dark-kitchen:needs-human");
    expect(test.events.some((event) => event.startsWith("notify:"))).toBe(true);
    expect((await test.store.get(1))?.status).toBe("needs_human");
    expect((await test.store.list()).some((item) => item.issueNumber === 2 && item.status === "running")).toBe(true);
  });

  it("does not duplicate a still-running terminal after reconciliation", async () => {
    const test = await fixture([makeIssue(1)]);
    const record: RuntimeRecord = { issueNumber: 1, issueTitle: "Issue 1", status: "running", attempt: 1, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), worktreeId: "repo-1::worktree-1", worktreePath: test.root, branch: "issue-1", terminalHandle: "terminal-1", resultPath: test.store.resultPath(1) };
    await test.store.save(record);
    await new Supervisor(test.root, test.config, test.deps).run(true);
    expect((await test.store.get(1))?.attempt).toBe(1);
    expect(test.events.filter((event) => event.includes("dark-kitchen:running"))).toHaveLength(0);
  });
});
