import { exec } from "../exec.js";
import type { AgentAdapter, RunResult, RunSpec } from "../types.js";
import { detectCli, launchFailure } from "./shared.js";

const CLI = "claude";
const READ_ONLY_TOOLS = "Read,Grep,Glob";

/** Reads the single result object that `claude -p --output-format json` prints. */
export function parseClaudeOutput(stdout: string): RunResult {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return { status: "failed", finalMessage: "Claude Code returned output that is not JSON.", raw: stdout };
  }
  const usage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    status: payload.is_error === true ? "failed" : "ok",
    finalMessage: typeof payload.result === "string" ? payload.result : "",
    sessionId: typeof payload.session_id === "string" ? payload.session_id : undefined,
    usage: usage && {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      costUsd: typeof payload.total_cost_usd === "number" ? payload.total_cost_usd : undefined,
    },
    raw: payload,
  };
}

export const claudeCode: AgentAdapter = {
  id: "claude-code",
  vendor: "anthropic",
  detect: () => detectCli(CLI),
  async run(spec: RunSpec): Promise<RunResult> {
    const permissions = spec.readOnly
      ? ["--allowedTools", READ_ONLY_TOOLS]
      : ["--permission-mode", "acceptEdits"];
    const model = spec.model ? ["--model", spec.model] : [];
    const args = ["-p", spec.prompt, "--output-format", "json", ...permissions, ...model];
    const result = await exec(CLI, args, { cwd: spec.cwd, timeoutMs: spec.timeoutMs });
    return launchFailure(result, "Claude Code") ?? parseClaudeOutput(result.stdout);
  },
};
