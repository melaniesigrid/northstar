import { mkdtemp, readFile, rm } from "node:fs/promises";
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
 * from the `-o` file, which is steadier than reassembling it from item events.
 */
export function parseCodexEvents(stdout: string, lastMessage: string, exitCode: number | null): RunResult {
  let sessionId: string | undefined;
  let usage: Usage | undefined;
  let failure: string | undefined;

  for (const line of stdout.split("\n")) {
    const event = parseLine(line);
    if (!event) continue;
    if (event.type === "thread.started") sessionId = event.thread_id;
    if (event.type === "turn.completed" && event.usage) {
      usage = { inputTokens: event.usage.input_tokens ?? 0, outputTokens: event.usage.output_tokens ?? 0 };
    }
    if (event.type === "turn.failed" || event.type === "error") {
      failure = event.error?.message ?? event.message ?? "Codex reported an error.";
    }
  }

  if (!failure && exitCode !== 0) failure = `Codex exited with code ${exitCode}.`;
  return {
    status: failure ? "failed" : "ok",
    finalMessage: failure ?? lastMessage,
    sessionId,
    usage,
    raw: stdout,
  };
}

export const codex: AgentAdapter = {
  id: "codex",
  vendor: "openai",
  detect: () => detectCli(CLI),
  async run(spec: RunSpec): Promise<RunResult> {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "northstar-codex-"));
    const lastMessageFile = path.join(outputDir, "last-message.txt");
    const sandbox = spec.readOnly ? "read-only" : "workspace-write";
    const model = spec.model ? ["--model", spec.model] : [];
    const args = ["exec", "--json", "--sandbox", sandbox, "-o", lastMessageFile, ...model, spec.prompt];
    try {
      const result = await exec(CLI, args, { cwd: spec.cwd, timeoutMs: spec.timeoutMs });
      const lastMessage = await readFile(lastMessageFile, "utf8").catch(() => "");
      return launchFailure(result, "Codex") ?? parseCodexEvents(result.stdout, lastMessage, result.exitCode);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  },
};
