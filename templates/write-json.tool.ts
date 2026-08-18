import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export default defineTool({
  id: "write-json",
  description: "Persist the structured result consumed by the Dark Kitchen supervisor.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      value: {},
    },
    required: ["path", "value"],
    additionalProperties: false,
  },
  async run(input: { path: string; value: unknown }) {
    await mkdir(path.dirname(input.path), { recursive: true });
    await writeFile(input.path, `${JSON.stringify(input.value, null, 2)}\n`, "utf8");
    return { path: input.path };
  },
});
