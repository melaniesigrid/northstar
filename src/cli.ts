#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { getAdapter, listAdapters } from "./adapters/index.js";
import { auditCommits, renderAudit } from "./audit.js";
import { loadTasks, renderBenchmark, runBenchmark } from "./bench.js";
import { calibrateReviewer, renderCalibration } from "./calibrate.js";
import { CONFIG_FILE, DEFAULT_SLOP_SETTINGS, loadConfig } from "./config.js";
import { findRepoRoot } from "./git.js";
import { runPipeline, type PipelineInput } from "./pipeline.js";
import { checkAgents, renderChecks, type AgentRole } from "./preflight.js";
import { loadProfile, PROFILE_FILE, renderConventions, scanRepo } from "./profile.js";
import { renderReport } from "./report.js";
import type { Config } from "./types.js";

const USAGE = `Usage:
  northstar run "<task>" [--config <file>] [--base <git ref>]
  northstar audit [--commits <n>] [--json]
  northstar bench [--tasks <folder>] [--config <file>]
  northstar calibrate [--commits <n>] [--config <file>]
  northstar profile
  northstar doctor [--live]

run      Writes the change in an isolated worktree, runs the gates, then has a
         second agent review it. Exits 0 when the change passed, 1 when a human
         needs to look.
audit    Scores the repo's recent commits with the slop checks. Needs no
         config and no agent, and never touches your checkout.
bench    Runs each benchmark task twice from the same commit, once with the
         writer alone and once through the pipeline, and compares the results.
         Tasks are read from benchmark/tasks unless --tasks says otherwise.
calibrate
         Shows your reviewer the repo's recent commits, which a person already
         accepted, and reports how many it would have blocked. Needs only the
         reviewer agent. Costs one review per commit, 10 commits by default.
profile  Scans the repo's conventions and writes them to ${PROFILE_FILE}
         for you to review, edit and commit. Your notes are kept on rescans.
doctor   Shows which agent CLIs are installed. With --live it also asks each
         agent for a one-word answer, which proves it is signed in and that its
         model name is accepted. That costs one small model call per agent.`;

function newRunId(): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

function agentsFor(config: Config): Pick<PipelineInput, "writer" | "reviewer" | "planner"> {
  return {
    writer: getAdapter(config.writer),
    reviewer: getAdapter(config.reviewer),
    planner: config.planner === undefined ? undefined : getAdapter(config.planner),
  };
}

/** The agents a config names, each with the job and model it is set to. */
function configuredRoles(config: Config): AgentRole[] {
  const { planner, writer, reviewer } = agentsFor(config);
  const roles: AgentRole[] = [
    { role: "writer", adapter: writer, model: config.writerModel },
    { role: "reviewer", adapter: reviewer, model: config.reviewerModel },
  ];
  if (planner) roles.unshift({ role: "planner", adapter: planner, model: config.plannerModel });
  return roles;
}

async function loadConfigIfPresent(file: string): Promise<Config | undefined> {
  const exists = await access(file).then(() => true, () => false);
  return exists ? loadConfig(file) : undefined;
}

/** Checks the configured agents when the repo has a config, and every installed agent when it has none. */
async function doctorLive(options: { config?: string }): Promise<number> {
  const repoRoot = await findRepoRoot(process.cwd()).catch(() => undefined);
  const configFile = options.config ?? (repoRoot === undefined ? undefined : path.join(repoRoot, CONFIG_FILE));
  const config = configFile === undefined ? undefined : await loadConfigIfPresent(configFile);
  const roles = config
    ? configuredRoles(config)
    : listAdapters().map((adapter) => ({ role: "not configured", adapter }));

  const checks = await checkAgents(roles, repoRoot ?? process.cwd());
  console.log(`\n${renderChecks(checks)}`);
  return checks.every((check) => check.ready) ? 0 : 1;
}

async function doctor(options: { live?: boolean; config?: string }): Promise<number> {
  for (const adapter of listAdapters()) {
    const { installed, version } = await adapter.detect();
    console.log(`${adapter.id}: ${installed ? `installed (${version})` : "not found on PATH"}`);
  }
  if (options.live) return doctorLive(options);
  console.log("\nInstalled is not the same as signed in. `northstar doctor --live` checks that with one small model call per agent.");
  return 0;
}

/** Says which agent is not ready, so the caller can stop before spending anything on real work. */
async function agentsAreReady(roles: AgentRole[], cwd: string): Promise<boolean> {
  const checks = await checkAgents(roles, cwd);
  const ready = checks.every((check) => check.ready);
  if (!ready) console.error(`Nothing was started because an agent is not ready.\n\n${renderChecks(checks)}`);
  return ready;
}

