export const meta = {
  name: "dark-kitchen-issue",
  description: "Run a configurable role-based workflow for one GitHub issue.",
  phases: [
    "Architecture / design",
    "Implementation",
    "Independent review",
    "Fix and reverify",
  ],
};

type RoleConfig = {
  provider: string;
  model?: string;
  prompt?: string;
  agentType?: string;
  skills?: string[];
  mcp?: string[];
};

type WorkflowProfile = {
  roles: string[];
  plan?: "auto" | "always" | "never";
  prompt?: string;
  planRole?: string;
  implementationRole?: string;
  reviewRole?: string;
  fixRole?: string;
};

type FactoryConfig = {
  roles: Record<string, RoleConfig>;
  workflows: Record<string, WorkflowProfile>;
  providers: Record<string, { model: string; reasoning?: string; thinking?: string }>;
};

type IssueInput = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  resultPath?: string;
};

const HUMAN_CATEGORIES = [
  "requirement_ambiguity",
  "requirement_impossible",
  "missing_access",
  "destructive_action",
];

const IMPLEMENTATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["success", "needs_human"] },
    summary: { type: "string" },
    question: { type: "string" },
    category: { type: "string", enum: HUMAN_CATEGORIES },
    recommendation: { type: "string" },
    tests: { type: "array", items: { type: "string" } },
  },
  required: ["status", "summary", "tests"],
};

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    hasBlockingFindings: { type: "boolean" },
    summary: { type: "string" },
    findings: { type: "array", items: { type: "string" } },
  },
  required: ["hasBlockingFindings", "summary", "findings"],
};

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["fixed", "needs_human"] },
    summary: { type: "string" },
    question: { type: "string" },
    category: { type: "string", enum: HUMAN_CATEGORIES },
    recommendation: { type: "string" },
  },
  required: ["status", "summary"],
};

const runtimeArgs = args as { inputPath: string; configPath: string };
const issue = await tool({ definition: "read-json", args: { path: runtimeArgs.inputPath } }) as IssueInput;
const factoryConfig = await tool({ definition: "read-json", args: { path: runtimeArgs.configPath } }) as FactoryConfig;
const skillContents = new Map<string, string | null>();
for (const role of Object.values(factoryConfig.roles)) {
  for (const skill of role.skills ?? []) {
    if (skillContents.has(skill)) continue;
    skillContents.set(skill, await tool({ definition: "read-skill", args: { name: skill } }) as string | null);
  }
}

