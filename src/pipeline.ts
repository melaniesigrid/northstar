import { exec, tail } from "./exec.js";
import { runGate, type GateResult } from "./gates.js";
import {
  commitStaged,
  createWorktree,
  discardUnstaged,
  removeWorktree,
  stageAll,
  stagedDiff,
  stagedStat,
} from "./git.js";
import { buildReviewPrompt, formatFindings, parseFindings } from "./review.js";
import { checkSlop, describeBlockingSlop, type SlopReport } from "./slop.js";
import type { AgentAdapter, Config, Finding, Usage } from "./types.js";

export interface PipelineInput {
  task: string;
  runId: string;
  repoRoot: string;
  baseRef: string;
  config: Config;
  writer: AgentAdapter;
  reviewer: AgentAdapter;
}

export interface AttemptFailure {
  stage: "writer" | "scope" | "slop" | "gate" | "review";
  detail: string;
  /** False when another writer attempt cannot fix the problem. */
  retryable: boolean;
}

export interface Attempt {
  number: number;
  filesChanged: string[];
  linesChanged: number;
  /** Absent when the attempt stopped before the slop checks. */
  slop?: SlopReport;
  gates: GateResult[];
  findings: Finding[];
  writerUsage?: Usage;
  reviewerUsage?: Usage;
  failure?: AttemptFailure;
}

export interface RunOutcome {
  runId: string;
  task: string;
  status: "passed" | "needs_human";
  branch: string;
  /** Set when the run stopped short, so a human can inspect the work in place. */
  worktreePath?: string;
  sameVendorReview: boolean;
  setupFailure?: string;
  attempts: Attempt[];
}

const WRITER_RULES = `Rules for this change:
- Change only what the task needs.
- Reuse existing helpers and follow the conventions already in this repo.
- Do not add comments that restate the code.
- Do not commit. Leave your changes in the working directory.`;

function buildWriterPrompt(task: string, feedback: string | undefined): string {
  const parts = [task, WRITER_RULES];
  if (feedback) {
    parts.push(`Your previous attempt was rejected. Fix this and keep the rest of your work:\n${feedback}`);
  }
  return parts.join("\n\n");
}

async function runSetup(config: Config, cwd: string): Promise<string | undefined> {
  for (const command of config.setup) {
    const result = await exec(command, [], { cwd, shell: true, timeoutMs: config.gateTimeoutMs });
    if (result.exitCode !== 0) {
      return `Setup command "${command}" failed:\n${tail(result.stderr || result.stdout, 2000)}`;
    }
  }
  return undefined;
}

async function runAttempt(
  input: PipelineInput,
  cwd: string,
  number: number,
  feedback: string | undefined,
): Promise<Attempt> {
  const { config } = input;
  const attempt: Attempt = { number, filesChanged: [], linesChanged: 0, gates: [], findings: [] };
  const fail = (stage: AttemptFailure["stage"], detail: string, retryable = true): Attempt => {
    attempt.failure = { stage, detail, retryable };
    return attempt;
  };

  const written = await input.writer.run({
    prompt: buildWriterPrompt(input.task, feedback),
    cwd,
    model: config.writerModel,
    readOnly: false,
    timeoutMs: config.agentTimeoutMs,
  });
  attempt.writerUsage = written.usage;
  if (written.status !== "ok") {
    const detail = `The writer agent ended with status "${written.status}". ${tail(written.finalMessage, 2000)}`;
    return fail("writer", detail, false);
  }

  await stageAll(cwd);
  const stat = await stagedStat(cwd);
  attempt.filesChanged = stat.files;
  attempt.linesChanged = stat.linesChanged;
  if (stat.files.length === 0) {
    return fail("scope", "No files were changed. Make the change the task asks for.");
  }
  if (stat.linesChanged > config.maxChangedLines) {
    return fail(
      "scope",
      `The change touches ${stat.linesChanged} lines and the budget is ${config.maxChangedLines}. Reduce it to what the task needs.`,
    );
  }

  attempt.slop = await checkSlop(cwd, config);
  const blockingSlop = describeBlockingSlop(attempt.slop, config);
  if (blockingSlop) return fail("slop", blockingSlop);

  for (const gate of config.gates) {
    const result = await runGate(gate, cwd, config.gateTimeoutMs);
    attempt.gates.push(result);
    if (!result.passed) break;
  }
  // Gates check, they do not fix: anything a gate wrote is dropped.
  await discardUnstaged(cwd);
  const failedGate = attempt.gates.find((gate) => !gate.passed);
  if (failedGate) {
    return fail("gate", `The "${failedGate.name}" gate failed:\n${failedGate.output}`);
  }

  const reviewed = await input.reviewer.run({
    prompt: buildReviewPrompt(input.task, await stagedDiff(cwd), attempt.slop.unreferenced),
    cwd,
    model: config.reviewerModel,
    readOnly: true,
    timeoutMs: config.agentTimeoutMs,
  });
  attempt.reviewerUsage = reviewed.usage;
  // Enforces read-only review even for agents that cannot be sandboxed.
  await discardUnstaged(cwd);
  if (reviewed.status !== "ok") {
    return fail("review", `The reviewer agent ended with status "${reviewed.status}".`, false);
  }
  const review = parseFindings(reviewed.finalMessage);
  if (!review.ok) return fail("review", review.reason, false);

  attempt.findings = review.findings;
  const blocking = review.findings.filter((finding) => finding.severity === "blocking");
  if (blocking.length > 0) {
    return fail("review", `The reviewer blocked the change:\n${formatFindings(blocking)}`);
  }
  return attempt;
}

function commitMessage(task: string): string {
  const firstLine = task.split("\n")[0] ?? task;
  return firstLine.slice(0, 72);
}

/**
 * Writer, then built-in slop checks, then hard gates, then an outside review. A failure loops back to the
 * writer with the exact reason, up to `maxIterations`. Thresholds are never
 * relaxed to make a run pass: when attempts run out, a human decides.
 */
export async function runPipeline(input: PipelineInput): Promise<RunOutcome> {
  const { config, repoRoot, runId, task } = input;
  const worktree = await createWorktree(repoRoot, runId, input.baseRef);
  const outcome: RunOutcome = {
    runId,
    task,
    status: "needs_human",
    branch: worktree.branch,
    worktreePath: worktree.path,
    sameVendorReview: input.writer.vendor === input.reviewer.vendor,
    attempts: [],
  };

  outcome.setupFailure = await runSetup(config, worktree.path);
  if (outcome.setupFailure) return outcome;

  let feedback: string | undefined;
  for (let number = 1; number <= config.maxIterations; number++) {
    const attempt = await runAttempt(input, worktree.path, number, feedback);
    outcome.attempts.push(attempt);
    if (!attempt.failure) {
      await commitStaged(worktree.path, commitMessage(task));
      await removeWorktree(repoRoot, worktree);
      return { ...outcome, status: "passed", worktreePath: undefined };
    }
    if (!attempt.failure.retryable) break;
    feedback = attempt.failure.detail;
  }
  return outcome;
}
