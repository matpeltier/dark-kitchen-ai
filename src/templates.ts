import type { FactoryConfig } from "./types.js";

export const FACTORY_AGENTS_SECTION = `<!-- BEGIN FACTORY MANAGED SECTION -->
## Factory rules

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
- a destructive or irreversible action requiring approval,
- repeated failure after multiple reasonable attempts.

Never launch another GitHub issue yourself.
Finish only the current issue and return control to the Factory supervisor.
<!-- END FACTORY MANAGED SECTION -->`;

export function configTemplate(config: FactoryConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export const PROVIDER_CONFIG_TEMPLATE = `import factoryConfig from "./config.json" with { type: "json" };

// Provider names and role assignments live in .factory/config.json. Credentials are
// read by codex-dynamic-workflows from the environment and never stored here.
export default {
  providers: factoryConfig.providers,
  default: factoryConfig.agents.implementer,
};
`;
