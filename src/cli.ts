#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { getAdapter, listAdapters } from "./adapters/index.js";
import { CONFIG_FILE, loadConfig } from "./config.js";
import { findRepoRoot } from "./git.js";
import { runPipeline } from "./pipeline.js";
import { renderReport } from "./report.js";

const USAGE = `Usage:
  northstar run "<task>" [--config <file>] [--base <git ref>]
  northstar doctor

run     Writes the change in an isolated worktree, runs the gates, then has a
        second agent review it. Exits 0 when the change passed, 1 when a human
        needs to look.
doctor  Shows which agent CLIs are installed.`;

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
    },
  });
  const [command, ...rest] = positionals;
  const task = rest.join(" ").trim();

  if (command === "doctor") return doctor();
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
