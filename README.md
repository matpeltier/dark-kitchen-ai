# Dark Kitchen AI

[![CI](https://github.com/matpeltier/dark-kitchen-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/matpeltier/dark-kitchen-ai/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dark-kitchen-ai)](https://www.npmjs.com/package/dark-kitchen-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

OpenCode plans and builds. GitHub remembers. Orca isolates. **Dark Kitchen AI keeps the graph moving.**

Dark Kitchen AI is a small local CLI for an AI coding workflow that is driven by GitHub Issues. OpenCode (or a human) defines the product work as issues and native issue dependencies. The supervisor finds ready issues, gives each one an isolated [Orca](https://github.com/stablyai/orca) worktree, runs an [Open Dynamic Workflow](https://github.com/travisliu/open-dynamic-workflow) implementation/review workflow through OpenCode, and owns the PR, checks, merge, and issue transition.

It is deliberately a V0 tool: GitHub is the durable source of truth, the CLI is a foreground runtime supervisor, and the worker runtime is the installed Open Dynamic Workflow CLI with its OpenCode provider adapter.

## What it does

For every open issue marked `dark-kitchen:auto`, Dark Kitchen AI can:

1. Check the native GitHub dependency graph and find unblocked work.
2. Create a separate Orca worktree and terminal.
3. Run the generated dynamic workflow: understand, implement, test, independently review, fix, and retest.
4. Read a strict JSON worker result from `.factory/runtime/<issue>/result.json`.
5. Push the branch, open a PR, wait for checks, squash-merge passing work, and close the issue.
6. Rescan the graph so newly unblocked issues start automatically.

If the worker reaches a real product or access blocker, it labels the issue, comments with a structured question, notifies you on macOS, preserves the worktree, and continues independent issues.

## What it is not

Dark Kitchen AI is not a cloud service, MCP server, backlog database, web UI, Kubernetes system, or generic multi-provider platform. It does not replace GitHub Issues and it does not try to make every CLI coding agent a workflow backend. Orca is mandatory at the top level; Open Dynamic Workflow owns the OpenCode subagent sessions.

## Prerequisites

Install and authenticate these tools on the machine that will run the supervisor:

- Git
- [GitHub CLI](https://cli.github.com/) with `gh auth login`
- [Orca](https://github.com/stablyai/orca), including its machine-readable CLI
- Node.js 22 or newer
- [OpenCode](https://opencode.ai/) CLI, authenticated for the provider/model you want to use
- `open-dynamic-workflow`, from [Open Dynamic Workflow](https://github.com/travisliu/open-dynamic-workflow)
- The credentials required by those backends

The exact OpenCode model IDs and provider flags are account- and version-specific. Use the `provider/model` form expected by OpenCode, then run `dark-kitchen-ai doctor` after setup.

Install the workflow runtime if it is not already available:

```bash
npm install --global @travisliu/open-dynamic-workflow
```

## Install and run with npx

After the package is published, no global install is required:

```bash
npx dark-kitchen-ai --help
npx dark-kitchen-ai doctor
```

For a brand-new project:

```bash
npx dark-kitchen-ai create my-project --private
cd my-project
npx dark-kitchen-ai doctor
```

`create` initializes Git, creates the GitHub repository, generates `AGENTS.md`, `.factory/`, and `.open-dynamic-workflow/`, registers the repository with Orca, creates the labels, commits, pushes, and runs Doctor. Use `--public` for a public repository. It never overwrites an existing directory.

For an existing GitHub repository:

```bash
cd my-existing-project
npx dark-kitchen-ai init
npx dark-kitchen-ai doctor
```

`init` only adds missing generated files and a managed section to `AGENTS.md`; unrelated project instructions are preserved.

If Orca is exposed through a runtime or wrapper, configure the executable and its arguments explicitly:

```bash
npx dark-kitchen-ai init \
  --orca-command node \
  --orca-arg /path/to/orca-cli/index.js
```

The generated configuration is:

```json
"orca": {
  "command": "node",
  "args": ["/path/to/orca-cli/index.js"]
}
```

Dark Kitchen AI invokes this as an argument array (`node /path/to/orca-cli/index.js status --json`); it does not use `sh -c` or concatenate a shell command. Existing V1 and V2 configurations are accepted and migrated to V3 automatically; former `codex-workflow` runtime paths are migrated to Open Dynamic Workflow the next time the configuration is loaded.

### Install the planning skill

The repository and npm package include `skills/dark-kitchen-issues/`, a portable `SKILL.md` that teaches OpenCode how to plan issues, use the four labels, create native dependency edges, avoid cycles, and resume human-blocked work.

Install it in the current project:

```bash
npx dark-kitchen-ai skill install
```

Install it in the local OpenCode skill directory:

```bash
npx dark-kitchen-ai skill install --global
```

Or download/copy the folder directly from [`skills/dark-kitchen-issues`](skills/dark-kitchen-issues). The command is intentionally safe: an existing destination is not replaced unless `--force` is provided.

## Daily workflow

1. Discuss the product and acceptance criteria with ChatGPT.
2. Create or edit GitHub Issues and their native dependency relationships.
3. Add `dark-kitchen:auto` only to issues safe to execute autonomously.
4. Start the foreground supervisor:

   ```bash
   npx dark-kitchen-ai run
   ```

5. Leave that terminal running. Inspect it from another terminal with:

   ```bash
   npx dark-kitchen-ai status
   npx dark-kitchen-ai status --json
   ```

6. Stop gracefully when needed:

   ```bash
   npx dark-kitchen-ai stop
   ```

The supervisor uses a repository-local lock, so a second supervisor cannot silently manage the same project. `stop` asks the foreground process to exit after its current tick; it does not kill existing workers.

### Labels

Only these labels have runtime meaning:

| Label | Meaning |
| --- | --- |
| `dark-kitchen:auto` | The supervisor may launch the issue. |
| `dark-kitchen:running` | A workflow currently owns the issue. |
| `dark-kitchen:needs-human` | A genuine product, access, destructive-action, or repeated-failure blocker needs you. |
| `dark-kitchen:failed` | The latest autonomous attempt failed; the supervisor preserves the worktree and schedules another attempt. |

No `dark-kitchen:auto` means Dark Kitchen AI leaves the issue alone. Labels are created idempotently by `init` and `create`.

### Native issue dependencies

Use GitHub's native issue dependency UI or API. Do not write `Depends on #123` in Markdown and expect Dark Kitchen AI to parse it. A graph like this is enough:

```text
#1 ─┐
    ├─→ #3 ─→ #5
#2 ─┘
#4 ─────────→ #5
```

With all five issues marked `dark-kitchen:auto`, #1 and #2 start first, #3 starts after both close, and #5 starts after #3 and #4 close. Closed dependencies satisfy the graph. If a dependency was closed without being marked for autonomous work, `status` surfaces that state instead of silently hiding it. Cyclic graphs are refused.

## Configuration

`init` generates a small, committed supervisor configuration at `.factory/config.json` and an Open Dynamic Workflow project under `.open-dynamic-workflow/`. Runtime state under `.factory/runtime/` and `.open-dynamic-workflow/runs/` is ignored by Git. For each issue, Dark Kitchen AI writes the exact workflow input to `.factory/runtime/<issue>/input.json` and the worker writes its structured result to `result.json`; the Orca command passes only a reference to that input file, never the issue body itself.

Example:

```json
{
  "version": 3,
  "maxParallelIssues": 3,
  "pollIntervalSeconds": 15,
  "autoMerge": true,
  "baseBranch": "main",
  "workflowCommand": "open-dynamic-workflow",
  "orca": { "command": "orca-ide", "args": [] },
  "workflowFile": ".open-dynamic-workflow/workflows/issue.workflow.ts",
  "workflowConfig": ".open-dynamic-workflow/config.yaml",
  "checkTimeoutSeconds": 1800,
  "roles": {
    "designer": {
      "provider": "architect",
      "model": "YOUR_CURRENT_DESIGN_MODEL",
      "agentType": "designer",
      "prompt": "Design a coherent, accessible, responsive solution.",
      "skills": ["ui-design"],
      "mcp": ["figma"]
    },
    "implementer": {
      "provider": "implementer",
      "prompt": "Implement only the issue acceptance criteria."
    },
    "reviewer": {
      "provider": "reviewer",
      "prompt": "Review correctness, regressions, and missing tests."
    },
    "fixer": {
      "provider": "fixer",
      "prompt": "Resolve every blocking review finding at its root cause and verify the surrounding subsystem."
    }
  },
  "workflows": {
    "default": {
      "roles": ["architect", "implementer", "reviewer", "fixer"],
      "plan": "auto",
      "planRole": "architect",
      "implementationRole": "implementer",
      "reviewRole": "reviewer",
      "fixRole": "fixer"
    },
    "design": {
      "roles": ["designer", "implementer", "reviewer", "fixer"],
      "plan": "always",
      "planRole": "designer",
      "implementationRole": "implementer",
      "reviewRole": "reviewer",
      "fixRole": "fixer"
    }
  },
  "providers": {
    "architect": { "backend": "opencode", "model": "YOUR_OPENCODE_PROVIDER/MODEL", "reasoning": "high" },
    "implementer": { "backend": "opencode", "model": "YOUR_OPENCODE_PROVIDER/MODEL", "reasoning": "medium" },
    "reviewer": { "backend": "opencode", "model": "YOUR_OPENCODE_PROVIDER/MODEL", "reasoning": "high" },
    "fixer": { "backend": "opencode", "model": "YOUR_OPENCODE_PROVIDER/MODEL", "reasoning": "high" }
  }
}
```

`roles` defines precise workflow roles. Each role can select a model, add a role directive, and load project-local skills. Open Dynamic Workflow runs every role through the OpenCode provider; `workflows` chooses which roles participate and assigns semantic slots such as planning, implementation, review, and fixing.

Existing V1 and V2 `.factory/config.json` files are migrated automatically to V3 when loaded; their role routing and Orca configuration are preserved, while former Codex providers are converted to OpenCode models.

The PM selects a specialized profile in the issue body:

```markdown
## Dark Kitchen workflow
profile: design
```

Without that block, the `default` profile is used. Unknown profiles become a human blocker instead of silently falling back. Keep provider names, model IDs, skill names, and MCP names in the committed project configuration; never put credentials, URLs, or shell commands in an issue.

Skills are loaded from project-local locations in this order: `.factory/skills/<name>/SKILL.md`, `skills/<name>/SKILL.md`, `.opencode/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`, and `.codex/skills/<name>/SKILL.md`. Dark Kitchen validates skill names and reports missing skills as `needs_human`.

The generated `.open-dynamic-workflow/config.yaml` configures the runtime and its OpenCode provider. Edit `.factory/config.json`, not supervisor code, when changing role routing or model selection. `status` prints the active role routing and `doctor` checks the Open Dynamic Workflow and OpenCode CLIs.

Example OpenCode provider shape:

```json
{
  "implementer": {
    "backend": "opencode",
    "model": "openai/YOUR_MODEL_ID",
    "reasoning": "medium"
  }
}
```

Use the exact model ID and credentials required by your installed OpenCode provider. Never commit API keys. Workflow agent calls use Open Dynamic Workflow's explicit `dangerously-full-access` mode because they must modify the isolated Orca worktree; the worktree remains the safety boundary.

The `mcp` field is an allowlist and role hint. A role must only rely on MCP tools that are already exposed by its OpenCode session; Dark Kitchen deliberately does not pretend that listing an MCP name creates a connection.

## Workflow and worker results

The generated `.open-dynamic-workflow/workflows/issue.workflow.ts` is a reusable role-based orchestrator. It resolves the issue's workflow profile, loads the selected role prompts and skills through trusted local tools, optionally runs a designer/architect, implements, independently reviews, and bounds fix/review loops to avoid recursive agent explosions. The workflow file stays the same; the selected profile and issue context change its execution.

The final result is validated against `.factory/result.schema.json`:

```json
{ "status": "success", "summary": "...", "tests": ["..."], "reviewSummary": "..." }
```

Other valid statuses are `needs_human` and `failed`. The supervisor never decides success by scraping prose from a terminal. A successful worker must leave committed changes and a clean worktree before a PR is opened.

## Human escalation and resume

Routine bugs, failing tests, implementation choices, review findings, crashes, timeouts, and normal debugging stay with the worker. Escalation is reserved for materially ambiguous requirements, impossible requirements, unavailable access, or destructive actions requiring explicit approval.

When escalation happens, Dark Kitchen AI:

- removes `dark-kitchen:running`;
- adds `dark-kitchen:needs-human`;
- posts a structured GitHub comment;
- sends one macOS Notification Center alert;
- preserves the Orca worktree;
- continues independent issues.

Return to ChatGPT, update the requirement/dependencies, and remove `dark-kitchen:needs-human` while leaving the issue open and marked `dark-kitchen:auto`. The next run rereads the current issue and dependencies. To retry explicitly:

```bash
npx dark-kitchen-ai retry 7
```

Technical failures are retried indefinitely with bounded backoff in the same preserved worktree and branch. `retry` remains available for an explicit immediate retry after inspecting the current state; every retry rereads the current issue rather than trusting stale model context.

## Merge gate and safety

The supervisor, not the coding worker, owns PR creation, checks, merge, issue closure, and label transitions. It never merges a PR whose checks fail or time out. If a repository has no GitHub checks, the local workflow tests are the V0 gate and `status` records that fact.

Before using auto-merge on a real repository:

- protect the base branch as appropriate;
- require the checks you care about in GitHub;
- start with a throwaway repository;
- review the generated configuration and provider sandbox setting;
- keep credentials in the environment, never in `.factory/` or commits.

Workers must not change the roadmap or launch another issue. `.factory/` is the technical runtime namespace retained for V0 compatibility; GitHub remains the only durable project graph.

## Development

```bash
git clone https://github.com/matpeltier/dark-kitchen-ai.git
cd dark-kitchen-ai
npm install
npm run typecheck
npm test
npm run build
npm run pack:check
npm link
dark-kitchen-ai --help
```

The tests mock GitHub, Orca, and worker processes; they do not require real LLM credentials. The real integration path is validated separately on a throwaway GitHub repository.

To publish a release manually, authenticate npm first and run:

```bash
npm login
npm publish --access public
```

The package is configured with public npm access and exposes both `dark-kitchen-ai` and the short alias `dka`.

## V0 limitations

- The supervisor runs in the foreground; use launchd/systemd later if you want a daemon.
- Recovery after a machine crash is intentionally conservative and keeps worktrees for inspection.
- `autoMerge: false` opens and checks PRs but leaves the final merge to a human; the hands-off path is the default V0 demo.
- Direct Claude, Gemini CLI, or remote execution harnesses are not implemented as separate workflow runners. OpenCode is the supported worker provider through Open Dynamic Workflow.
- There is no hosted dashboard, database, MCP server, or second dependency graph.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Keep changes small, preserve GitHub as the source of truth, and run typecheck, tests, build, and package checks locally.

For security reports, see [SECURITY.md](SECURITY.md). Please do not publish credentials, provider tokens, or private repository data in an issue.

## License

[MIT](LICENSE) © 2026 Mathieu PELTIER.

## Upstream documentation

Dark Kitchen AI shells out to the installed tools instead of pretending their CLIs are stable APIs. Consult the current documentation for your installed versions:

- [Orca CLI](https://github.com/stablyai/orca/blob/main/skill-guides/orca-cli.md)
- [Orca orchestration skill](https://github.com/stablyai/orca/blob/main/skills/orchestration/SKILL.md)
- [Open Dynamic Workflow](https://github.com/travisliu/open-dynamic-workflow)
- [OpenCode](https://opencode.ai/)
- [GitHub issue dependencies API](https://docs.github.com/en/rest/issues/issue-dependencies)
