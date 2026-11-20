import { findClones, formatClones, type DuplicationResult } from "./duplication.js";
import { loadSnapshot, type ChangeSnapshot } from "./snapshot.js";
import { findSuppressions, type Suppression } from "./suppressions.js";
import type { Config } from "./types.js";
import { findUnreferencedSymbols, type UnreferencedSymbol } from "./unreferenced.js";

export interface SlopReport {
  duplication: DuplicationResult;
  suppressions: Suppression[];
  /** Signals for the reviewer to verify, never a reason to block on their own. */
  unreferenced: UnreferencedSymbol[];
}

export function analyzeSlop(snapshot: ChangeSnapshot, config: Config): SlopReport {
  return {
    duplication: findClones(snapshot, config.minDuplicateLines),
    suppressions: findSuppressions(snapshot),
    unreferenced: findUnreferencedSymbols(snapshot),
  };
}

export async function checkSlop(cwd: string, config: Config): Promise<SlopReport> {
  return analyzeSlop(await loadSnapshot(cwd), config);
}

/** Signals that are too uncertain to block on, worded for the reviewer to verify. */
export function reviewerHints(report: SlopReport): string[] {
  const hints: string[] = [];
  if (report.unreferenced.length > 0) {
    const list = report.unreferenced.map((symbol) => `- ${symbol.file}:${symbol.line} ${symbol.name}`).join("\n");
    hints.push(
      `An automated check found new symbols whose names appear nowhere else in the repo. Verify each one. If it is truly unused, and is not an entry point or public API, report it as a blocking "scope" finding:\n${list}`,
    );
  }
  if (report.duplication.dataClones.length > 0) {
    hints.push(
      `An automated check found new blocks of literal values that repeat values elsewhere in the repo. Verify each one. If an existing constant could be imported instead, report it as a blocking "reuse" finding:\n${formatClones(report.duplication.dataClones)}`,
    );
  }
  return hints;
}

/** The writer's feedback when a hard slop check fails, or undefined when the change is clean. */
export function describeBlockingSlop(report: SlopReport, config: Config): string | undefined {
  const problems: string[] = [];
  if (report.duplication.clones.length > 0) {
    problems.push(
      `New code repeats code the repo already has. Reuse or extract the original instead:\n${formatClones(report.duplication.clones)}`,
    );
  }
  if (report.suppressions.length > config.maxNewSuppressions) {
    const list = report.suppressions
      .map((suppression) => `- ${suppression.file}:${suppression.line} ${suppression.directive}`)
      .join("\n");
    problems.push(
      `The change silences ${report.suppressions.length} lint or type checks and the limit is ${config.maxNewSuppressions}. Fix the underlying problem instead:\n${list}`,
    );
  }
  return problems.length > 0 ? problems.join("\n\n") : undefined;
}
