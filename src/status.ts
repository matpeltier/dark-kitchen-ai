import { loadConfig } from "./config.js";
import { GitHubClient } from "./github.js";
import { computeBlockedIssues, computeReadyIssues, buildIssueGraph, isClosed, isOpen } from "./graph.js";
import { RuntimeStore } from "./runtime-store.js";
import { formatDuration } from "./utils.js";
import { formatRouting } from "./doctor.js";
import { runCommand } from "./command.js";
import { DARK_KITCHEN_LABEL } from "./types.js";
import type { GitHubIssue, RuntimeRecord } from "./types.js";

export type Dashboard = {
  project: string;
  routing: string[];
  running: Array<{ issue: GitHubIssue; runtime?: RuntimeRecord; duration?: string }>;
  ready: GitHubIssue[];
  blocked: GitHubIssue[];
  needsHuman: GitHubIssue[];
  failed: GitHubIssue[];
  done: GitHubIssue[];
  warnings: string[];
  cycles: number[][];
};

export async function buildDashboard(root: string): Promise<Dashboard> {
  const github = new GitHubClient(runCommand);
  const repo = await github.repository();
  const issues = await github.listIssues();
  const graph = buildIssueGraph(issues);
  const runtime = await new RuntimeStore(root).list();
  const byIssue = new Map(runtime.map((record) => [record.issueNumber, record]));
  const active = new Set([
    ...runtime.filter((record) => record.status === "running" || record.status === "pr_open").map((record) => record.issueNumber),
    ...issues.filter((issue) => issue.labels.includes(DARK_KITCHEN_LABEL.running)).map((issue) => issue.number),
  ]);
  const ready = computeReadyIssues(graph, active);
  const blocked = computeBlockedIssues(graph, active);
  const needsHuman = issues.filter((issue) => isOpen(issue) && issue.labels.includes(DARK_KITCHEN_LABEL.needsHuman));
  const failed = issues.filter((issue) => isOpen(issue) && issue.labels.includes(DARK_KITCHEN_LABEL.failed));
  const done = issues.filter(isClosed);
  const running = issues.filter((issue) => active.has(issue.number) || issue.labels.includes(DARK_KITCHEN_LABEL.running)).map((issue) => {
    const record = byIssue.get(issue.number);
    return { issue, runtime: record, duration: record ? formatDuration(record.startedAt) : undefined };
  });
  const warnings = graph.closedNotPlanned.map((warning) => warning.message);
  warnings.push(...runtime.filter((record) => record.checkSummary?.startsWith("No GitHub checks")).map((record) => `#${record.issueNumber}: ${record.checkSummary}`));
  if (graph.cycles.length) warnings.push(...graph.cycles.map((cycle) => `Dependency cycle detected: ${cycle.map((number) => `#${number}`).join(" -> ")}`));
  return {
    project: repo.nameWithOwner,
    routing: formatRouting(await loadConfig(root)).split("; "),
    running,
    ready,
    blocked,
    needsHuman,
    failed,
    done,
    warnings,
    cycles: graph.cycles,
  };
}

export function renderDashboard(dashboard: Dashboard): string {
  const lines = [`Project: ${dashboard.project}`, "", "AGENT PROFILE", ...dashboard.routing.map((line) => `  ${line}`), ""];
  addSection(lines, "RUNNING", dashboard.running.map(({ issue, duration }) => `#${issue.number} ${issue.title}${duration ? `       ${duration}` : ""}`));
  addSection(lines, "READY", dashboard.ready.map((issue) => `#${issue.number} ${issue.title}`));
  addSection(lines, "BLOCKED", dashboard.blocked.map((issue) => `#${issue.number} ${issue.title}       blocked by ${issue.blockedBy.map((dependency) => `#${dependency.number}`).join(", ") || "dependency state"}`));
  addSection(lines, "NEEDS HUMAN", dashboard.needsHuman.map((issue) => `#${issue.number} ${issue.title}`));
  addSection(lines, "FAILED", dashboard.failed.map((issue) => `#${issue.number} ${issue.title}`));
  addSection(lines, "DONE", dashboard.done.map((issue) => `#${issue.number} ${issue.title}`));
  if (dashboard.warnings.length) addSection(lines, "WARNINGS", dashboard.warnings);
  return `${lines.join("\n")}\n`;
}

function addSection(lines: string[], title: string, values: string[]): void {
  lines.push(title);
  lines.push(...(values.length ? values.map((value) => `  ${value}`) : ["  —"]));
  lines.push("");
}
