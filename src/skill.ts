import os from "node:os";
import path from "node:path";
import { access, cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const bundledSkill = fileURLToPath(new URL("../skills/dark-kitchen-issues", import.meta.url));

export type InstallSkillOptions = {
  global?: boolean;
  force?: boolean;
};

export function bundledSkillPath(): string {
  return bundledSkill;
}

export async function installSkill(destination: string | undefined, options: InstallSkillOptions = {}): Promise<string> {
  if (destination && options.global) throw new Error("Choose either a destination or --global, not both.");
  const target = options.global
    ? path.join(os.homedir(), ".config", "opencode", "skills", "dark-kitchen-issues")
    : path.resolve(destination || path.join("skills", "dark-kitchen-issues"));
  if (!options.force && await exists(target)) {
    throw new Error(`${target} already exists. Choose another destination or use --force to replace it.`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await cp(bundledSkill, target, { recursive: true, force: true });
  return target;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
