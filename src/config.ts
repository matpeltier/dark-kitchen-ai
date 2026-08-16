import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { FactoryConfig, ProviderConfig } from "./types.js";

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

export const factoryConfigSchema = z.object({
  version: z.literal(1),
  maxParallelIssues: z.number().int().positive(),
  pollIntervalSeconds: z.number().int().positive(),
  autoMerge: z.boolean(),
  baseBranch: z.string().min(1),
  workflowCommand: z.string().min(1),
  orcaCommand: z.string().min(1),
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

export function defaultConfig(): FactoryConfig {
  const codex: ProviderConfig = { backend: "codex", model: "gpt-5-codex", reasoning: "high" };
  return {
    version: 1,
    maxParallelIssues: 3,
    pollIntervalSeconds: 15,
    autoMerge: true,
    baseBranch: "main",
    workflowCommand: "codex-workflow",
    orcaCommand: process.env.ORCA_CLI_COMMAND || (process.platform === "linux" ? "orca-ide" : "orca"),
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
  const raw = JSON.parse(await readFile(path.join(root, CONFIG_PATH), "utf8")) as unknown;
  return factoryConfigSchema.parse(raw);
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
