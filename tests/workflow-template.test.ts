import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("generated issue workflow persistence", () => {
  it("keeps engineering exhaustion as failed and performs a final review", async () => {
    const source = await readFile(path.join(process.cwd(), "templates", "issue-workflow.ts"), "utf8");
    expect(source).not.toContain("repeated_failure");
    expect(source).toContain("const maxFixLoops = 2");
    expect(source).toContain("if (reviewPass >= maxFixLoops)");
    expect(source).toContain("final independent review");
    expect(source).toContain('status: "failed"');
    expect(source).toContain("Resolve every blocking finding at its root cause");
    expect(source).toContain("Continue in the existing preserved task worktree");
    expect(source).toContain("Read the complete issue input JSON");
    expect(source).toContain("return result.json");
    expect(source).not.toContain("Original issue and acceptance criteria:\n${issue.body}");
  });
});
