import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runGate } from "./gates.js";
import { createDetachedWorktree, removeWorktree, stageAll, stagedStat } from "./git.js";
import { runPipeline, runSetup, type PipelineInput } from "./pipeline.js";
import { checkSlop, countReviewerSignals, describeBlockingSlop, type SlopReport } from "./slop.js";
import type { Usage } from "./types.js";

export interface BenchTask {
  id: string;
  prompt: string;
  /** The commit the agent starts from. */
  baseCommit: string;
}

/** One way of doing a task: the writer on its own, or the writer inside the pipeline. */
export interface ArmResult {
  /** Whether every configured gate passed on the final change. */
  gatesPassed: boolean;
  /** Undefined when the arm produced nothing to check. */
  slop?: SlopReport;
  /** Gates passed and no hard slop check failed. The same test for both arms. */
  clean: boolean;
  linesChanged: number;
  /** Times the writer was asked to write. Always 1 for the raw arm. */
  attempts: number;
  usage: Usage;
  seconds: number;
  /** What stopped the arm early, if anything did. */
  note?: string;
}

export interface TaskResult {
  task: BenchTask;
  raw: ArmResult;
  pipeline: ArmResult;
  /** Whether the pipeline's reviewer also approved, which the raw arm has no equivalent for. */
  pipelinePassed: boolean;
}

export type BenchInput = Omit<PipelineInput, "task" | "baseRef" | "runId"> & { benchId: string };

const RAW_PROMPT_SUFFIX = "Do not commit. Leave your changes in the working directory.";

/** Reads one task per folder: `task.md` holds the prompt, `meta.json` the commit to start from. */
export async function loadTasks(directory: string): Promise<BenchTask[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const tasks: BenchTask[] = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = path.join(directory, entry.name);
    const prompt = await readFile(path.join(folder, "task.md"), "utf8").catch(() => undefined);
    if (prompt === undefined) throw new Error(`Benchmark: ${folder} has no task.md.`);
    const meta = await readFile(path.join(folder, "meta.json"), "utf8").catch(() => "{}");
    const { baseCommit } = JSON.parse(meta) as { baseCommit?: string };
    tasks.push({ id: entry.name, prompt: prompt.trim(), baseCommit: baseCommit ?? "HEAD" });
  }
  return tasks;
}

function addUsage(total: Usage, usage: Usage | undefined): Usage {
  if (!usage) return total;
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    costUsd: usage.costUsd === undefined ? total.costUsd : (total.costUsd ?? 0) + usage.costUsd,
  };
}

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };
const secondsSince = (startedAt: number): number => Math.round((Date.now() - startedAt) / 1000);

/** The writer alone: the task and nothing else, one shot, then the same checks the pipeline runs. */
async function runRawArm(input: BenchInput, task: BenchTask): Promise<ArmResult> {
  const { config } = input;
  const startedAt = Date.now();
  const worktree = await createDetachedWorktree(input.repoRoot, `${input.benchId}-raw-${task.id}`, task.baseCommit);
  const result: ArmResult = { gatesPassed: false, clean: false, linesChanged: 0, attempts: 1, usage: NO_USAGE, seconds: 0 };
  try {
    result.note = await runSetup(config, worktree);
    if (result.note) return result;

    const written = await input.writer.run({
      prompt: `${task.prompt}\n\n${RAW_PROMPT_SUFFIX}`,
      cwd: worktree,
      model: config.writerModel,
      effort: config.writerEffort,
      readOnly: false,
      timeoutMs: config.agentTimeoutMs,
    });
    result.usage = addUsage(NO_USAGE, written.usage);
    if (written.status !== "ok") {
      result.note = `The writer ended with status "${written.status}".`;
      return result;
    }

    await stageAll(worktree);
    result.linesChanged = (await stagedStat(worktree)).linesChanged;
    result.slop = await checkSlop(worktree, config);
    const gates = [];
    for (const gate of config.gates) gates.push(await runGate(gate, worktree, config.gateTimeoutMs));
    result.gatesPassed = gates.every((gate) => gate.passed);
    result.clean = result.gatesPassed && result.linesChanged > 0 && describeBlockingSlop(result.slop, config) === undefined;
    return result;
  } finally {
    result.seconds = secondsSince(startedAt);
    await removeWorktree(input.repoRoot, worktree);
  }
}

