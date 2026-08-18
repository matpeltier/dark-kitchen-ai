import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { RuntimeStore } from "../src/runtime-store.js";
import { Supervisor, type GitHubPort, type OrcaPort, type SupervisorDependencies } from "../src/supervisor.js";
import type { CommandResult, GitHubIssue, OrcaRepo, OrcaWorktree, PullRequest, RuntimeRecord } from "../src/types.js";
import { readJson, writeJson } from "../src/utils.js";

function makeIssue(number: number, blockedBy: number[] = []): GitHubIssue {
  return { number, title: `Issue ${number}`, body: "Implement it", state: "OPEN", labels: ["dark-kitchen:auto"], blockedBy: blockedBy.map((value) => ({ number: value })), blocking: [] };
}

async function fixture(initialIssues: GitHubIssue[], options: { maxParallelIssues?: number; pollIntervalSeconds?: number } = {}) {
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
  let worktreeCount = 0;
  const terminalCommands: string[] = [];
  const orca = {
    ensureRepo: async (repoPath: string): Promise<OrcaRepo> => ({ id: "repo-1", path: repoPath }),
    createWorktree: async (_repo: OrcaRepo, name: string): Promise<OrcaWorktree> => {
      worktreeCount += 1;
      return { id: `repo-1::${root}/${name}`, path: root, branch: name };
    },
    createTerminal: async (_worktreeId: string, _title: string, command: string): Promise<{ handle: string }> => {
      terminalCommands.push(command);
      return { handle: `terminal-${++terminalCount}` };
    },
    terminalFinished: async () => terminalFinished,
    removeWorktree: async () => { events.push("remove-worktree"); },
  } satisfies OrcaPort;
  const command = async (_command: string, args: string[], _options?: { cwd?: string }): Promise<CommandResult> => {
    if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-list") return { code: 0, stdout: "1\n", stderr: "" };
    if (args[0] === "branch") return { code: 0, stdout: "issue-1\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const config = { ...defaultConfig(), maxParallelIssues: options.maxParallelIssues ?? 2, pollIntervalSeconds: options.pollIntervalSeconds ?? 15 };
  const store = new RuntimeStore(root);
  const deps: SupervisorDependencies = { github, orca, store, run: command, sleep: async () => undefined, notify: async (_title, message) => events.push(`notify:${message}`) };
  return { root, issues, events, github, orca, store, deps, config, terminalCommands, getWorktreeCount: () => worktreeCount, setFinished: (value: boolean) => { terminalFinished = value; } };
}

describe("Dark Kitchen AI supervisor", () => {
  it("launches each ready issue once and respects max concurrency", async () => {
    const test = await fixture([makeIssue(1), makeIssue(2)], { maxParallelIssues: 1 });
    await new Supervisor(test.root, test.config, test.deps).run(true);
    expect(test.events.filter((event) => event.startsWith("labels:") && event.includes("dark-kitchen:running"))).toHaveLength(1);
    expect((await test.store.list()).filter((record) => record.status === "running")).toHaveLength(1);
  });

  it("persists the exact workflow input before launching the terminal", async () => {
    const issue = makeIssue(1);
    issue.title = "Quotes and shell syntax";
    issue.body = "line 1\n' \" ` $(echo unsafe) ; && café 🚀";
    issue.labels = ["dark-kitchen:auto", "priority:high"];
    issue.blockedBy = [{ number: 7, title: "Dependency", state: "CLOSED", url: "https://github.com/test/test/issues/7" }];
    const dependency = makeIssue(7);
    dependency.state = "CLOSED";
    dependency.labels = [];
    const test = await fixture([issue, dependency]);

    await new Supervisor(test.root, test.config, test.deps).run(true);

    expect(await readJson(test.store.inputPath(1))).toEqual({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      blockedBy: issue.blockedBy,
      resultPath: test.store.resultPath(1),
    });
    expect(test.terminalCommands).toHaveLength(1);
  });

  it("keeps a huge and shell-sensitive issue body out of the Orca command", async () => {
    const body = [
      "start",
      "' \" ` $(echo should-not-run) ; && café 🚀",
      "large markdown ".repeat(Math.ceil(100 * 1024 / 15)),
    ].join("\n");
    const issue = makeIssue(1);
    issue.title = "Title ' \" ` $(must-not-be-interpolated)";
    issue.body = body;
    issue.labels = ["dark-kitchen:auto", "label with $(syntax)", "étiquette"];
    const test = await fixture([issue]);

    await new Supervisor(test.root, test.config, test.deps).run(true);

    const command = test.terminalCommands[0];
    expect(command).toBeDefined();
    expect(command.length).toBeLessThan(2_000);
    expect(command).not.toContain(body);
    expect(command).not.toContain("should-not-run");
    expect(command).not.toContain(issue.title);
    for (const label of issue.labels) expect(command).not.toContain(label);
    expect(command).toContain("--arg");
    expect(command).toContain("inputPath=");
    expect(body.length).toBeGreaterThanOrEqual(100 * 1024);
    expect((await readJson<{ body: string }>(test.store.inputPath(1))).body).toBe(body);
  });

  it("rewrites the input artifact from the latest issue contents on retry", async () => {
    const issue = makeIssue(1);
    const test = await fixture([issue]);
    const supervisor = new Supervisor(test.root, test.config, test.deps);

    await supervisor.run(true);
    expect((await readJson<{ body: string }>(test.store.inputPath(1))).body).toBe("Implement it");

    const record = await test.store.get(1);
    expect(record).toBeDefined();
    await test.store.save({ ...record!, status: "failed" });
    test.issues[0].body = "latest requirements\nwith 'quotes' and $(syntax)";
    test.issues[0].labels = ["dark-kitchen:auto", "dark-kitchen:failed"];

    await supervisor.retry(1);

    expect((await readJson<{ body: string }>(test.store.inputPath(1))).body).toBe(test.issues[0].body);
    expect(test.terminalCommands).toHaveLength(2);
    expect(test.terminalCommands[1]).not.toContain(test.issues[0].body);
  });

  it("retries technical workflow failures indefinitely on the same worktree", async () => {
    const test = await fixture([makeIssue(1)], { pollIntervalSeconds: 0 });
    const supervisor = new Supervisor(test.root, test.config, test.deps);

    await supervisor.run(true);
    test.setFinished(true);
    for (let failure = 0; failure < 3; failure += 1) {
      await writeJson(test.store.resultPath(1), { status: "failed", summary: `engineering failure ${failure}`, attempts: [`failure ${failure}`] });
      await supervisor.tick();
      expect((await test.store.get(1))?.status).toBe("failed");
      await supervisor.tick();
      expect((await test.store.get(1))?.status).toBe("running");
    }

    expect((await test.store.get(1))?.attempt).toBe(4);
    expect(test.getWorktreeCount()).toBe(1);
    expect(test.events.some((event) => event.startsWith("notify:"))).toBe(false);
  });

  it("reconciles a stale running record with a finished failed result", async () => {
    const test = await fixture([makeIssue(1)], { pollIntervalSeconds: 0 });
    const record: RuntimeRecord = { issueNumber: 1, issueTitle: "Issue 1", status: "running", attempt: 2, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), worktreeId: "repo-1::worktree-1", worktreePath: test.root, branch: "issue-1", terminalHandle: "terminal-1", resultPath: test.store.resultPath(1) };
    await test.store.save(record);
    await writeJson(test.store.resultPath(1), { status: "failed", summary: "stale worker failure", attempts: ["worker exited"] });
    test.setFinished(true);

    const supervisor = new Supervisor(test.root, test.config, test.deps);
    await supervisor.tick();
    expect((await test.store.get(1))?.status).toBe("failed");
    expect(test.issues[0].labels).not.toContain("dark-kitchen:running");
    await supervisor.tick();
    expect((await test.store.get(1))?.status).toBe("running");
    expect((await test.store.get(1))?.attempt).toBe(3);
    expect(test.getWorktreeCount()).toBe(0);
  });

  it("recovers a running record with no live terminal or result", async () => {
    const test = await fixture([makeIssue(1)], { pollIntervalSeconds: 0 });
    const record: RuntimeRecord = { issueNumber: 1, issueTitle: "Issue 1", status: "running", attempt: 1, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), worktreeId: "repo-1::worktree-1", worktreePath: test.root, branch: "issue-1", terminalHandle: "terminal-1", resultPath: test.store.resultPath(1) };
    await test.store.save(record);
    test.setFinished(true);

    const supervisor = new Supervisor(test.root, test.config, test.deps);
    await supervisor.tick();
    expect((await test.store.get(1))?.status).toBe("failed");
    await supervisor.tick();
    expect((await test.store.get(1))?.status).toBe("running");
    expect((await test.store.get(1))?.attempt).toBe(2);
  });

  it("does not launch a scheduled retry after an explicit stop request", async () => {
    const test = await fixture([makeIssue(1)], { pollIntervalSeconds: 0 });
    const supervisor = new Supervisor(test.root, test.config, test.deps);
    await supervisor.run(true);
    test.setFinished(true);
    await writeJson(test.store.resultPath(1), { status: "failed", summary: "test failure", attempts: ["test failure"] });
    await supervisor.tick();
    await test.store.requestStop();
    await supervisor.tick();
    expect((await test.store.get(1))?.status).toBe("failed");
    expect(test.terminalCommands).toHaveLength(1);
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
