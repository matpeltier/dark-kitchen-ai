import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkill } from "../src/skill.js";

describe("Dark Kitchen Issues skill", () => {
  it("installs the bundled skill into a destination", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dark-kitchen-skill-"));
    try {
      const destination = path.join(root, "skill");
      const installed = await installSkill(destination);
      expect(installed).toBe(destination);
      expect(await readFile(path.join(destination, "SKILL.md"), "utf8")).toContain("name: dark-kitchen-issues");
      expect(await readFile(path.join(destination, "agents", "openai.yaml"), "utf8")).toContain("$dark-kitchen-issues");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
