import { exec, tail } from "./exec.js";
import type { GateConfig } from "./types.js";

export interface GateResult {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

const MAX_OUTPUT_CHARS = 4000;

/** A gate is any command that exits 0 on success. Its output becomes the writer's feedback on failure. */
export async function runGate(gate: GateConfig, cwd: string, timeoutMs: number): Promise<GateResult> {
  const startedAt = Date.now();
  const result = await exec(gate.command, [], { cwd, shell: true, timeoutMs });
  const output = result.timedOut
    ? `Timed out after ${timeoutMs} ms.`
    : tail(`${result.stdout}\n${result.stderr}`.trim(), MAX_OUTPUT_CHARS);
  return {
    name: gate.name,
    passed: result.exitCode === 0 && !result.timedOut,
    output,
    durationMs: Date.now() - startedAt,
  };
}
