import { DARK_KITCHEN_LABEL } from "./types.js";
import type { GitHubIssue, IssueGraph } from "./types.js";

export function buildIssueGraph(issues: GitHubIssue[]): IssueGraph {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const closedNotPlanned = [];
  for (const issue of issues) {
    for (const dependency of issue.blockedBy) {
      const blocker = byNumber.get(dependency.number);
      if (blocker && isClosed(blocker) && !blocker.labels.includes(DARK_KITCHEN_LABEL.auto)) {
        closedNotPlanned.push({
          issueNumber: issue.number,
          dependencyNumber: blocker.number,
          message: `#${issue.number} depends on closed #${blocker.number}, which was not marked dark-kitchen:auto`,
        });
      }
    }
  }
  return { issues, byNumber, cycles: detectCycles(issues, byNumber), closedNotPlanned };
}

export function computeReadyIssues(
  graph: IssueGraph,
  activeIssues = new Set<number>(),
): GitHubIssue[] {
  if (graph.cycles.length > 0) return [];
  return graph.issues.filter((issue) => {
    if (!isOpen(issue) || !issue.labels.includes(DARK_KITCHEN_LABEL.auto)) return false;
    if (activeIssues.has(issue.number) || issue.labels.includes(DARK_KITCHEN_LABEL.needsHuman) || issue.labels.includes(DARK_KITCHEN_LABEL.failed)) return false;
    return issue.blockedBy.every((dependency) => {
      const blocker = graph.byNumber.get(dependency.number);
      return Boolean(blocker && isClosed(blocker));
    });
  });
}

export function computeBlockedIssues(graph: IssueGraph, activeIssues = new Set<number>()): GitHubIssue[] {
  const ready = new Set(computeReadyIssues(graph, activeIssues).map((issue) => issue.number));
  return graph.issues.filter((issue) =>
    isOpen(issue) &&
    issue.labels.includes(DARK_KITCHEN_LABEL.auto) &&
    !issue.labels.includes(DARK_KITCHEN_LABEL.needsHuman) &&
    !issue.labels.includes(DARK_KITCHEN_LABEL.failed) &&
    !activeIssues.has(issue.number) &&
    !ready.has(issue.number),
  );
}

export function isOpen(issue: GitHubIssue): boolean {
  return issue.state.toUpperCase() === "OPEN";
}

export function isClosed(issue: GitHubIssue): boolean {
  return issue.state.toUpperCase() === "CLOSED";
}

function detectCycles(issues: GitHubIssue[], byNumber: Map<number, GitHubIssue>): number[][] {
  const state = new Map<number, 0 | 1 | 2>();
  const cycles: number[][] = [];
  const stack: number[] = [];
  const visit = (number: number) => {
    const current = state.get(number) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      const index = stack.indexOf(number);
      cycles.push([...stack.slice(index), number]);
      return;
    }
    state.set(number, 1);
    stack.push(number);
    for (const dependency of byNumber.get(number)?.blockedBy ?? []) {
      if (byNumber.has(dependency.number)) visit(dependency.number);
    }
    stack.pop();
    state.set(number, 2);
  };
  for (const issue of issues) visit(issue.number);
  return dedupeCycles(cycles);
}

function dedupeCycles(cycles: number[][]): number[][] {
  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    const body = cycle.slice(0, -1);
    const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)].join(","));
    const key = rotations.sort()[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
