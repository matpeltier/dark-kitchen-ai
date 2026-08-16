import { describe, expect, it } from "vitest";
import { buildIssueGraph, computeReadyIssues } from "../src/graph.js";
import type { GitHubIssue } from "../src/types.js";

function issue(number: number, state: "OPEN" | "CLOSED" = "OPEN", labels = ["dark-kitchen:auto"], blockedBy: number[] = []): GitHubIssue {
  return { number, title: `Issue ${number}`, body: "", state, labels, blockedBy: blockedBy.map((value) => ({ number: value })), blocking: [] };
}

describe("GitHub issue graph", () => {
  it("marks an issue with no dependencies ready", () => {
    const graph = buildIssueGraph([issue(1)]);
    expect(computeReadyIssues(graph).map((item) => item.number)).toEqual([1]);
  });

  it("waits for open blockers and becomes ready after a blocker closes", () => {
    const blocked = buildIssueGraph([issue(1), issue(2, "OPEN", ["dark-kitchen:auto"], [1])]);
    expect(computeReadyIssues(blocked).map((item) => item.number)).toEqual([1]);
    const ready = buildIssueGraph([issue(1, "CLOSED"), issue(2, "OPEN", ["dark-kitchen:auto"], [1])]);
    expect(computeReadyIssues(ready).map((item) => item.number)).toEqual([2]);
  });

  it("requires all blockers, excludes human/non-auto issues, and detects cycles", () => {
    const graph = buildIssueGraph([
      issue(1, "OPEN", ["dark-kitchen:auto"], [2]),
      issue(2, "OPEN", ["dark-kitchen:auto"], [1]),
      issue(3, "OPEN", ["dark-kitchen:needs-human", "dark-kitchen:auto"]),
      issue(4, "OPEN", []),
    ]);
    expect(graph.cycles).toEqual([[1, 2, 1]]);
    expect(computeReadyIssues(graph)).toEqual([]);
  });

  it("surfaces a closed dependency that was not Dark Kitchen-managed", () => {
    const graph = buildIssueGraph([issue(1, "CLOSED", []), issue(2, "OPEN", ["dark-kitchen:auto"], [1])]);
    expect(computeReadyIssues(graph).map((item) => item.number)).toEqual([2]);
    expect(graph.closedNotPlanned[0].message).toContain("closed #1");
  });

  it("does not automatically relaunch a failed issue", () => {
    const graph = buildIssueGraph([issue(1, "OPEN", ["dark-kitchen:auto", "dark-kitchen:failed"])]);
    expect(computeReadyIssues(graph)).toEqual([]);
  });
});
