export const EFFORTS = ["low", "medium", "high"] as const;
/** How hard the model should think. Each adapter maps it to its CLI's own setting. */
export type Effort = (typeof EFFORTS)[number];

export interface RunSpec {
  prompt: string;
  /** The isolated git worktree the agent works in. */
  cwd: string;
  model?: string;
  effort?: Effort;
  /** Planners and reviewers never write. Adapters enforce this where the CLI allows it. */
  readOnly: boolean;
  /** Shell commands a writing agent may run on its own, such as the gates it will be judged by. */
  allowedCommands?: string[];
  /** JSON Schema the final answer must match, enforced through the CLI's structured output. */
  outputSchema?: object;
  timeoutMs: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface RunResult {
  status: "ok" | "failed" | "timeout";
  finalMessage: string;
  usage?: Usage;
  sessionId?: string;
  /** Vendor output, kept for the audit log. */
  raw: unknown;
}

/**
 * The contract every coding agent sits behind. The core never branches on
 * `id`; `vendor` exists only so a run can report whether writer and reviewer
 * come from different vendors.
 */
export interface AgentAdapter {
  id: string;
  vendor: string;
  detect(): Promise<{ installed: boolean; version?: string }>;
  run(spec: RunSpec): Promise<RunResult>;
}

export const FINDING_RULES = ["reuse", "simplicity", "naming", "comments", "tests", "scope", "performance"] as const;
export type FindingRule = (typeof FINDING_RULES)[number];

export interface Finding {
  severity: "blocking" | "advisory";
  rule: FindingRule;
  file: string;
  line: number;
  explanation: string;
  suggestedFix?: string;
}

export interface GateConfig {
  name: string;
  command: string;
}

export interface Config {
  writer: string;
  reviewer: string;
  /** Optional agent that turns the task into a short plan before the writer starts. */
  planner?: string;
  writerModel?: string;
  reviewerModel?: string;
  plannerModel?: string;
  writerEffort?: Effort;
  reviewerEffort?: Effort;
  plannerEffort?: Effort;
  /** What the writer is told about the repo: only hand-written rules, or the scanned conventions too. */
  writerConventions: "notes" | "all";
  maxIterations: number;
  maxChangedLines: number;
  /** Added code that repeats this many consecutive meaningful lines from elsewhere is blocked. */
  minDuplicateLines: number;
  /** How many new lint or type suppressions a change may add before it is blocked. */
  maxNewSuppressions: number;
  /** Commands run once in the fresh worktree, such as installing dependencies. */
  setup: string[];
  gates: GateConfig[];
  agentTimeoutMs: number;
  gateTimeoutMs: number;
}
