---
name: dark-kitchen-issues
description: Plan and maintain Dark Kitchen AI GitHub Issues as a native dependency graph. Use when turning a product discussion into executable issues, explaining Dark Kitchen labels and dependencies, creating or replanning issue DAGs, resolving human blockers, or checking whether work is safe for autonomous execution.
---

# Dark Kitchen Issues

Act as the product-planning companion for Dark Kitchen AI. Turn product conversations into small, testable GitHub Issues that the local Dark Kitchen AI supervisor can execute without changing the roadmap.

## Source of truth

- Treat GitHub Issues, labels, and native Issue Dependencies as canonical.
- Never use `Depends on #123`, `Blocked by #123`, or similar Markdown text as the dependency graph. Body text may explain context, but dependencies must be native GitHub edges.
- Read the current issue state before editing it. Do not trust an old conversation summary when the repository has changed.
- Keep product requirements in issue bodies. Keep runtime state in the labels managed by Dark Kitchen AI.

## Labels

Use only these labels:

| Label | Use | Who owns it |
| --- | --- | --- |
| `dark-kitchen:auto` | The issue is approved for autonomous execution. | Human/ChatGPT |
| `dark-kitchen:running` | A worker is currently executing it. | Dark Kitchen AI supervisor |
| `dark-kitchen:needs-human` | A real requirement, access, destructive-action, or repeated-failure blocker needs a human. | Supervisor; human resolves it |
| `dark-kitchen:failed` | The bounded worker retry was exhausted. | Supervisor |

Do not add `dark-kitchen:auto` when the requirement is materially ambiguous, destructive, under-specified, or dependent on an unavailable credential. Do not manually add `dark-kitchen:running` or `dark-kitchen:failed` to simulate execution.

To resume a human-blocked issue, update the requirement or dependencies, then remove `dark-kitchen:needs-human` while leaving the issue open and marked `dark-kitchen:auto`. A fresh worker run will reread the issue; it must not rely on stale model context.

## Plan a product discussion

When the user describes a feature:

1. Extract the user-visible outcome, constraints, acceptance criteria, non-goals, and unresolved decisions.
2. Check existing issues before creating duplicates. Prefer updating or replacing a stale issue over creating a parallel copy.
3. Split the work into vertical, independently verifiable slices. Keep each issue small enough for one workflow run.
4. Identify the native dependency edges. A dependency means the downstream issue cannot be completed meaningfully until the upstream issue is closed.
5. Detect cycles before writing the graph. Refuse to create or recommend a cyclic graph.
6. Mark only clearly autonomous issues with `dark-kitchen:auto`. Leave ambiguous or human-dependent issues unmarked and explain why.
7. Show the proposed issue graph and label changes before making mutations unless the user explicitly asked to create or update the issues.

Prefer this shape for each issue:

```markdown
## Goal
<user-visible result>

## Context
<why this matters and relevant constraints>

## Acceptance criteria
- [ ] <observable criterion>
- [ ] <observable criterion>

## Validation
- <test, command, or manual verification>

## Out of scope
- <nearby work that belongs to another issue>
```

Use imperative, specific titles such as `Add batch export endpoint` rather than vague titles such as `Backend work`.

## Dependency graph rules

Use a topological order. Independent issues may run in parallel. A downstream issue becomes ready only when:

- it is open;
- it has `dark-kitchen:auto`;
- it is not running, failed, or marked `dark-kitchen:needs-human`;
- every native blocking issue is closed.

Example:

```text
#1 Define the data contract ─┐
                             ├─→ #3 Implement the importer ─→ #5 Release the feature
#2 Add fixture coverage ─────┘                         
#4 Add deployment configuration ─────────────────────→ #5
```

Do not mark a downstream issue autonomous merely because its dependency is closed. If a closed dependency was never planned for autonomous execution, surface that concern to the user instead of silently treating the roadmap as valid.

## Creating and editing issues

When GitHub access is available, use the repository's native issue and dependency operations. After mutations, report:

- issue number, title, and URL;
- labels added or removed;
- native dependencies created or removed;
- unresolved decisions and why an issue was or was not marked `dark-kitchen:auto`.

When GitHub access is unavailable, produce copy-paste-ready issue bodies and an explicit dependency/label table. Do not pretend that issues were created.

Never:

- change acceptance criteria just to make implementation easier;
- close an issue because an agent produced plausible prose;
- launch another issue from inside an issue plan;
- remove a human blocker without resolving the underlying question;
- use an issue body as a substitute for a native dependency edge.

## Human blockers

Escalate to the human when there are multiple materially different product behaviors, the requirement appears impossible, required access is unavailable, an irreversible action needs approval, or reasonable implementation attempts repeatedly fail. Ordinary bugs, failing tests, file choices, and normal debugging are worker responsibilities.

When resolving a blocker, preserve the original decision in the issue body or a comment, update acceptance criteria if needed, adjust native dependencies, remove `dark-kitchen:needs-human`, and keep `dark-kitchen:auto` only if the resulting issue is genuinely safe to run.

## Response format

For a planning response, finish with:

1. A concise graph using issue numbers when they already exist.
2. A table of labels and autonomous eligibility.
3. Explicit open questions.
4. The next safe action: create, update, replan, or wait for human input.

For a completed GitHub mutation, summarize exactly what changed and what Dark Kitchen AI will do next.
