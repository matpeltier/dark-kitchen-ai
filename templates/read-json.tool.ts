import { readFile } from "node:fs/promises";

export default defineTool({
  id: "read-json",
  description: "Read a trusted local JSON artifact for the current workflow.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
  async run(input: { path: string }) {
    return JSON.parse(await readFile(input.path, "utf8"));
  },
});
