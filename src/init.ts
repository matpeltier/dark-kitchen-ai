import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { runCommand } from "./command.js";
import { GitHubClient, type GitHubRepository } from "./github.js";
import { defaultConfig } from "./config.js";
import { FACTORY_AGENTS_SECTION, PROVIDER_CONFIG_TEMPLATE, configTemplate } from "./templates.js";
import { ensureDir, fileExists } from "./utils.js";
import type { CommandRunner, FactoryConfig } from "./types.js";

export type InitGitHubPort = {
  repository(): Promise<GitHubRepository>;
  ensureLabels(): Promise<void>;
};

export type InitOptions = {
  config?: Partial<FactoryConfig>;
  commit?: boolean;
  registerOrca?: boolean;
  run?: CommandRunner;
  github?: InitGitHubPort;
};

export async function findRepoRoot(cwd: string): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.code !== 0) throw new Error("Current directory is not inside a Git repository. Run factory create or cd into a Git repository.");
  return result.stdout.trim();
}

export async function initializeRepository(root: string, options: InitOptions = {}): Promise<{ root: string; changed: string[]; warnings: string[] }> {
  const command = options.run ?? runCommand;
  const github = options.github ?? new GitHubClient(command);
  const repository = await github.repository();
  const config = mergeConfig(defaultConfig(), options.config, repository.defaultBranch);
  const changed: string[] = [];
  const warnings: string[] = [];

  await ensureDir(path.join(root, ".factory", "workflows"));
  const files: Array<[string, string]> = [
    [".factory/config.json", configTemplate(config)],
    [".factory/codex-workflow.config.ts", PROVIDER_CONFIG_TEMPLATE],
    [".factory/result.schema.json", await readTemplate("result.schema.json")],
    [".factory/workflows/issue.ts", await readTemplate("issue-workflow.ts")],
  ];
  for (const [relative, content] of files) {
    const target = path.join(root, relative);
    if (!(await fileExists(target))) {
      await writeFile(target, content, "utf8");
      changed.push(relative);
    }
  }

  const agentsPath = path.join(root, "AGENTS.md");
  const agentsBefore = await fileOrEmpty(agentsPath);
  const agentsAfter = mergeAgents(agentsBefore);
  if (agentsAfter !== agentsBefore) {
    await writeFile(agentsPath, agentsAfter, "utf8");
    changed.push("AGENTS.md");
  }

  const gitignorePath = path.join(root, ".gitignore");
  const gitignoreBefore = await fileOrEmpty(gitignorePath);
  const gitignoreAfter = addGitignore(gitignoreBefore);
  if (gitignoreAfter !== gitignoreBefore) {
    await writeFile(gitignorePath, gitignoreAfter, "utf8");
    changed.push(".gitignore");
  }

  await github.ensureLabels();
  if (options.registerOrca !== false) {
    const orcaCommand = config.orcaCommand;
    const orcaResult = await command(orcaCommand, ["repo", "add", "--path", root, "--json"]);
    if (orcaResult.code !== 0 && !/already|exists|registered/i.test(`${orcaResult.stdout}\n${orcaResult.stderr}`)) {
      warnings.push(`Orca registration failed: ${orcaResult.stderr.trim() || orcaResult.stdout.trim()}`);
    }
  }

  if (options.commit !== false && changed.length > 0) {
    const addResult = await command("git", ["add", "--", ...changed], { cwd: root });
    if (addResult.code !== 0) throw new Error(`git add failed: ${addResult.stderr || addResult.stdout}`);
    const commitResult = await command("git", ["commit", "-m", "chore: initialize Factory"], { cwd: root });
    if (commitResult.code !== 0) warnings.push(`Initialization files were created but not committed: ${commitResult.stderr.trim() || commitResult.stdout.trim()}`);
  }
  return { root, changed, warnings };
}

export async function createProject(
  target: string,
  visibility: "private" | "public",
  configOverrides: Partial<FactoryConfig>,
): Promise<{ root: string; warnings: string[] }> {
  const absolute = path.resolve(target);
  try {
    const entries = await readdir(absolute);
    if (entries.length >= 0) throw new Error(`Directory ${absolute} already exists. Use factory init there; Factory will not overwrite it.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(absolute, { recursive: true });
  let result = await runCommand("git", ["init", "-b", "main"], { cwd: absolute });
  if (result.code !== 0) throw new Error(`git init failed: ${result.stderr || result.stdout}`);
  const repoName = path.basename(absolute);
  result = await runCommand("gh", ["repo", "create", repoName, `--${visibility}`, "--source", absolute, "--remote", "origin"], { cwd: absolute });
  if (result.code !== 0) throw new Error(`gh repo create failed: ${result.stderr || result.stdout}`);
  const initialized = await initializeRepository(absolute, { config: configOverrides, commit: true });
  result = await runCommand("git", ["push", "-u", "origin", "main"], { cwd: absolute });
  if (result.code !== 0) throw new Error(`Initial push failed: ${result.stderr || result.stdout}`);
  return { root: absolute, warnings: initialized.warnings };
}

function mergeConfig(base: FactoryConfig, overrides: Partial<FactoryConfig> | undefined, defaultBranch: string): FactoryConfig {
  return {
    ...base,
    ...overrides,
    baseBranch: overrides?.baseBranch || defaultBranch || base.baseBranch,
    agents: { ...base.agents, ...(overrides?.agents || {}) },
    providers: { ...base.providers, ...(overrides?.providers || {}) },
  };
}

async function fileOrEmpty(filePath: string): Promise<string> {
  try { return await readFile(filePath, "utf8"); } catch { return ""; }
}

export function mergeAgents(existing: string): string {
  const start = "<!-- BEGIN FACTORY MANAGED SECTION -->";
  const end = "<!-- END FACTORY MANAGED SECTION -->";
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  if (startIndex >= 0 && endIndex >= startIndex) {
    return `${existing.slice(0, startIndex)}${FACTORY_AGENTS_SECTION}${existing.slice(endIndex + end.length)}`.replace(/\n{3,}/g, "\n\n");
  }
  return existing ? `${existing.trimEnd()}\n\n${FACTORY_AGENTS_SECTION}\n` : `${FACTORY_AGENTS_SECTION}\n`;
}

export function addGitignore(existing: string): string {
  const lines = existing.split(/\r?\n/).filter(Boolean);
  if (!lines.includes(".factory/runtime/")) lines.push(".factory/runtime/");
  return `${lines.join("\n")}\n`;
}

async function readTemplate(name: string): Promise<string> {
  return readFile(new URL(`../templates/${name}`, import.meta.url), "utf8");
}
