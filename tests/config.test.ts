import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_PATH, defaultConfig, loadConfig, normalizeConfig } from "../src/config.js";

describe("configuration normalization", () => {
  it("normalizes the legacy orcaCommand format to V2", () => {
    const legacy = { ...defaultConfig(), version: 1, orcaCommand: "node" } as Record<string, unknown>;
    delete legacy.orca;
    const result = normalizeConfig(legacy);
    expect(result.migrated).toBe(true);
    expect(result.config.version).toBe(2);
    expect(result.config.orca).toEqual({ command: "node", args: [] });
  });

  it("persists a V1 to V2 migration when loading a project config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dark-kitchen-config-"));
    const configPath = path.join(root, CONFIG_PATH);
    await mkdir(path.dirname(configPath), { recursive: true });
    const legacy = { ...defaultConfig(), version: 1, orcaCommand: "node" } as Record<string, unknown>;
    delete legacy.orca;
    await writeFile(configPath, `${JSON.stringify(legacy)}\n`, "utf8");

    const config = await loadConfig(root);
    const persisted = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    expect(config.orca).toEqual({ command: "node", args: [] });
    expect(persisted.version).toBe(2);
    expect(persisted.orca).toEqual({ command: "node", args: [] });
  });
});
