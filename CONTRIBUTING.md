# Contributing to Dark Kitchen AI

Thanks for helping make the workflow safer and more useful. Dark Kitchen AI is intentionally small: prefer a direct, testable change over a new abstraction.

## Local setup

```bash
git clone https://github.com/matpeltier/dark-kitchen-ai.git
cd dark-kitchen-ai
npm install
```

You can run the CLI from source with `npm run dev -- --help` or link the built package with `npm run build && npm link`.

## Before opening a pull request

Run all of the following:

```bash
npm run typecheck
npm test
npm run build
npm run pack:check
```

Tests should mock GitHub, Orca, and worker commands. Do not require personal credentials, a live GitHub repository, or an LLM in the test suite.

## Design boundaries

- GitHub Issues and native dependencies remain the durable source of truth.
- Orca remains the top-level worktree/runtime manager.
- codex-dynamic-workflows remains the workflow runtime.
- Role-based provider routing is supported; a general plugin framework is out of scope for V0.
- Workers must not merge PRs, close unrelated issues, or change the product roadmap.
- New generated files must preserve unrelated user content, especially `AGENTS.md`.

Please include the user-visible behavior, tests, and any CLI/version compatibility notes in the pull request description.

## Security

Never commit API keys, tokens, private issue data, runtime results, or machine-specific credentials. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
