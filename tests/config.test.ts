import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_PATH, defaultConfig, loadConfig, normalizeConfig, validateRoleProviders } from "../src/config.js";

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
});
