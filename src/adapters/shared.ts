import { exec, type ExecResult } from "../exec.js";
import type { RunResult } from "../types.js";

/** Maps "the CLI never produced an answer" to a result, or undefined when it ran. */
export function launchFailure(result: ExecResult, cliName: string): RunResult | undefined {
  if (result.notFound) {
    return { status: "failed", finalMessage: `${cliName} is not installed or not on PATH.`, raw: null };
  }
  if (result.timedOut) {
    return { status: "timeout", finalMessage: `${cliName} timed out.`, raw: result.stdout };
  }
  return undefined;
}

export async function detectCli(command: string): Promise<{ installed: boolean; version?: string }> {
  const result = await exec(command, ["--version"], { timeoutMs: 10_000 });
  if (result.notFound || result.exitCode !== 0) return { installed: false };
  return { installed: true, version: result.stdout.trim() };
}
