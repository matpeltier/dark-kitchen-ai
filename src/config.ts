import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { CommandSpec, FactoryConfig, ProviderConfig, RoleConfig, WorkflowProfile } from "./types.js";

export const FACTORY_DIR = ".factory";
export const RUNTIME_DIR = path.join(FACTORY_DIR, "runtime");
export const CONFIG_PATH = path.join(FACTORY_DIR, "config.json");

const providerSchema = z.object({
  backend: z.string().min(1),
  model: z.string().min(1),
  reasoning: z.string().optional(),
  thinking: z.string().optional(),
  baseUrl: z.string().optional(),
  api: z.string().optional(),
  apiKeyEnv: z.string().optional(),
}).passthrough();

const commandSpecSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
});

const roleSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  prompt: z.string().optional(),
  agentType: z.string().min(1).optional(),
  skills: z.array(z.string().min(1)).optional(),
  mcp: z.array(z.string().min(1)).optional(),
});

const workflowProfileSchema = z.object({
  roles: z.array(z.string().min(1)).min(1),
  plan: z.enum(["auto", "always", "never"]).optional(),
  prompt: z.string().optional(),
  planRole: z.string().min(1).optional(),
  implementationRole: z.string().min(1).optional(),
  reviewRole: z.string().min(1).optional(),
  fixRole: z.string().min(1).optional(),
});

const sharedConfigSchema = z.object({
  maxParallelIssues: z.number().int().positive(),
  pollIntervalSeconds: z.number().int().positive(),
  autoMerge: z.boolean(),
  baseBranch: z.string().min(1),
  workflowCommand: z.string().min(1),
  workflowFile: z.string().min(1),
  workflowConfig: z.string().min(1),
  checkTimeoutSeconds: z.number().int().positive(),
  providers: z.record(z.string(), providerSchema),
});

export const factoryConfigSchema = sharedConfigSchema.extend({
  version: z.literal(3),
  orca: commandSpecSchema,
  roles: z.record(z.string(), roleSchema),
  workflows: z.record(z.string(), workflowProfileSchema),
});

const v2ConfigSchema = sharedConfigSchema.extend({
  version: z.literal(2),
  orca: commandSpecSchema,
  agents: z.object({
    architect: z.string().min(1),
    implementer: z.string().min(1),
    reviewer: z.string().min(1),
    fixer: z.string().min(1),
  }),
});

const v1ConfigSchema = sharedConfigSchema.extend({
  version: z.literal(1),
  orcaCommand: z.string().min(1),
  agents: z.object({
    architect: z.string().min(1),
    implementer: z.string().min(1),
    reviewer: z.string().min(1),
    fixer: z.string().min(1),
  }),
});

const defaultRolePrompts: Record<string, string> = {
  architect: "Plan the smallest implementation that satisfies the issue acceptance criteria. Do not invent product requirements.",
  designer: "Design a coherent, accessible, responsive solution. Respect the existing design system and document important UI decisions.",
  implementer: "Implement only the issue acceptance criteria. Make the smallest correct change and verify it.",
  reviewer: "Independently review correctness, regressions, acceptance criteria, and missing tests. Return actionable findings only.",
  fixer: "Resolve every blocking review finding at its root cause. Inspect the surrounding subsystem for the same class of defect, preserve all acceptance criteria, rerun relevant tests/typecheck/lint/build, inspect the final diff adversarially, and commit the resulting changes. Do not request human input for routine engineering or debugging decisions.",
};

export function defaultConfig(): FactoryConfig {
  const codex: ProviderConfig = { backend: "codex", model: "gpt-5.6-luna", reasoning: "high" };
  const roles: Record<string, RoleConfig> = {
    architect: { provider: "architect", prompt: defaultRolePrompts.architect },
    designer: { provider: "architect", prompt: defaultRolePrompts.designer, skills: [] },
    implementer: { provider: "implementer", prompt: defaultRolePrompts.implementer },
    reviewer: { provider: "reviewer", prompt: defaultRolePrompts.reviewer },
    fixer: { provider: "fixer", prompt: defaultRolePrompts.fixer },
  };
  return {
    version: 3,
    maxParallelIssues: 3,
    pollIntervalSeconds: 15,
    autoMerge: true,
    baseBranch: "main",
    workflowCommand: "codex-workflow",
    orca: {
      command: process.env.ORCA_CLI_COMMAND || (process.platform === "linux" ? "orca-ide" : "orca"),
      args: [],
    },
    workflowFile: ".factory/workflows/issue.ts",
    workflowConfig: ".factory/codex-workflow.config.ts",
    checkTimeoutSeconds: 1800,
    roles,
    workflows: {
      default: { roles: ["architect", "implementer", "reviewer", "fixer"], plan: "auto", planRole: "architect", implementationRole: "implementer", reviewRole: "reviewer", fixRole: "fixer" },
      design: { roles: ["designer", "implementer", "reviewer", "fixer"], plan: "always", planRole: "designer", implementationRole: "implementer", reviewRole: "reviewer", fixRole: "fixer", prompt: "This is a design-led issue. Preserve visual, accessibility, and interaction decisions in the implementation." },
    },
    providers: {
      architect: codex,
      implementer: { ...codex, reasoning: "medium" },
      reviewer: codex,
      fixer: codex,
    },
  };
}

