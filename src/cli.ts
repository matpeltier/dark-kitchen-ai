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

const program = new Command();
program.name("factory").description("Keep a GitHub issue dependency graph moving through Orca and codex-dynamic-workflows").version("0.1.0");

program.command("create")
  .argument("<name>", "directory and GitHub repository name")
  .option("--public", "create a public repository")
  .option("--private", "create a private repository (default)")
  .option("--max-parallel <n>", "maximum concurrent issues")
  .option("--no-auto-merge", "leave passing PRs open")
  .action(async (name: string, options: { public?: boolean; private?: boolean; maxParallel?: string; autoMerge: boolean }) => {
    if (options.public && options.private) throw new Error("Choose only one of --public or --private");
    const interactive = input.isTTY ? createInterface({ input, output }) : undefined;
    const answer = async (question: string, fallback: string) => interactive ? (await interactive.question(`${question} [${fallback}] `)).trim() || fallback : fallback;
    const visibility = options.public ? "public" : options.private ? "private" : (await answer("GitHub visibility (private/public)", "private")).toLowerCase() === "public" ? "public" : "private";
    const maxParallel = Number(options.maxParallel || await answer("Maximum parallel issues", "3"));
    const autoMerge = options.autoMerge === false ? false : (await answer("Auto-merge passing PRs? (yes/no)", "yes")).toLowerCase() !== "no";
    interactive?.close();
    if (!Number.isInteger(maxParallel) || maxParallel < 1) throw new Error("Maximum parallel issues must be a positive integer");
    const result = await createProject(name, visibility, { maxParallelIssues: maxParallel, autoMerge });
    console.log(`Created ${result.root}`);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    await printDoctor(result.root);
  });

program.command("init")
  .description("Initialize an existing GitHub repository for Factory")
  .action(async () => {
    const root = await findRepoRoot(process.cwd());
    const result = await initializeRepository(root);
    console.log(`Initialized Factory in ${result.root}`);
    if (result.changed.length) console.log(`Created/updated: ${result.changed.join(", ")}`);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  });

program.command("doctor")
  .description("Check the exact local and repository prerequisites")
  .action(async () => {
    await printDoctor(process.cwd());
  });

program.command("status")
  .description("Show GitHub issues and local Factory runtime state")
  .option("--json", "print machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const root = await findRepoRoot(process.cwd());
    const dashboard = await buildDashboard(root);
    if (options.json) console.log(JSON.stringify(dashboard, null, 2));
    else process.stdout.write(renderDashboard(dashboard));
  });

program.command("run")
  .description("Run the foreground Factory supervisor")
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
    if (!issue.labels.includes("factory:auto")) throw new Error(`Issue #${issueNumber} is not marked factory:auto`);
    await supervisor.retry(issueNumber);
  });

async function printDoctor(cwd: string): Promise<void> {
  const result = await runDoctor(cwd);
  for (const check of result.checks) console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  if (!result.ok) process.exitCode = 1;
}

program.parseAsync().catch((error: unknown) => {
  console.error(`factory: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
