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

export const ODW_CONFIG_TEMPLATE = `defaultProvider: opencode
outDir: ".open-dynamic-workflow/runs"
concurrency: 4
timeoutMs: 1800000
failFast: false

providers:
  opencode:
    command: opencode
    args:
      - run
      - --format
      - json
    defaultModel: null
    modelArg:
      flag: --model
    promptMode: arg
    permissionPolicy: read-only

workflow:
  include:
    - ".open-dynamic-workflow/workflows/**/*.workflow.ts"
  exclude: []

tools:
  include:
    - ".open-dynamic-workflow/tools/**/*.tool.ts"
  exclude: []

security:
  passEnv:
    - OPENCODE_*
    - OPENAI_API_KEY
    - ANTHROPIC_API_KEY
    - GOOGLE_API_KEY
    - GEMINI_API_KEY
  redactEnv:
    - "*_KEY"
    - "*_TOKEN"
    - "*_SECRET"
    - PASSWORD

reporting:
  mode: json
`;