async function runPipelineArm(input: BenchInput, task: BenchTask): Promise<{ arm: ArmResult; passed: boolean }> {
  const startedAt = Date.now();
  const outcome = await runPipeline({
    ...input,
    task: task.prompt,
    baseRef: task.baseCommit,
    runId: `${input.benchId}-pipeline-${task.id}`,
  });
  const lastAttempt = outcome.attempts.at(-1);
  const gatesPassed =
    lastAttempt !== undefined &&
    lastAttempt.gates.length === input.config.gates.length &&
    lastAttempt.gates.every((gate) => gate.passed);
  const slopIsClean = lastAttempt?.slop !== undefined && describeBlockingSlop(lastAttempt.slop, input.config) === undefined;
  let usage = addUsage(NO_USAGE, outcome.plannerUsage);
  for (const attempt of outcome.attempts) usage = addUsage(addUsage(usage, attempt.writerUsage), attempt.reviewerUsage);

  return {
    passed: outcome.status === "passed",
    arm: {
      gatesPassed,
      slop: lastAttempt?.slop,
      clean: gatesPassed && slopIsClean,
      linesChanged: lastAttempt?.linesChanged ?? 0,
      attempts: outcome.attempts.length,
      usage,
      seconds: secondsSince(startedAt),
      note: outcome.setupFailure ?? lastAttempt?.failure?.detail.split("\n")[0],
    },
  };
}

/**
 * Runs every task twice from the same commit: once with the writer on its own
 * and once through the pipeline. Both results are scored by the same gates and
 * slop checks, so the difference is what the pipeline adds.
 */
export async function runBenchmark(input: BenchInput, tasks: BenchTask[]): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  for (const task of tasks) {
    const raw = await runRawArm(input, task);
    const { arm: pipeline, passed: pipelinePassed } = await runPipelineArm(input, task);
    results.push({ task, raw, pipeline, pipelinePassed });
  }
  return results;
}

function armRow(taskId: string, armName: string, arm: ArmResult): string {
  const slop = arm.slop;
  const cost = arm.usage.costUsd === undefined ? "" : `$${arm.usage.costUsd.toFixed(2)}`;
  const cells = [
    taskId,
    armName,
    arm.clean ? "yes" : "no",
    arm.gatesPassed ? "passed" : "failed",
    arm.linesChanged,
    slop?.duplication.duplicatedLines ?? "",
    slop?.suppressions.length ?? "",
    slop === undefined ? "" : countReviewerSignals(slop),
    arm.attempts,
    arm.usage.inputTokens + arm.usage.outputTokens,
    cost,
    arm.seconds,
  ];
  return `| ${cells.join(" | ")} |`;
}

const count = (results: TaskResult[], predicate: (result: TaskResult) => boolean): number =>
  results.filter(predicate).length;

export function renderBenchmark(results: TaskResult[]): string {
  if (results.length === 0) return "No benchmark tasks found.\n";
  const total = results.length;
  const sections = [
    `# NorthStar benchmark of ${total} tasks`,
    [
      "Clean means every gate passed and no hard slop check failed. Both arms are held to the same test.",
      `- Writer alone: ${count(results, (result) => result.raw.clean)} of ${total} clean`,
      `- Through the pipeline: ${count(results, (result) => result.pipeline.clean)} of ${total} clean, ${count(results, (result) => result.pipelinePassed)} of ${total} also approved by the reviewer`,
    ].join("\n"),
    [
      "| Task | Arm | Clean | Gates | Lines changed | Duplicated | Suppressions | For review | Attempts | Tokens | Cost | Seconds |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...results.flatMap((result) => [
        armRow(result.task.id, "alone", result.raw),
        armRow(result.task.id, "pipeline", result.pipeline),
      ]),
    ].join("\n"),
  ];
  const notes = results.flatMap((result) => [
    result.raw.note && `- ${result.task.id}, alone: ${result.raw.note}`,
    result.pipeline.note && `- ${result.task.id}, pipeline: ${result.pipeline.note}`,
  ]);
  if (notes.some(Boolean)) sections.push(["What stopped a run:", ...notes.filter(Boolean)].join("\n"));
  return `${sections.join("\n\n")}\n`;
}
