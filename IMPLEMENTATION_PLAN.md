# Dark Kitchen AI V0 implementation notes

This repository contains the deliberately small V0 implementation of Dark Kitchen AI. The project is a local supervisor, not a hosted agent platform.

## Architecture

- GitHub Issues and native issue dependencies are the durable product graph.
- Dark Kitchen AI reads GitHub through the authenticated `gh` CLI and native dependency REST endpoints when the installed `gh` version does not expose dependency JSON fields directly.
- Orca owns the repository registration, isolated worktrees, and workflow terminals.
- `codex-workflow` runs the generated issue workflow and its role-routed subagents.
- The supervisor owns readiness, runtime metadata, PRs, checks, merges, issue closure, labels, retries, and notifications.
- `.factory/runtime/` is ephemeral and ignored by Git; `.factory/config.json` and generated workflow files are committed project configuration.

## V0 phases

1. CLI skeleton, configuration, repository detection, and Doctor.
2. GitHub DAG loading, labels, readiness, cycles, and status.
3. Orca worktree/terminal launch and local runtime records.
4. Dynamic workflow execution, role routing, and strict worker results.
5. PR/check/merge/close transitions and dependency rescans.
6. Human escalation, macOS notifications, preserved worktrees, and retries.
7. Bootstrap, packaging, open-source documentation, and focused tests.

## Compatibility rule

External CLIs evolve. Keep their command shapes in the small adapters under `src/`, prefer machine-readable output, and verify behavior with the installed versions before changing flags. If an installed tool differs from the documented examples, record the difference in the README and keep the failure message actionable.

## Deliberate boundaries

No cloud service, MCP server, custom backlog database, remote execution, Kubernetes layer, or generic provider plugin system belongs in V0. Role-based routing remains first-class because cost/quality selection is part of the intended workflow, but it uses only the backends supported by the installed codex-dynamic-workflows runtime.
