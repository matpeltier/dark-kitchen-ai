import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addGitignore, initializeRepository, mergeAgents } from "../src/init.js";

describe("initialization helpers", () => {
  it("preserves unrelated AGENTS instructions and replaces only the managed section", () => {
    const existing = "# User rules\nKeep this.\n\n<!-- BEGIN FACTORY MANAGED SECTION -->\nold\n<!-- END FACTORY MANAGED SECTION -->\n";
    const merged = mergeAgents(existing);
    expect(merged).toContain("Keep this.");
    expect(merged).toContain("GitHub Issues define the requirements");
    expect(merged).not.toContain("old");
  });

  it("updates gitignore idempotently", () => {
    const once = addGitignore("dist/\n");
    expect(once).toContain(".factory/runtime/");
    expect(addGitignore(once)).toBe(once);
  });

  it("generates the small project surface without overwriting existing files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "factory-init-test-"));
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(root, "AGENTS.md"), "User instruction\n"));
    const result = await initializeRepository(root, {
      commit: false,
      registerOrca: false,
      github: { repository: async () => ({ nameWithOwner: "test/repo", defaultBranch: "main" }), ensureLabels: async () => undefined },
      run: async () => ({ code: 0, stdout: "", stderr: "" }),
    });
    expect(result.changed).toContain(".factory/config.json");
    expect(await readFile(path.join(root, ".factory/workflows/issue.ts"), "utf8")).toContain("codex-dynamic-workflows");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("User instruction");
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain(".factory/runtime/");
  });
});
