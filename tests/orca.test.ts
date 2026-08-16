import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../src/command.js";
import { OrcaClient } from "../src/orca.js";

describe("Orca command specs", () => {
  it("invokes a runtime command with exact argument order", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dark-kitchen-orca-"));
    try {
      const script = path.join(root, "fake-orca.js");
      await writeFile(script, "console.log(JSON.stringify(process.argv.slice(2)))\n", "utf8");
      const client = new OrcaClient({ command: "node", args: [script] }, runCommand);
      const result = await client.invoke(["status", "--json"]);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(["status", "--json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not interpret command arguments through a shell", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const client = new OrcaClient({ command: "node", args: ["fake-orca.js"] }, async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: "", stderr: "" };
    });
    await client.invoke(["status", "$(echo unsafe)", "--json"]);
    expect(calls).toEqual([{ command: "node", args: ["fake-orca.js", "status", "$(echo unsafe)", "--json"] }]);
  });

  it("propagates a failed status command", async () => {
    const client = new OrcaClient({ command: "node", args: ["-e", "process.exit(7)"] }, runCommand);
    await expect(client.status()).rejects.toThrow(/command exited with 7/);
  });
});
