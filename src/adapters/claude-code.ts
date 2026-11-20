import { exec } from "../exec.js";
import type { AgentAdapter, RunResult, RunSpec } from "../types.js";
import { detectCli, launchFailure } from "./shared.js";

const CLI = "claude";
const READ_ONLY_TOOLS = "Read,Grep,Glob";

/** Lets the agent run a command exactly as given, or with arguments after it. */
function commandRules(commands: string[]): string[] {
  return commands.flatMap((command) => [`Bash(${command})`, `Bash(${command} *)`]);
}

export function buildClaudeArgs(spec: RunSpec): string[] {
  const args = ["-p", spec.prompt, "--output-format", "json"];
  if (spec.readOnly) {
    args.push("--allowedTools", READ_ONLY_TOOLS);
  } else {
    args.push("--permission-mode", "acceptEdits");
    const rules = commandRules(spec.allowedCommands ?? []);
    if (rules.length > 0) args.push("--allowedTools", ...rules);
  }
  if (spec.model) args.push("--model", spec.model);
  if (spec.effort) args.push("--effort", spec.effort);
  if (spec.outputSchema) args.push("--json-schema", JSON.stringify(spec.outputSchema));
  return args;
}

/** Reads the single result object that `claude -p --output-format json` prints. */
export function parseClaudeOutput(stdout: string): RunResult {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return { status: "failed", finalMessage: "Claude Code returned output that is not JSON.", raw: stdout };
  }
  const usage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  // With a schema, the answer arrives as an object in `structured_output` instead of text in `result`.
  const structured = payload.structured_output;
  const text = typeof payload.result === "string" ? payload.result : "";
  return {
    status: payload.is_error === true ? "failed" : "ok",
    finalMessage: structured === undefined ? text : JSON.stringify(structured),
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
    const result = await exec(CLI, buildClaudeArgs(spec), { cwd: spec.cwd, timeoutMs: spec.timeoutMs });
    return launchFailure(result, "Claude Code") ?? parseClaudeOutput(result.stdout);
  },
};
