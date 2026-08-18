#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { runDoctor } from "./doctor.js";
import { loadConfig } from "./config.js";
import { createProject, findRepoRoot, initializeRepository } from "./init.js";
import { buildDashboard, renderDashboard } from "./status.js";
import { defaultDependencies, Supervisor } from "./supervisor.js";
import { RuntimeStore } from "./runtime-store.js";
import { DARK_KITCHEN_LABEL } from "./types.js";
import { bundledSkillPath, installSkill } from "./skill.js";
import type { FactoryConfig } from "./types.js";

const program = new Command();
program.name("dark-kitchen-ai").alias("dka").description("Keep a GitHub issue dependency graph moving through Orca and Open Dynamic Workflow").version("0.3.1");

program.command("create")
  .argument("<name>", "directory and GitHub repository name")
  .option("--public", "create a public repository")
  .option("--private", "create a private repository (default)")
  .option("--max-parallel <n>", "maximum concurrent issues")
  .option("--no-auto-merge", "leave passing PRs open")
  .option("--orca-command <command>", "Orca command or runtime executable")
  .option("--orca-arg <arg>", "argument passed to Orca (repeatable)", collectOption, [])
  .action(async (name: string, options: { public?: boolean; private?: boolean; maxParallel?: string; autoMerge: boolean; orcaCommand?: string; orcaArg?: string[] }) => {
    if (options.public && options.private) throw new Error("Choose only one of --public or --private");
    const interactive = input.isTTY ? createInterface({ input, output }) : undefined;
    const answer = async (question: string, fallback: string) => interactive ? (await interactive.question(`${question} [${fallback}] `)).trim() || fallback : fallback;
    const visibility = options.public ? "public" : options.private ? "private" : (await answer("GitHub visibility (private/public)", "private")).toLowerCase() === "public" ? "public" : "private";
    const maxParallel = Number(options.maxParallel || await answer("Maximum parallel issues", "3"));
    const autoMerge = options.autoMerge === false ? false : (await answer("Auto-merge passing PRs? (yes/no)", "yes")).toLowerCase() !== "no";
    interactive?.close();
    if (!Number.isInteger(maxParallel) || maxParallel < 1) throw new Error("Maximum parallel issues must be a positive integer");
    const result = await createProject(name, visibility, {
      maxParallelIssues: maxParallel,
      autoMerge,
      ...(orcaOverrides(options) ?? {}),
    });
    console.log(`Created ${result.root}`);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    await printDoctor(result.root);
  });

program.command("init")
  .description("Initialize an existing GitHub repository for Dark Kitchen AI")
  .option("--orca-command <command>", "Orca command or runtime executable")
  .option("--orca-arg <arg>", "argument passed to Orca (repeatable)", collectOption, [])
  .action(async (options: { orcaCommand?: string; orcaArg?: string[] }) => {
    const root = await findRepoRoot(process.cwd());
    const result = await initializeRepository(root, { config: orcaOverrides(options) });
    console.log(`Initialized Dark Kitchen AI in ${result.root}`);
    if (result.changed.length) console.log(`Created/updated: ${result.changed.join(", ")}`);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  });

program.command("doctor")
  .description("Check the exact local and repository prerequisites")
  .action(async () => {
    await printDoctor(process.cwd());
  });

program.command("status")
  .description("Show GitHub issues and local Dark Kitchen AI runtime state")
  .option("--json", "print machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const root = await findRepoRoot(process.cwd());
    const dashboard = await buildDashboard(root);
    if (options.json) console.log(JSON.stringify(dashboard, null, 2));
    else process.stdout.write(renderDashboard(dashboard));
  });

program.command("run")
  .description("Run the foreground Dark Kitchen AI supervisor")
  .option("--once", "process one supervisor tick and exit")
  .action(async (options: { once?: boolean }) => {
    const root = await findRepoRoot(process.cwd());
    const config = await loadConfig(root);
    const dependencies = defaultDependencies(root, config);
    const supervisor = new Supervisor(root, config, dependencies);
    const stopHandler = () => {
      void dependencies.store.requestStop();
      console.log("\nStop requested; existing workers will continue unless their terminal exits.");
    };
    process.once("SIGINT", stopHandler);
    process.once("SIGTERM", stopHandler);
    await supervisor.run(Boolean(options.once));
  });

program.command("stop")
  .description("Ask the foreground supervisor to stop after the current tick")
  .action(async () => {
    const root = await findRepoRoot(process.cwd());
    const store = new RuntimeStore(root);
    await store.requestStop();
    console.log("Stop requested. Existing workers were not killed.");
  });

program.command("retry")
  .description("Retry a failed or human-blocked issue in its preserved worktree")
  .argument("<number>", "issue number")
  .action(async (numberText: string) => {
    const root = await findRepoRoot(process.cwd());
    const config = await loadConfig(root);
    const issueNumber = Number(numberText);
    if (!Number.isInteger(issueNumber) || issueNumber < 1) throw new Error("Issue number must be a positive integer");
    const dependencies = defaultDependencies(root, config);
    const supervisor = new Supervisor(root, config, dependencies);
    const issue = await dependencies.github.viewIssue(issueNumber);
    if (!issue.labels.includes(DARK_KITCHEN_LABEL.auto)) throw new Error(`Issue #${issueNumber} is not marked ${DARK_KITCHEN_LABEL.auto}`);
    await supervisor.retry(issueNumber);
  });

const skill = program.command("skill").description("Install the Dark Kitchen Issues skill for OpenCode planning");
skill.command("path")
  .description("Print the bundled skill directory")
  .action(() => console.log(bundledSkillPath()));
skill.command("install")
  .argument("[destination]", "destination directory (default: ./skills/dark-kitchen-issues)")
  .option("--global", "install into ~/.config/opencode/skills/dark-kitchen-issues")
  .option("--force", "replace an existing destination")
  .action(async (destination: string | undefined, options: { global?: boolean; force?: boolean }) => {
    const target = await installSkill(destination, options);
    console.log(`Installed Dark Kitchen Issues skill at ${target}`);
  });

async function printDoctor(cwd: string): Promise<void> {
  const result = await runDoctor(cwd);
  for (const check of result.checks) console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  if (!result.ok) process.exitCode = 1;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function orcaOverrides(options: { orcaCommand?: string; orcaArg?: string[] }): Partial<FactoryConfig> | undefined {
  const args = options.orcaArg ?? [];
  if (!options.orcaCommand && args.length > 0) throw new Error("--orca-command is required when using --orca-arg");
  if (!options.orcaCommand) return undefined;
  return { orca: { command: options.orcaCommand, args } };
}

program.parseAsync().catch((error: unknown) => {
  console.error(`dark-kitchen-ai: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
