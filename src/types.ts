export interface RunSpec {
  prompt: string;
  /** The isolated git worktree the agent works in. */
  cwd: string;
  model?: string;
  /** Reviewers never write. Adapters enforce this where the CLI allows it. */
  readOnly: boolean;
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

export const FINDING_RULES = ["reuse", "simplicity", "naming", "comments", "tests", "scope"] as const;
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
  writerModel?: string;
  reviewerModel?: string;
  maxIterations: number;
  maxChangedLines: number;
  /** Commands run once in the fresh worktree, such as installing dependencies. */
  setup: string[];
  gates: GateConfig[];
  agentTimeoutMs: number;
  gateTimeoutMs: number;
}
