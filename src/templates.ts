import type { FactoryConfig } from "./types.js";

export const FACTORY_AGENTS_SECTION = `<!-- BEGIN FACTORY MANAGED SECTION -->
## Dark Kitchen AI rules

GitHub Issues define the requirements for the current task.

Do not silently change requirements to make implementation easier.

Before declaring success:
- satisfy all acceptance criteria,
- run relevant tests,
- run lint/typecheck where configured,
- inspect the final diff,
- perform an independent review.

Do NOT escalate to the human for:
- ordinary bugs,
- failing tests,
- package documentation,
- implementation details,
- file selection,
- normal debugging.

Escalate only when genuinely blocked by:
- an ambiguous product requirement where multiple materially different behaviors are valid,
- a requirement that appears impossible,
- required credentials/access unavailable to the agent,
  - a destructive or irreversible action requiring approval.

Never launch another GitHub issue yourself.
Finish only the current issue and return control to the Dark Kitchen AI supervisor.
<!-- END FACTORY MANAGED SECTION -->`;

export function configTemplate(config: FactoryConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export const PROVIDER_CONFIG_TEMPLATE = `import { readFileSync } from "node:fs";
import path from "node:path";

// Provider names and role assignments live in .factory/config.json. Read it from
// disk because codex-workflow evaluates provider configs from a data URL, where a
// relative JSON module import cannot be resolved. Credentials are still read by
// codex-dynamic-workflows from the environment and never stored here.
const configPath = process.env.FACTORY_CONFIG_PATH
  ?? (process.cwd().endsWith(path.sep + ".factory")
    ? path.join(process.cwd(), "config.json")
    : path.join(process.cwd(), ".factory", "config.json"));
const factoryConfig = JSON.parse(readFileSync(configPath, "utf8"));
const defaultRole = factoryConfig.workflows?.default?.implementationRole ?? "implementer";
const defaultProvider = factoryConfig.roles?.[defaultRole]?.provider ?? "implementer";

export default {
  providers: Object.fromEntries(
    Object.entries(factoryConfig.providers).map(([name, provider]) => [
      name,
      provider.backend === "codex"
        ? { ...provider, sandbox: provider.sandbox ?? "danger-full-access" }
        : provider,
    ]),
  ),
  default: defaultProvider,
};
`;
