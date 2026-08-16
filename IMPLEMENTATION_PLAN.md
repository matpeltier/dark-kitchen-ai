# Factory V0 implementation plan

## Verified starting point

- This repository started empty (Git initialized, no commits).
- Node 22.23.2, npm 10.9.8, Git 2.43.0, GitHub CLI 2.45.0, and Codex CLI 0.146.0 are installed.
- GitHub CLI is authenticated and `gh issue view` exposes `blockedBy` and `blocking` JSON fields. The issue list/create/edit commands do not expose dependency fields, so Factory reads dependencies with issue-view/API-compatible commands.
- Orca is installed as the local AppImage dispatcher. Its current CLI probes fail before command parsing with an Electron `--no-sandbox` startup error in this environment; `factory doctor` must report this exact failure.
- `codex-workflow` and Bun are not currently on `PATH`. The generated workflow follows the current upstream `codex-workflow run <file> --config <path> --args <json> --json` shape and doctor reports the missing prerequisites.

## Phases

1. **Skeleton** — TypeScript CLI, config/template generation, command execution seams, and doctor.
2. **GitHub DAG** — issue/dependency loading, cycle detection, readiness, labels, status, and idempotent initialization.
3. **Orca runtime** — JSON worktree/terminal commands, runtime records, lock/stop/reconcile behavior.
4. **Dynamic workflow** — generated role-routed workflow, strict result schema, terminal completion handling.
5. **Supervisor transitions** — PR creation, checks, merge, issue closure, dependency rescan, and bounded retries.
6. **Human escalation** — structured issue comments, labels, macOS notifications, preserved worktrees, and label-based retry.
7. **Bootstrap and polish** — `create`, README, focused unit tests, typecheck, and safe CLI smoke tests.

## V0 choices

- GitHub remains the only durable project graph; `.factory/runtime/` is ephemeral and ignored.
- The supervisor owns PRs, checks, merges, labels, and issue closure. Workers only change their current worktree and write `result.json`.
- The default implementation uses direct `gh`, Orca, and `codex-workflow` commands behind small injectable adapters; no provider/plugin framework is introduced.
- Closed dependencies satisfy the DAG but are surfaced as “closed not planned” when they were not Factory-managed.
