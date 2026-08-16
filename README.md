# Factory V0

ChatGPT plans. GitHub remembers. Orca isolates. Codex builds. Dynamic Workflows verify. Factory keeps the graph moving.

Factory is a small local CLI for one personal workflow: GitHub Issues are the durable requirements and dependency graph; Orca owns isolated worktrees and terminals; `codex-dynamic-workflows` runs the role-routed implementation/review workflow; Factory owns the PR, checks, merge, and issue transitions.

It is deliberately not a cloud service, MCP server, backlog database, generic agent platform, or provider plugin framework.

## Prerequisites

- Git
- GitHub CLI (`gh`) authenticated for the target repository
- Orca and its machine-readable CLI
- Node.js 20 or newer
- Bun
- `codex-dynamic-workflows` (`codex-workflow`)
- The backend CLIs and credentials referenced by `.factory/config.json`

The default generated profile uses the current Codex provider shape documented by `codex-dynamic-workflows` (`gpt-5-codex`) and routes all roles to Codex. The prompt's GPT-5.6 Sol and DeepSeek examples are intentionally not hard-coded because model availability is account/provider-specific. Edit the provider map to use Pi or Gemini for selected roles; Factory Doctor checks only backends and API-key environment variables actually referenced by the active roles. Secrets are read from the environment and never written to the repository.

The installed environment used while building this V0 had Codex and `gh`, but no Bun or `codex-workflow`; its Orca AppImage dispatcher also failed before command parsing with an Electron `--no-sandbox` error. `factory doctor` reports those conditions rather than pretending the runtime is ready.

For managed environments that expose a version-matched Orca executable under a non-default path, set `ORCA_CLI_COMMAND`; Factory uses it for the current run without writing credentials or runtime state into the project.

## Setup

From this repository during development:

```sh
npm install
npm run build
npm link
```

For a new project:

```sh
factory create my-project
```

`create` asks only for visibility, parallelism, and auto-merge policy, then initializes Git, creates the GitHub repository, generates `AGENTS.md` and `.factory/`, creates the four Factory labels, commits, pushes, and runs Doctor.

For an existing GitHub repository:

```sh
cd existing-project
factory init
factory doctor
```

`init` never overwrites unrelated files. It creates or preserves `.factory/config.json`, merges a marked Factory section into `AGENTS.md`, adds `.factory/runtime/` to `.gitignore`, registers the repository with Orca, creates labels idempotently, and commits only generated changes.

## Daily workflow

1. Discuss the product with ChatGPT.
2. Let ChatGPT create or update GitHub Issues and native GitHub Issue Dependencies.
3. Add `factory:auto` to issues that are safe to run autonomously.
4. Start the foreground supervisor:

```sh
factory run
```

5. Leave it running. Factory finds ready issues, creates independent Orca worktrees, launches the dynamic workflow, pushes branches, opens PRs, waits for checks, squash-merges passing PRs, verifies issue closure, and immediately rescans the dependency graph.

Only these labels have meaning to Factory:

- `factory:auto` — eligible for automatic launch
- `factory:running` — currently owned by a workflow
- `factory:needs-human` — a real product/access/approval blocker
- `factory:failed` — the bounded worker retry was exhausted

No `factory:auto` means Factory leaves the issue alone.

## Example DAG

```text
#1 ─┐
    ├─→ #3 ─→ #5
#2 ─┘
#4 ────────→ #5
```

With `factory:auto` on all five issues, #1 and #2 start first. #3 starts only after both close. #5 starts after #3 and #4 close. Closed dependencies satisfy the graph; if a closed dependency was not Factory-managed, `factory status` surfaces that fact instead of hiding it.

Factory refuses to launch a cyclic dependency graph.

## Role routing

Role names are in `.factory/config.json`; provider definitions are in the same file and are imported by the generated `.factory/codex-workflow.config.ts`. The workflow code does not change when routing changes.

```json
{
  "agents": {
    "architect": "architect",
    "implementer": "implementer",
    "reviewer": "reviewer",
    "fixer": "implementer"
  },
  "providers": {
    "architect": { "backend": "codex", "model": "gpt-5-codex", "reasoning": "high" },
    "implementer": { "backend": "pi", "baseUrl": "https://api.deepseek.com", "api": "openai-completions", "model": "deepseek-v4-flash", "apiKeyEnv": "DEEPSEEK_API_KEY" },
    "reviewer": { "backend": "codex", "model": "gpt-5-codex", "reasoning": "high" }
  }
}
```

That Pi example is an example profile, not a hard-coded Factory dependency. Verify the model and endpoint against the provider account and installed Pi version before enabling it. Current upstream dynamic-workflow documentation supports `codex`, `gemini`, and `pi` backends and named per-agent providers.

The generated workflow uses an architecture pass only for issues that look structurally complex, a cheap implementation role by default, an independent reviewer, and at most two fix/review loops. Workers never merge PRs or launch other issues.

## Human escalation and resume

Routine bugs, failing tests, and normal debugging stay with the worker. A worker returns `needs_human` only for a materially ambiguous or impossible requirement, missing required access, a destructive approval, or repeated reasonable failure.

Factory then:

1. removes `factory:running`,
2. adds `factory:needs-human`,
3. comments a structured problem/question/recommendation/evidence report on the issue,
4. sends a macOS Notification Center alert, and
5. preserves the Orca worktree.

Independent issues continue. Discuss the issue with ChatGPT, edit the requirement/dependencies, and remove `factory:needs-human` while leaving the issue open and `factory:auto`. The next supervisor tick rereads the current issue and starts a fresh workflow in the preserved worktree. It never trusts stale model context. Use `factory retry <number>` for a failed issue after inspecting it.

## Safety and status

```sh
factory status
factory status --json
factory stop
```

`status` works without an active supervisor and shows running, ready, blocked, needs-human, failed, and done issues plus active role routing. `stop` asks the foreground loop to stop after its current tick and does not kill existing workers.

The supervisor never merges failing checks, never silently rewrites requirements, never launches issues without `factory:auto`, and never lets one human blocker stop independent work. If a repository has no CI checks, the status/PR path records that local workflow tests were the available gate.

## Development

```sh
npm run typecheck
npm test
npm run build
```

The tests mock GitHub, Orca, and worker terminals. They cover graph readiness/cycles, initialization file merging, concurrency, human escalation, and restart reconciliation without spending model tokens.

## Verified upstream references

- [Orca CLI guide](https://github.com/stablyai/orca/blob/main/skill-guides/orca-cli.md)
- [Orca orchestration guide](https://github.com/stablyai/orca/blob/main/skills/orchestration/SKILL.md)
- [codex-dynamic-workflows README](https://github.com/six-ddc/codex-dynamic-workflows)
- [GitHub issue dependency REST documentation](https://docs.github.com/en/rest/issues/issue-dependencies)
