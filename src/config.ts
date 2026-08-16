import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { CommandSpec, FactoryConfig, ProviderConfig } from "./types.js";

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

const sharedConfigSchema = z.object({
  maxParallelIssues: z.number().int().positive(),
  pollIntervalSeconds: z.number().int().positive(),
  autoMerge: z.boolean(),
  baseBranch: z.string().min(1),
  workflowCommand: z.string().min(1),
  workflowFile: z.string().min(1),
  workflowConfig: z.string().min(1),
  maxWorkflowRetries: z.number().int().nonnegative(),
  checkTimeoutSeconds: z.number().int().positive(),
  agents: z.object({
    architect: z.string().min(1),
    implementer: z.string().min(1),
    reviewer: z.string().min(1),
    fixer: z.string().min(1),
  }),
  providers: z.record(z.string(), providerSchema),
});

export const factoryConfigSchema = sharedConfigSchema.extend({
  version: z.literal(2),
  orca: commandSpecSchema,
});

const legacyFactoryConfigSchema = sharedConfigSchema.extend({
  version: z.literal(1),
  orcaCommand: z.string().min(1),
});

export function defaultConfig(): FactoryConfig {
  const codex: ProviderConfig = { backend: "codex", model: "gpt-5.6-luna", reasoning: "high" };
  return {
    version: 2,
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
    maxWorkflowRetries: 1,
    checkTimeoutSeconds: 1800,
    agents: {
      architect: "architect",
      implementer: "implementer",
      reviewer: "reviewer",
      fixer: "implementer",
    },
    providers: {
      architect: codex,
      implementer: { ...codex, reasoning: "medium" },
      reviewer: codex,
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
  if (current.success) return { config: current.data as FactoryConfig, migrated: false };

  const legacy = legacyFactoryConfigSchema.safeParse(raw);
  if (legacy.success) {
    const { orcaCommand, ...rest } = legacy.data;
    const orca: CommandSpec = { command: orcaCommand, args: [] };
    return { config: { ...rest, version: 2, orca } as FactoryConfig, migrated: true };
  }

  throw current.error;
}

export function configPath(root: string): string {
  return path.join(root, CONFIG_PATH);
}

export function runtimePath(root: string): string {
  return path.join(root, RUNTIME_DIR);
}

export function validateRoleProviders(config: FactoryConfig): string[] {
  const errors: string[] = [];
  for (const [role, providerName] of Object.entries(config.agents)) {
    const provider = config.providers[providerName];
    if (!provider) errors.push(`${role} references missing provider ${providerName}`);
  }
  return errors;
}

export function providerNames(config: FactoryConfig): string[] {
  return [...new Set(Object.values(config.agents))];
}
