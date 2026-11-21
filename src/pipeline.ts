import { gatherContext, type RepoContext } from "./context.js";
import { exec, tail } from "./exec.js";
import { runGate, type GateResult } from "./gates.js";
import {
  commitStaged,
  createWorktree,
  discardUnstaged,
  isUnchanged,
  removeWorktree,
  removeWorktreeAndBranch,
  stageAll,
  stagedDiff,
  stagedStat,
} from "./git.js";
import type { Helper } from "./helper-index.js";
import { buildPlanPrompt } from "./plan.js";
import { formatFindings, parseFindings, requestReview } from "./review.js";
import { checkSlop, describeBlockingSlop, reviewerHints, type SlopReport } from "./slop.js";
import type { AgentAdapter, Config, Finding, Usage } from "./types.js";
import { buildWriterPrompt } from "./writer-prompt.js";

export interface PipelineInput {
  task: string;
  runId: string;
  repoRoot: string;
  baseRef: string;
  config: Config;
  writer: AgentAdapter;
  reviewer: AgentAdapter;
  planner?: AgentAdapter;
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
  /** Missing when the run ended with nothing written, since its branch is removed then. */
  branch?: string;
  /** Set when the run stopped short with work in it, so a human can inspect that work in place. */
  worktreePath?: string;
  sameVendorReview: boolean;
  /** The reviewer is the writer's own agent on the same model, so only the fresh run separates them. */
  sameModelReview: boolean;
  setupFailure?: string;
  /** Existing helpers the writer was pointed to before it started. */
  suggestedHelpers: Helper[];
  /** The planner's plan, when a planner is configured and it produced one. */
  plan?: string;
  /** Why there is no plan although a planner is configured. The run carries on without one. */
  planFailure?: string;
  plannerUsage?: Usage;
  attempts: Attempt[];
}

/** Runs the setup commands in a fresh worktree. Returns what went wrong, or undefined when all passed. */
export async function runSetup(config: Config, cwd: string): Promise<string | undefined> {
  for (const command of config.setup) {
    const result = await exec(command, [], { cwd, shell: true, timeoutMs: config.gateTimeoutMs });
    if (result.exitCode !== 0) {
      return `Setup command "${command}" failed:\n${tail(result.stderr || result.stdout, 2000)}`;
    }
  }
  return undefined;
}

/** What the last attempt left behind: why it failed and the change it had made. */
interface PreviousAttempt {
  feedback?: string;
  diff?: string;
}

const STUCK_WRITER =
  "The writer answered the feedback with exactly the change it made before, so another attempt would end the same way.";

async function runAttempt(
  input: PipelineInput,
  cwd: string,
  briefing: { context: RepoContext; plan?: string },
  number: number,
  previous: PreviousAttempt,
): Promise<Attempt> {
  const { config } = input;
  const attempt: Attempt = { number, filesChanged: [], linesChanged: 0, gates: [], findings: [] };
  const fail = (stage: AttemptFailure["stage"], detail: string, retryable = true): Attempt => {
    attempt.failure = { stage, detail, retryable };
    return attempt;
  };

  const written = await input.writer.run({
    prompt: buildWriterPrompt({ task: input.task, config, feedback: previous.feedback, ...briefing }),
    cwd,
    model: config.writerModel,
    effort: config.writerEffort,
    readOnly: false,
    allowedCommands: config.gates.map((gate) => gate.command),
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
  if (previous.diff !== undefined && (await stagedDiff(cwd)) === previous.diff) {
    return fail("writer", STUCK_WRITER, false);
  }
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

  const reviewed = await requestReview(input.reviewer, config, cwd, {
    task: input.task,
    diff: await stagedDiff(cwd),
    plan: briefing.plan,
    conventions: briefing.context.conventions,
    hints: reviewerHints(attempt.slop),
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

/** Asks the planner for a plan. A planner that fails costs the run its plan, not its life. */
async function makePlan(input: PipelineInput, cwd: string, context: RepoContext, outcome: RunOutcome): Promise<void> {
  if (!input.planner) return;
  const planned = await input.planner.run({
    prompt: buildPlanPrompt(input.task, context),
    cwd,
    model: input.config.plannerModel,
    effort: input.config.plannerEffort,
    readOnly: true,
    timeoutMs: input.config.agentTimeoutMs,
  });
  await discardUnstaged(cwd);
  outcome.plannerUsage = planned.usage;
  if (planned.status === "ok" && planned.finalMessage.trim() !== "") {
    outcome.plan = planned.finalMessage.trim();
  } else {
    outcome.planFailure = `The planner ended with status "${planned.status}". ${tail(planned.finalMessage, 500)}`.trim();
  }
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
    sameModelReview: input.writer.id === input.reviewer.id && config.writerModel === config.reviewerModel,
    suggestedHelpers: [],
    attempts: [],
  };

  outcome.setupFailure = await runSetup(config, worktree.path);
  if (outcome.setupFailure) return outcome;

  const context = await gatherContext(worktree.path, task);
  outcome.suggestedHelpers = context.helpers;
  await makePlan(input, worktree.path, context, outcome);
  const briefing = { context, plan: outcome.plan };

  let previous: PreviousAttempt = {};
  for (let number = 1; number <= config.maxIterations; number++) {
    const attempt = await runAttempt(input, worktree.path, briefing, number, previous);
    outcome.attempts.push(attempt);
    if (!attempt.failure) {
      await commitStaged(worktree.path, commitMessage(task));
      await removeWorktree(repoRoot, worktree.path);
      return { ...outcome, status: "passed", worktreePath: undefined };
    }
    if (!attempt.failure.retryable) break;
    previous = { feedback: attempt.failure.detail, diff: await stagedDiff(worktree.path) };
  }
  // A run that wrote nothing has nothing to inspect, so it should not leave a worktree and a branch behind.
  if (await isUnchanged(worktree.path)) {
    await removeWorktreeAndBranch(repoRoot, worktree);
    return { ...outcome, branch: undefined, worktreePath: undefined };
  }
  return outcome;
}