function issueProfileName(): string {
  const section = issue.body.match(/(?:^|\n)##\s*Dark Kitchen workflow\s*\n([\s\S]*?)(?=\n##\s|$)/i)?.[1] ?? "";
  return section.match(/^\s*profile\s*:\s*([a-z0-9][a-z0-9_-]*)\s*$/im)?.[1] ?? "default";
}

function roleFor(profile: WorkflowProfile, roleName: string | undefined): { name: string; config: RoleConfig } | undefined {
  if (!roleName) return undefined;
  if (!profile.roles.includes(roleName)) throw new Error(`Workflow profile does not allow role ${roleName}`);
  const config = factoryConfig.roles[roleName];
  if (!config) throw new Error(`Workflow profile references missing role ${roleName}`);
  return { name: roleName, config };
}

function providerFor(role: { name: string; config: RoleConfig }): { model?: string; thinkingEffort?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" } {
  const provider = factoryConfig.providers[role.config.provider];
  const thinking = provider?.reasoning ?? provider?.thinking;
  const thinkingEffort = ["off", "minimal", "low", "medium", "high", "xhigh"].includes(thinking || "")
    ? thinking as "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
    : undefined;
  return {
    ...(role.config.model || provider?.model ? { model: role.config.model ?? provider?.model } : {}),
    ...(thinkingEffort ? { thinkingEffort } : {}),
  };
}

function roleInstructions(role: { name: string; config: RoleConfig }): string {
  const sections: string[] = [];
  if (role.config.prompt) sections.push(`Role instructions for ${role.name}:\n${role.config.prompt}`);
  const missingSkills: string[] = [];
  for (const skill of role.config.skills ?? []) {
    const content = skillContents.get(skill);
    if (!content) missingSkills.push(skill);
    else sections.push(`Skill ${skill}:\n${content.slice(0, 20000)}`);
  }
  if (missingSkills.length) throw new Error(`Role ${role.name} requires unavailable skills: ${missingSkills.join(", ")}`);
  if (role.config.mcp?.length) {
    sections.push(`MCP servers requested for this role: ${role.config.mcp.join(", ")}. Use them only if they are actually exposed in this session; never claim access that is not available.`);
  }
  return sections.join("\n\n");
}

async function runRole(
  role: { name: string; config: RoleConfig },
  prompt: string,
  phaseName: string,
  schema: unknown,
  iteration = 1,
): Promise<any> {
  const instructions = roleInstructions(role);
  const result = await agent({
    id: `${role.name}-${phaseName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${iteration}`,
    label: role.name,
    phase: phaseName,
    provider: "opencode",
    ...providerFor(role),
    ...(role.config.agentType ? { metadata: { opencodeAgent: role.config.agentType } } : {}),
    permissions: { mode: "dangerously-full-access" },
    schema,
    prompt: `${instructions}\n\n${prompt}`,
  });
  if (!result.ok || result.status !== "succeeded") return undefined;
  return result.json;
}

function warrantsArchitecture(): boolean {
  return /architecture|design|schema|migration|refactor|integration|api|database/i.test(`${issue.title}\n${issue.body}`)
    || issue.body.length > 900;
}

let finalResult: any;
try {
  const profileName = issueProfileName();
  const profile = factoryConfig.workflows[profileName];
  if (!profile) {
    finalResult = {
      status: "needs_human",
      category: "requirement_ambiguity",
      summary: `Issue requests unknown Dark Kitchen workflow profile: ${profileName}.`,
      question: `Should this issue use one of the configured profiles: ${Object.keys(factoryConfig.workflows).join(", ")}?`,
      recommendation: "Add or correct the workflow profile before retrying.",
      evidence: [`The issue declared profile: ${profileName}`],
    };
  }

  if (!finalResult) {
    const planRole = roleFor(profile!, profile!.planRole);
    const implementationRole = roleFor(profile!, profile!.implementationRole);
    const reviewRole = roleFor(profile!, profile!.reviewRole);
    const fixRole = roleFor(profile!, profile!.fixRole);
    if (!implementationRole) throw new Error(`Workflow profile ${profileName} has no implementationRole`);

    let architecture = profile!.prompt || "No separate architecture phase was needed for this issue.";
    const shouldPlan = Boolean(planRole) && profile!.plan !== "never" && (profile!.plan === "always" || warrantsArchitecture());
    if (shouldPlan && planRole) {
      phase("Architecture / design");
      const plan = await runRole(
        planRole,
        `Read AGENTS.md and the complete issue input JSON at ${runtimeArgs.inputPath}. The issue is #${issue.number}: ${issue.title}. Plan the smallest implementation that satisfies the stated acceptance criteria. Do not invent product requirements. Return needs_human only for a materially ambiguous or impossible requirement, missing access, or an action requiring explicit destructive approval.`,
        "Architecture / design",
        IMPLEMENTATION_SCHEMA,
      );
      if (!plan) {
        finalResult = { status: "failed", summary: "The planning role returned no structured result.", attempts: ["Planning role returned null after retries."] };
      } else if (plan.status === "needs_human") {
        finalResult = { status: "needs_human", category: plan.category, summary: plan.summary, question: plan.question, recommendation: plan.recommendation, evidence: [] };
      } else {
        architecture = plan.summary;
      }
    }

    if (!finalResult) {
      phase("Implementation");
      const implementation = await runRole(
        implementationRole,
        `You are the implementation owner for GitHub issue #${issue.number}: ${issue.title}. Read the complete issue input JSON at ${runtimeArgs.inputPath} for the original issue and acceptance criteria.\n\nArchitecture/design context:\n${architecture}\n\nRead AGENTS.md and inspect the repository. Implement only this issue. Run relevant tests, lint, and typecheck where configured. Do not change product requirements, launch other issues, or ask about routine coding/debugging choices. Before reporting success, inspect the final diff and commit meaningful changes on the current branch. Return needs_human only when a product decision, missing access/credential, impossible requirement, or explicit destructive approval is genuinely required. Tests, build failures, review findings, crashes, timeouts, and difficult debugging are engineering failures and must remain failed so the supervisor can retry.`,
        "Implementation",
        IMPLEMENTATION_SCHEMA,
      );
      if (!implementation) {
        finalResult = { status: "failed", summary: "The implementation role returned no structured result.", attempts: ["Implementation role returned null after retries."] };
      } else if (implementation.status === "needs_human") {
        finalResult = { status: "needs_human", category: implementation.category, summary: implementation.summary, question: implementation.question, recommendation: implementation.recommendation, evidence: implementation.tests };
      } else {
        let reviewSummary = reviewRole ? "No blocking review findings." : "No review role configured.";
        let tests = implementation.tests;
        const maxFixLoops = 2;
        let finalReviewPassed = !reviewRole;
        for (let reviewPass = 0; reviewRole; reviewPass += 1) {
          phase("Independent review");
          const review = await runRole(
            reviewRole,
            `Independently review issue #${issue.number} and the current preserved worktree. Read the complete issue input JSON at ${runtimeArgs.inputPath} and read AGENTS.md, git diff, committed changes, and test results. Check every acceptance criterion, correctness, regressions, and missing tests. Do not rewrite code in this review session. Return only actionable blocking findings. Review the current implementation independently from the implementer and fixer sessions.`,
            "Independent review",
            REVIEW_SCHEMA,
            reviewPass + 1,
          );
          if (!review) {
            finalResult = { status: "failed", summary: "The review role returned no structured result.", attempts: ["Review role returned null after retries."] };
            break;
          }
          reviewSummary = review.summary;
          if (!review.hasBlockingFindings) {
            finalReviewPassed = true;
            break;
          }
          if (!fixRole) {
            finalResult = { status: "failed", summary: "Blocking review findings remain but this workflow has no fix role.", attempts: review.findings };
            break;
          }
          if (reviewPass >= maxFixLoops) {
            finalResult = { status: "failed", summary: `Blocking review findings remain after ${maxFixLoops} fix loops and a final independent review.`, attempts: review.findings };
            break;
          }
          phase("Fix and reverify");
          const fixed = await runRole(
            fixRole,
            `You are the fixer for issue #${issue.number}. Read the complete issue input JSON at ${runtimeArgs.inputPath}. Continue in the existing preserved task worktree; do not restart the implementation from scratch.\n\nCurrent implementation and reviewer findings:\n- ${review.findings.join("\n- ")}\n\nResolve every blocking finding at its root cause, not merely the reported line. Inspect the surrounding subsystem for the same class of defect, verify that the fix preserves every acceptance criterion, rerun relevant tests/typecheck/lint/build, inspect the final diff adversarially, and commit the resulting changes. Do not ask for human input for routine engineering or debugging decisions. Return needs_human only for a genuine product decision, missing access/credential, impossible requirement, or explicit destructive approval.`,
            "Fix and reverify",
            FIX_SCHEMA,
            reviewPass + 1,
          );
          if (!fixed) {
            finalResult = { status: "failed", summary: "The fix role returned no structured result.", attempts: ["Fix role returned null after retries."] };
            break;
          }
          if (fixed.status === "needs_human") {
            finalResult = { status: "needs_human", category: fixed.category, summary: fixed.summary, question: fixed.question, recommendation: fixed.recommendation, evidence: review.findings };
            break;
          }
          tests = [...tests, fixed.summary];
        }
        if (!finalResult && finalReviewPassed) finalResult = { status: "success", summary: implementation.summary, tests, reviewSummary };
        if (!finalResult) finalResult = { status: "failed", summary: "The bounded review/fix workflow did not reach a verified result.", attempts: ["Review/fix orchestration ended without a passing final review."] };
      }
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  finalResult = /requires unavailable skills|unsafe skill name/i.test(message)
    ? { status: "needs_human", category: "missing_access", summary: message, question: "Should the missing role skill be installed or removed from this workflow profile?", recommendation: "Install the named skill in the project and retry the issue.", evidence: [] }
    : { status: "failed", summary: message, attempts: ["Workflow orchestration or an agent call failed."] };
}

if (!issue.resultPath) throw new Error("Workflow input is missing resultPath");
await tool({ definition: "write-json", args: { path: issue.resultPath, value: finalResult } });
export default finalResult;
