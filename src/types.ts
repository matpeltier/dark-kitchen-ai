import { z } from "zod";

export const DARK_KITCHEN_LABELS = [
  "dark-kitchen:auto",
  "dark-kitchen:running",
  "dark-kitchen:needs-human",
  "dark-kitchen:failed",
] as const;

export const DARK_KITCHEN_LABEL = {
  auto: "dark-kitchen:auto",
  running: "dark-kitchen:running",
  needsHuman: "dark-kitchen:needs-human",
  failed: "dark-kitchen:failed",
} as const;

export type DarkKitchenLabel = (typeof DARK_KITCHEN_LABELS)[number];

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<CommandResult>;

export type CommandSpec = {
  command: string;
  args: string[];
};

export type IssueDependency = {
  number: number;
  title?: string;
  state?: string;
  url?: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED" | string;
  labels: string[];
  blockedBy: IssueDependency[];
  blocking: IssueDependency[];
  url?: string;
  closedAt?: string | null;
};

export type GraphWarning = {
  issueNumber: number;
  dependencyNumber: number;
  message: string;
};

export type IssueGraph = {
  issues: GitHubIssue[];
  byNumber: Map<number, GitHubIssue>;
  cycles: number[][];
  closedNotPlanned: GraphWarning[];
};

export type ProviderConfig = {
  backend: "codex" | "gemini" | "pi" | string;
  model: string;
  reasoning?: string;
  thinking?: string;
  baseUrl?: string;
  api?: string;
  apiKeyEnv?: string;
  [key: string]: unknown;
};

export type RoleConfig = {
  provider: string;
  model?: string;
  prompt?: string;
  agentType?: string;
  skills?: string[];
  mcp?: string[];
};

export type WorkflowProfile = {
  roles: string[];
  plan?: "auto" | "always" | "never";
  prompt?: string;
  planRole?: string;
  implementationRole?: string;
  reviewRole?: string;
  fixRole?: string;
};

export type FactoryConfig = {
  version: 3;
  maxParallelIssues: number;
  pollIntervalSeconds: number;
  autoMerge: boolean;
  baseBranch: string;
  workflowCommand: string;
  orca: CommandSpec;
  workflowFile: string;
  workflowConfig: string;
  maxWorkflowRetries: number;
  checkTimeoutSeconds: number;
  roles: Record<string, RoleConfig>;
  workflows: Record<string, WorkflowProfile>;
  providers: Record<string, ProviderConfig>;
};

export const WorkerResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    summary: z.string(),
    tests: z.array(z.string()),
    reviewSummary: z.string(),
  }),
  z.object({
    status: z.literal("needs_human"),
    category: z.enum([
      "requirement_ambiguity",
      "requirement_impossible",
      "missing_access",
      "destructive_action",
      "repeated_failure",
    ]),
    summary: z.string(),
    question: z.string(),
    recommendation: z.string().optional(),
    evidence: z.array(z.string()).optional(),
  }),
  z.object({
    status: z.literal("failed"),
    summary: z.string(),
    attempts: z.array(z.string()),
  }),
]);

export type WorkerResult = z.infer<typeof WorkerResultSchema>;

export type RuntimeStatus =
  | "running"
  | "needs_human"
  | "failed"
  | "completed"
  | "pr_open";

export type RuntimeRecord = {
  issueNumber: number;
  issueTitle: string;
  status: RuntimeStatus;
  attempt: number;
  startedAt: string;
  updatedAt: string;
  worktreeId: string;
  worktreePath: string;
  branch: string;
  terminalHandle?: string;
  workflowRunId?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  checkSummary?: string;
  lastError?: string;
  resultPath: string;
  attempts?: string[];
};

export type OrcaWorktree = {
  id: string;
  path: string;
  branch?: string;
  startupTerminal?: { handle?: string };
};

export type OrcaRepo = {
  id: string;
  path?: string;
  name?: string;
};

export type PullRequest = {
  number: number;
  url: string;
  state?: string;
};