/** Keeps the report and the data behind it in one folder, and shows the report. */
async function saveAndPrint(folder: string, report: string, dataFile: string, data: unknown): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "report.md"), report);
  await writeFile(path.join(folder, dataFile), JSON.stringify(data, null, 2));
  console.log(report);
}

function parseCommitCount(value: string | undefined, fallback: number): number {
  const count = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(count) || count < 1) throw new Error("--commits must be a whole number, 1 or more.");
  return count;
}

const DEFAULT_TASKS_FOLDER = path.join("benchmark", "tasks");

async function bench(options: { tasks?: string; config?: string }): Promise<number> {
  const repoRoot = await findRepoRoot(process.cwd());
  const config = await loadConfig(options.config ?? path.join(repoRoot, CONFIG_FILE));
  const tasks = await loadTasks(path.resolve(repoRoot, options.tasks ?? DEFAULT_TASKS_FOLDER));
  const benchId = newRunId();

  // A benchmark with a signed-out agent would spend an hour producing a table of failures.
  if (!(await agentsAreReady(configuredRoles(config), repoRoot))) return 2;
  console.error(`Running ${tasks.length} tasks twice each. This uses your agents and can take a while.`);

  const results = await runBenchmark({ benchId, repoRoot, config, ...agentsFor(config) }, tasks);
  await saveAndPrint(path.join(repoRoot, ".northstar", "bench", benchId), renderBenchmark(results), "results.json", results);
  return 0;
}

const DEFAULT_CALIBRATION_COMMITS = 10;

async function calibrate(options: { commits?: string; config?: string }): Promise<number> {
  const maxCommits = parseCommitCount(options.commits, DEFAULT_CALIBRATION_COMMITS);
  const repoRoot = await findRepoRoot(process.cwd());
  const config = await loadConfig(options.config ?? path.join(repoRoot, CONFIG_FILE));
  const reviewer = getAdapter(config.reviewer);
  const calibrationId = newRunId();

  if (!(await agentsAreReady([{ role: "reviewer", adapter: reviewer, model: config.reviewerModel }], repoRoot))) return 2;
  console.error(`Reviewing up to ${maxCommits} commits, one review each. This uses your reviewer agent.`);

  const reviews = await calibrateReviewer({ repoRoot, config, reviewer, maxCommits, calibrationId });
  await saveAndPrint(path.join(repoRoot, ".northstar", "calibrate", calibrationId), renderCalibration(reviews), "results.json", reviews);
  return 0;
}

const DEFAULT_AUDIT_COMMITS = 30;

async function audit(options: { commits?: string; json?: boolean }): Promise<number> {
  const maxCommits = parseCommitCount(options.commits, DEFAULT_AUDIT_COMMITS);

  const repoRoot = await findRepoRoot(process.cwd());
  const settings = (await loadConfigIfPresent(path.join(repoRoot, CONFIG_FILE))) ?? DEFAULT_SLOP_SETTINGS;
  const report = await auditCommits(repoRoot, settings, maxCommits, newRunId());
  console.log(options.json ? JSON.stringify(report, null, 2) : renderAudit(report));
  return 0;
}

async function profile(): Promise<number> {
  const repoRoot = await findRepoRoot(process.cwd());
  const existing = await loadProfile(repoRoot);
  const scanned = await scanRepo(repoRoot, existing?.notes);
  await writeFile(path.join(repoRoot, PROFILE_FILE), `${JSON.stringify(scanned, null, 2)}\n`);
  console.log(`Wrote ${PROFILE_FILE}. Agents will be told:\n`);
  console.log(renderConventions(scanned) ?? "Nothing yet. Add rules under \"notes\".");
  return 0;
}

async function run(task: string, options: { config?: string; base: string }): Promise<number> {
  const repoRoot = await findRepoRoot(process.cwd());
  const config = await loadConfig(options.config ?? path.join(repoRoot, CONFIG_FILE));
  const outcome = await runPipeline({
    task,
    runId: newRunId(),
    repoRoot,
    baseRef: options.base,
    config,
    ...agentsFor(config),
  });

  await saveAndPrint(path.join(repoRoot, ".northstar", "runs", outcome.runId), renderReport(outcome), "run.json", outcome);
  return outcome.status === "passed" ? 0 : 1;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      base: { type: "string", default: "HEAD" },
      commits: { type: "string" },
      json: { type: "boolean" },
      tasks: { type: "string" },
      live: { type: "boolean" },
    },
  });
  const [command, ...rest] = positionals;
  const task = rest.join(" ").trim();

  if (command === "doctor") return doctor(values);
  if (command === "profile") return profile();
  if (command === "audit") return audit(values);
  if (command === "bench") return bench(values);
  if (command === "calibrate") return calibrate(values);
  if (command === "run" && task) return run(task, values);
  console.error(USAGE);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (error: Error) => {
    console.error(error.message);
    process.exit(2);
  },
);
