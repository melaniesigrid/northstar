#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { getAdapter, listAdapters } from "./adapters/index.js";
import { auditCommits, renderAudit } from "./audit.js";
import { loadTasks, renderBenchmark, runBenchmark } from "./bench.js";
import { CONFIG_FILE, DEFAULT_SLOP_SETTINGS, loadConfig } from "./config.js";
import { findRepoRoot } from "./git.js";
import { runPipeline } from "./pipeline.js";
import { loadProfile, PROFILE_FILE, renderConventions, scanRepo } from "./profile.js";
import { renderReport } from "./report.js";

const USAGE = `Usage:
  northstar run "<task>" [--config <file>] [--base <git ref>]
  northstar audit [--commits <n>] [--json]
  northstar bench [--tasks <folder>] [--config <file>]
  northstar profile
  northstar doctor

run      Writes the change in an isolated worktree, runs the gates, then has a
         second agent review it. Exits 0 when the change passed, 1 when a human
         needs to look.
audit    Scores the repo's recent commits with the slop checks. Needs no
         config and no agent, and never touches your checkout.
bench    Runs each benchmark task twice from the same commit, once with the
         writer alone and once through the pipeline, and compares the results.
         Tasks are read from benchmark/tasks unless --tasks says otherwise.
profile  Scans the repo's conventions and writes them to ${PROFILE_FILE}
         for you to review, edit and commit. Your notes are kept on rescans.
doctor   Shows which agent CLIs are installed.`;

function newRunId(): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

async function doctor(): Promise<number> {
  for (const adapter of listAdapters()) {
    const { installed, version } = await adapter.detect();
    console.log(`${adapter.id}: ${installed ? `installed (${version})` : "not found on PATH"}`);
  }
  return 0;
}

const DEFAULT_TASKS_FOLDER = path.join("benchmark", "tasks");

async function bench(options: { tasks?: string; config?: string }): Promise<number> {
  const repoRoot = await findRepoRoot(process.cwd());
  const config = await loadConfig(options.config ?? path.join(repoRoot, CONFIG_FILE));
  const tasks = await loadTasks(path.resolve(repoRoot, options.tasks ?? DEFAULT_TASKS_FOLDER));
  const benchId = newRunId();
  console.error(`Running ${tasks.length} tasks twice each. This uses your agents and can take a while.`);

  const results = await runBenchmark(
    {
      benchId,
      repoRoot,
      config,
      writer: getAdapter(config.writer),
      reviewer: getAdapter(config.reviewer),
      planner: config.planner === undefined ? undefined : getAdapter(config.planner),
    },
    tasks,
  );

  const report = renderBenchmark(results);
  const benchDir = path.join(repoRoot, ".northstar", "bench", benchId);
  await mkdir(benchDir, { recursive: true });
  await writeFile(path.join(benchDir, "report.md"), report);
  await writeFile(path.join(benchDir, "results.json"), JSON.stringify(results, null, 2));
  console.log(report);
  return 0;
}

const DEFAULT_AUDIT_COMMITS = 30;

async function audit(options: { commits?: string; json?: boolean }): Promise<number> {
  const maxCommits = options.commits === undefined ? DEFAULT_AUDIT_COMMITS : Number(options.commits);
  if (!Number.isInteger(maxCommits) || maxCommits < 1) throw new Error("--commits must be a whole number, 1 or more.");

  const repoRoot = await findRepoRoot(process.cwd());
  const configFile = path.join(repoRoot, CONFIG_FILE);
  const hasConfig = await access(configFile).then(() => true, () => false);
  const settings = hasConfig ? await loadConfig(configFile) : DEFAULT_SLOP_SETTINGS;
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
    writer: getAdapter(config.writer),
    reviewer: getAdapter(config.reviewer),
    planner: config.planner === undefined ? undefined : getAdapter(config.planner),
  });

  const report = renderReport(outcome);
  const runDir = path.join(repoRoot, ".northstar", "runs", outcome.runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "report.md"), report);
  await writeFile(path.join(runDir, "run.json"), JSON.stringify(outcome, null, 2));
  console.log(report);
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
    },
  });
  const [command, ...rest] = positionals;
  const task = rest.join(" ").trim();

  if (command === "doctor") return doctor();
  if (command === "profile") return profile();
  if (command === "audit") return audit(values);
  if (command === "bench") return bench(values);
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
