import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exec } from "../exec.js";
import type { AgentAdapter, RunResult, RunSpec, Usage } from "../types.js";
import { detectCli, launchFailure } from "./shared.js";

const CLI = "codex";

interface CodexEvent {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parseLine(line: string): CodexEvent | undefined {
  try {
    return JSON.parse(line) as CodexEvent;
  } catch {
    return undefined;
  }
}

/**
 * Reads the JSON Lines stream from `codex exec --json`. The final answer comes
 * from the last-message file, which is steadier than reassembling it from item
 * events.
 *
 * An `error` event alone does not mean the run failed: Codex prints one for
 * each reconnect attempt and then carries on. A run failed when a turn failed,
 * the process exited non-zero, or no turn ever completed.
 */
export function parseCodexEvents(stdout: string, lastMessage: string, exitCode: number | null): RunResult {
  let sessionId: string | undefined;
  let usage: Usage | undefined;
  let lastError: string | undefined;
  let turnFailed = false;
  let turnCompleted = false;

  for (const line of stdout.split("\n")) {
    const event = parseLine(line);
    if (!event) continue;
    if (event.type === "thread.started") sessionId = event.thread_id;
    if (event.type === "turn.completed") {
      turnCompleted = true;
      if (event.usage) {
        usage = { inputTokens: event.usage.input_tokens ?? 0, outputTokens: event.usage.output_tokens ?? 0 };
      }
    }
    if (event.type === "turn.failed") turnFailed = true;
    if (event.type === "turn.failed" || event.type === "error") {
      lastError = event.error?.message ?? event.message ?? lastError;
    }
  }

  const failed = turnFailed || exitCode !== 0 || !turnCompleted;
  return {
    status: failed ? "failed" : "ok",
    finalMessage: failed ? (lastError ?? `Codex exited with code ${exitCode} before finishing a turn.`) : lastMessage,
    sessionId,
    usage,
    raw: stdout,
  };
}

/**
 * The prompt goes in on stdin (the trailing "-"), so a long diff never hits
 * the operating system's limit on argument length.
 */
export function buildCodexArgs(spec: RunSpec, files: { lastMessage: string; schema?: string }): string[] {
  const args = ["exec", "--json", "--sandbox", spec.readOnly ? "read-only" : "workspace-write"];
  args.push("--output-last-message", files.lastMessage);
  if (spec.model) args.push("--model", spec.model);
  if (spec.effort) args.push("--config", `model_reasoning_effort="${spec.effort}"`);
  if (files.schema) args.push("--output-schema", files.schema);
  args.push("-");
  return args;
}

export const codex: AgentAdapter = {
  id: "codex",
  vendor: "openai",
  detect: () => detectCli(CLI),
  async run(spec: RunSpec): Promise<RunResult> {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "northstar-codex-"));
    const files = {
      lastMessage: path.join(outputDir, "last-message.txt"),
      schema: spec.outputSchema ? path.join(outputDir, "schema.json") : undefined,
    };
    try {
      if (files.schema) await writeFile(files.schema, JSON.stringify(spec.outputSchema));
      const result = await exec(CLI, buildCodexArgs(spec, files), {
        cwd: spec.cwd,
        timeoutMs: spec.timeoutMs,
        input: spec.prompt,
      });
      const lastMessage = await readFile(files.lastMessage, "utf8").catch(() => "");
      return launchFailure(result, "Codex") ?? parseCodexEvents(result.stdout, lastMessage, result.exitCode);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  },
};
