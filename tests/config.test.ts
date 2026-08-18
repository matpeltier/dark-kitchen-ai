import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_PATH, defaultConfig, loadConfig, normalizeConfig, validateRoleProviders } from "../src/config.js";
import { WorkerResultSchema } from "../src/types.js";

describe("configuration normalization", () => {
  it("normalizes the legacy V1 orcaCommand format to V3", () => {
    const legacy = { ...defaultConfig(), version: 1, orcaCommand: "node", agents: { architect: "architect", implementer: "implementer", reviewer: "reviewer", fixer: "implementer" } } as Record<string, unknown>;
    delete legacy.orca;
    delete legacy.roles;
    delete legacy.workflows;
    const result = normalizeConfig(legacy);
    expect(result.migrated).toBe(true);
    expect(result.config.version).toBe(3);
    expect(result.config.orca).toEqual({ command: "node", args: [] });
    expect(result.config.workflows.default.implementationRole).toBe("implementer");
  });

  it("normalizes a V2 config with an Orca spec to V3", () => {
    const legacy = { ...defaultConfig(), version: 2, agents: { architect: "architect", implementer: "implementer", reviewer: "reviewer", fixer: "implementer" } } as Record<string, unknown>;
    delete legacy.roles;
    delete legacy.workflows;
    const result = normalizeConfig(legacy);
    expect(result.config.version).toBe(3);
    expect(result.config.orca).toEqual({ command: "orca-ide", args: [] });
  });

  it("removes the obsolete retry budget from an existing V3 config", () => {
    const legacy = { ...defaultConfig(), maxWorkflowRetries: 7 } as Record<string, unknown>;
    const result = normalizeConfig(legacy);
    expect(result.migrated).toBe(true);
    expect("maxWorkflowRetries" in result.config).toBe(false);
  });

  it("migrates the former Codex workflow runtime to Open Dynamic Workflow", () => {
    const legacy = {
      ...defaultConfig(),
      workflowCommand: "codex-workflow",
      workflowFile: ".factory/workflows/issue.ts",
      workflowConfig: ".factory/codex-workflow.config.ts",
      providers: { ...defaultConfig().providers, architect: { ...defaultConfig().providers.architect, backend: "codex", model: "gpt-5.6-luna" } },
    };
    const result = normalizeConfig(legacy);
    expect(result.migrated).toBe(true);
    expect(result.config.workflowCommand).toBe("open-dynamic-workflow");
    expect(result.config.workflowFile).toBe(".open-dynamic-workflow/workflows/issue.workflow.ts");
    expect(result.config.workflowConfig).toBe(".open-dynamic-workflow/config.yaml");
    expect(result.config.providers.architect.backend).toBe("opencode");
    expect(result.config.providers.architect.model).toBe("openai/gpt-5.6-luna");
  });

  it("persists a V1 to V3 migration when loading a project config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dark-kitchen-config-"));
    const configPath = path.join(root, CONFIG_PATH);
    await mkdir(path.dirname(configPath), { recursive: true });
    const legacy = { ...defaultConfig(), version: 1, orcaCommand: "node", agents: { architect: "architect", implementer: "implementer", reviewer: "reviewer", fixer: "implementer" } } as Record<string, unknown>;
    delete legacy.orca;
    delete legacy.roles;
    delete legacy.workflows;
    await writeFile(configPath, `${JSON.stringify(legacy)}\n`, "utf8");

    const config = await loadConfig(root);
    const persisted = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    expect(config.orca).toEqual({ command: "node", args: [] });
    expect(persisted.version).toBe(3);
    expect(persisted.orca).toEqual({ command: "node", args: [] });
    expect(persisted.roles).toBeTruthy();
  });

  it("validates profile role slots and provider references", () => {
    const config = defaultConfig();
    expect(validateRoleProviders(config)).toEqual([]);
    expect("maxWorkflowRetries" in config).toBe(false);
    expect(config.roles.implementer.provider).not.toBe(config.roles.fixer.provider);
    expect(config.providers[config.roles.fixer.provider]).toBeDefined();
    const broken = {
      ...config,
      roles: { ...config.roles, designer: { ...config.roles.designer, provider: "missing" } },
      workflows: { ...config.workflows, design: { ...config.workflows.design, reviewRole: "not-allowed" } },
    };
    expect(validateRoleProviders(broken)).toEqual([
      "designer references missing provider missing",
      "design.reviewRole references role not-allowed that is not allowed by the profile",
    ]);
  });

  it("keeps genuine human blocker categories while rejecting technical retry exhaustion", () => {
    expect(WorkerResultSchema.parse({
      status: "needs_human",
      category: "requirement_ambiguity",
      summary: "Two materially different valid behaviors",
      question: "Which behavior should be implemented?",
    }).status).toBe("needs_human");
    expect(() => WorkerResultSchema.parse({
      status: "needs_human",
      category: "repeated_failure",
      summary: "The tests keep failing",
      question: "Should we stop?",
    })).toThrow();
  });
});
