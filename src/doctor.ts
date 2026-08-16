import { commandAvailable, runCommand } from "./command.js";
import { loadConfig, providerNames, validateRoleProviders } from "./config.js";
import { GitHubClient } from "./github.js";
import { findRepoRoot } from "./init.js";
import { OrcaClient } from "./orca.js";
import type { FactoryConfig } from "./types.js";

export type DoctorCheck = { name: string; ok: boolean; detail: string };

export async function runDoctor(cwd: string): Promise<{ checks: DoctorCheck[]; ok: boolean }> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  add("git", await commandAvailable("git"), "required for worktrees and verification");
  add("gh", await commandAvailable("gh"), "required for GitHub source-of-truth operations");

  let root: string | undefined;
  try {
    root = await findRepoRoot(cwd);
    add("Git repository", true, root);
  } catch (error) {
    add("Git repository", false, errorMessage(error));
  }

  const github = new GitHubClient(runCommand);
  const auth = await github.authStatus();
  add("GitHub authentication", auth.ok, trimOutput(auth.output) || "gh auth status failed");
  let repoName: string | undefined;
  try {
    const repo = await github.repository();
    repoName = repo.nameWithOwner;
    add("GitHub remote", true, `${repo.nameWithOwner} (base ${repo.defaultBranch})`);
  } catch (error) {
    add("GitHub remote", false, errorMessage(error));
  }

  const help = await safeRun("gh", ["issue", "view", "--help"]);
  let dependencyCapability = help.code === 0 && /--json fields/.test(help.stdout);
  let dependencyDetail = dependencyCapability ? "gh issue view supports JSON fields" : trimOutput(help.stderr);
  const issueListArgs = ["issue", "list", "--state", "all", "--limit", "1", "--json", "number"];
  if (repoName) issueListArgs.push("--repo", repoName);
  const issueList = await safeRun("gh", issueListArgs);
  if (dependencyCapability && issueList.code === 0) {
    try {
      const first = (JSON.parse(issueList.stdout) as Array<{ number?: number }>)[0];
      if (first?.number) {
        const dependencyProbeArgs = ["issue", "view", String(first.number), "--json", "blockedBy,blocking"];
        if (repoName) dependencyProbeArgs.push("--repo", repoName);
        const dependencyProbe = await safeRun("gh", dependencyProbeArgs);
        if (dependencyProbe.code === 0) {
          dependencyDetail = "blockedBy/blocking JSON fields verified against a real issue";
        } else if (repoName) {
          const blockedByProbe = await safeRun("gh", ["api", `repos/${repoName}/issues/${first.number}/dependencies/blocked_by?per_page=100`]);
          const blockingProbe = await safeRun("gh", ["api", `repos/${repoName}/issues/${first.number}/dependencies/blocking?per_page=100`]);
          dependencyCapability = blockedByProbe.code === 0 && blockingProbe.code === 0;
          dependencyDetail = dependencyCapability
            ? "gh issue view lacks blockedBy/blocking; native dependency REST endpoints verified via gh api"
            : `blockedBy/blocking API probe failed: ${trimOutput(blockedByProbe.stderr || blockingProbe.stderr)}`;
        } else {
          dependencyCapability = false;
          dependencyDetail = `blockedBy/blocking probe: ${trimOutput(dependencyProbe.stderr || dependencyProbe.stdout)}`;
        }
      } else {
        dependencyDetail = "repository has no issues to probe; dependency capability will be checked when issues exist";
      }
    } catch {
      dependencyCapability = false;
      dependencyDetail = "gh issue list returned invalid JSON";
    }
  } else if (dependencyCapability && issueList.code !== 0) {
    dependencyCapability = false;
    dependencyDetail = `could not probe an issue: ${trimOutput(issueList.stderr || issueList.stdout)}`;
  }
  add("Issue dependency CLI capability", dependencyCapability, dependencyDetail);

  let config: FactoryConfig | undefined;
  if (root) {
    try {
      config = await loadConfig(root);
      add(".factory/config.json", true, "valid");
      for (const error of validateRoleProviders(config)) add("role/provider routing", false, error);
      if (validateRoleProviders(config).length === 0) add("role/provider routing", true, formatRouting(config));
    } catch (error) {
      add(".factory/config.json", false, errorMessage(error));
    }
    add("AGENTS.md", await fileExistsAt(`${root}/AGENTS.md`), "managed Factory rules are merged, not replacing user instructions");
  }

  if (config) {
    const orcaAvailable = await commandAvailable(config.orcaCommand);
    add("Orca CLI", orcaAvailable, config.orcaCommand);
    if (orcaAvailable) {
      const orca = new OrcaClient(config.orcaCommand, runCommand);
      try {
        await orca.status();
        add("Orca runtime/app", true, "status --json succeeded");
        if (root) {
          const repos = await orca.listRepos();
          add("Orca repo registration", repos.some((repo) => repo.path === root), repos.some((repo) => repo.path === root) ? root : "repository is not registered; run factory init");
        }
      } catch (error) {
        add("Orca runtime/app", false, errorMessage(error));
        add("Orca repo registration", false, "not checked because Orca status failed");
      }
    } else {
      add("Orca runtime/app", false, "CLI unavailable");
      add("Orca repo registration", false, "CLI unavailable");
    }

    const workflowAvailable = await commandAvailable(config.workflowCommand);
    add("codex-workflow CLI", workflowAvailable, config.workflowCommand);
    if (workflowAvailable) {
      const workflowDoctor = await safeRun(config.workflowCommand, ["doctor"]);
      add("codex-workflow runtime", workflowDoctor.code === 0, trimOutput(workflowDoctor.stderr || workflowDoctor.stdout));
    } else {
      add("codex-workflow runtime", false, "CLI unavailable");
    }
    add("Bun", await commandAvailable("bun"), "required by codex-dynamic-workflows");
    for (const providerName of providerNames(config)) {
      const provider = config.providers[providerName];
      if (!provider) continue;
      if (provider.backend === "codex") {
        add(`Codex CLI (${providerName})`, await commandAvailable("codex"), "configured provider backend");
        if (await commandAvailable("codex")) {
          const login = await safeRun("codex", ["login", "status"]);
          add(`Codex auth (${providerName})`, login.code === 0, trimOutput(login.stderr || login.stdout));
        }
      } else if (provider.backend === "gemini") {
        const command = typeof provider.geminiCommand === "string" ? provider.geminiCommand : "gemini";
        add(`Gemini CLI (${providerName})`, await commandAvailable(command), "configured provider backend");
      } else if (provider.backend === "pi") {
        const command = typeof provider.piCommand === "string" ? provider.piCommand : "pi";
        add(`Pi CLI (${providerName})`, await commandAvailable(command), "configured provider backend");
        if (provider.apiKeyEnv) add(`Provider key ${provider.apiKeyEnv}`, Boolean(process.env[provider.apiKeyEnv]), `required by ${providerName}; key value is never printed`);
      } else {
        add(`Provider backend (${providerName})`, false, `unsupported backend ${provider.backend}; supported: codex, gemini, pi`);
      }
    }
    const major = Number(process.versions.node.split(".")[0]);
    add("Node.js", major >= 20, `v${process.versions.node} (Factory requires Node >= 20)`);
    const labelResult = await safeRun("gh", ["label", "list", "--limit", "100", "--json", "name"]);
    const labels = labelResult.code === 0 ? new Set((JSON.parse(labelResult.stdout) as Array<{ name?: string }>).map((label) => label.name)) : new Set<string>();
    const requiredLabels = ["factory:auto", "factory:running", "factory:needs-human", "factory:failed"];
    add("GitHub labels", labelResult.code === 0 && requiredLabels.every((label) => labels.has(label)), labelResult.code === 0 ? `required: ${requiredLabels.join(", ")}` : trimOutput(labelResult.stderr));
  }

  return { checks, ok: checks.every((check) => check.ok) };
}

export function formatRouting(config: FactoryConfig): string {
  return Object.entries(config.agents).map(([role, providerName]) => {
    const provider = config.providers[providerName];
    return `${role} ${provider?.backend ?? "?"} / ${provider?.model ?? "?"}`;
  }).join("; ");
}

async function safeRun(command: string, args: string[]) {
  try { return await runCommand(command, args); } catch (error) { return { code: 1, stdout: "", stderr: errorMessage(error) }; }
}

async function fileExistsAt(filePath: string): Promise<boolean> {
  try { await import("node:fs/promises").then(({ access }) => access(filePath)); return true; } catch { return false; }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function trimOutput(value: string): string { return value.trim().replace(/\s+/g, " ").slice(0, 240); }
