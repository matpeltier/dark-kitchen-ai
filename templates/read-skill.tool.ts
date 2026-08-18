import path from "node:path";
import { readFile } from "node:fs/promises";

export default defineTool({
  id: "read-skill",
  description: "Load a validated project-local skill for a workflow role.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  async run(input: { name: string }) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(input.name) || input.name.includes("..")) return null;
    const candidates = [
      path.join(process.cwd(), ".factory", "skills", input.name, "SKILL.md"),
      path.join(process.cwd(), "skills", input.name, "SKILL.md"),
      path.join(process.cwd(), ".opencode", "skills", input.name, "SKILL.md"),
      path.join(process.cwd(), ".agents", "skills", input.name, "SKILL.md"),
      path.join(process.cwd(), ".codex", "skills", input.name, "SKILL.md"),
    ];
    for (const candidate of candidates) {
      try {
        return await readFile(candidate, "utf8");
      } catch {
        // Try the next project-local skill directory.
      }
    }
    return null;
  },
});
