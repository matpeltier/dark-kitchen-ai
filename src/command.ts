import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./types.js";

export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

export async function commandAvailable(command: string): Promise<boolean> {
  const result = await runCommand("sh", ["-lc", `command -v ${shellEscape(command)}`]);
  return result.code === 0;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function commandFailure(result: CommandResult): Error {
  return new Error(result.stderr.trim() || result.stdout.trim() || `command exited with ${result.code}`);
}