export async function loadConfig(root: string): Promise<FactoryConfig> {
  const filePath = path.join(root, CONFIG_PATH);
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const normalized = normalizeConfig(raw);
  if (normalized.migrated) await writeFile(filePath, `${JSON.stringify(normalized.config, null, 2)}\n`, "utf8");
  return process.env.ORCA_CLI_COMMAND
    ? { ...normalized.config, orca: { command: process.env.ORCA_CLI_COMMAND, args: [] } }
    : normalized.config;
}

export function normalizeConfig(raw: unknown): { config: FactoryConfig; migrated: boolean } {
  const current = factoryConfigSchema.safeParse(raw);
  if (current.success) {
    const removedRetrySetting = typeof raw === "object" && raw !== null && "maxWorkflowRetries" in raw;
    return { config: current.data as FactoryConfig, migrated: removedRetrySetting };
  }

  const v2 = v2ConfigSchema.safeParse(raw);
  if (v2.success) return { config: migrateLegacy(v2.data, v2.data.orca), migrated: true };

  const v1 = v1ConfigSchema.safeParse(raw);
  if (v1.success) {
    const { orcaCommand, ...rest } = v1.data;
    return { config: migrateLegacy(rest, { command: orcaCommand, args: [] }), migrated: true };
  }

  throw current.error;
}

function migrateLegacy(
  legacy: { providers: Record<string, ProviderConfig>; agents: Record<string, string>; version?: number } & Record<string, unknown>,
  orca: CommandSpec,
): FactoryConfig {
  const roles = Object.fromEntries(Object.entries(legacy.agents).map(([name, provider]) => [
    name,
    { provider, prompt: defaultRolePrompts[name] },
  ]));
  const { agents: _agents, version: _version, ...rest } = legacy;
  return {
    ...rest,
    version: 3,
    orca,
    roles,
    workflows: {
      default: {
        roles: Object.keys(legacy.agents),
        plan: "auto",
        planRole: legacy.agents.architect,
        implementationRole: legacy.agents.implementer,
        reviewRole: legacy.agents.reviewer,
        fixRole: legacy.agents.fixer,
      },
    },
    providers: legacy.providers,
  } as unknown as FactoryConfig;
}

export function configPath(root: string): string {
  return path.join(root, CONFIG_PATH);
}

export function runtimePath(root: string): string {
  return path.join(root, RUNTIME_DIR);
}

export function validateRoleProviders(config: FactoryConfig): string[] {
  const errors: string[] = [];
  for (const [role, roleConfig] of Object.entries(config.roles)) {
    if (!config.providers[roleConfig.provider]) errors.push(`${role} references missing provider ${roleConfig.provider}`);
    for (const skill of roleConfig.skills ?? []) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(skill) || skill.includes("..")) errors.push(`${role} references unsafe skill name ${skill}`);
    }
  }
  for (const [workflow, profile] of Object.entries(config.workflows)) {
    for (const role of profile.roles) if (!config.roles[role]) errors.push(`${workflow} references missing role ${role}`);
    for (const [slot, role] of Object.entries({
      planRole: profile.planRole,
      implementationRole: profile.implementationRole,
      reviewRole: profile.reviewRole,
      fixRole: profile.fixRole,
    })) {
      if (role && !profile.roles.includes(role)) errors.push(`${workflow}.${slot} references role ${role} that is not allowed by the profile`);
    }
  }
  if (!config.workflows.default) errors.push("workflows must define a default profile");
  return errors;
}

export function providerNames(config: FactoryConfig): string[] {
  return [...new Set(Object.values(config.roles).map((role) => role.provider))];
}

export function roleConfig(config: FactoryConfig, roleName: string): RoleConfig | undefined {
  return config.roles[roleName];
}
