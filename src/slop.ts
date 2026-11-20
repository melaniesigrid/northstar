import { findAttributionMarkers, type AttributionMarker } from "./attribution.js";
import { findClones, formatClones, type DuplicationResult } from "./duplication.js";
import { findWeakTests, type WeakTest } from "./weak-tests.js";
import { loadSnapshot, type ChangeSnapshot } from "./snapshot.js";
import { findSuppressions, type Suppression } from "./suppressions.js";
import type { SlopSettings } from "./types.js";
import { findUnreferencedSymbols, type UnreferencedSymbol } from "./unreferenced.js";

export interface SlopReport {
  duplication: DuplicationResult;
  suppressions: Suppression[];
  /** Notes crediting an AI tool. Always blocked. */
  attribution: AttributionMarker[];
  /** Signals for the reviewer to verify, never a reason to block on their own. */
  unreferenced: UnreferencedSymbol[];
  /** New tests that would pass almost whatever the code does. Also for the reviewer. */
  weakTests: WeakTest[];
}

export function analyzeSlop(snapshot: ChangeSnapshot, settings: SlopSettings): SlopReport {
  return {
    duplication: findClones(snapshot, settings.minDuplicateLines),
    suppressions: findSuppressions(snapshot),
    attribution: findAttributionMarkers(snapshot.addedText),
    unreferenced: findUnreferencedSymbols(snapshot),
    weakTests: findWeakTests(snapshot),
  };
}

export async function checkSlop(cwd: string, settings: SlopSettings): Promise<SlopReport> {
  return analyzeSlop(await loadSnapshot(cwd), settings);
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
  if (report.weakTests.length > 0) {
    const list = report.weakTests.map((test) => `- ${test.file}:${test.line} ${test.name} (${test.weakness})`).join("\n");
    hints.push(
      `An automated check found new tests that may not test anything. Verify each one. If the test would pass whether or not the code works, report it as a blocking "tests" finding:\n${list}`,
    );
  }
  return hints;
}

/** How many signals a report sends to the reviewer. */
export function countReviewerSignals(report: SlopReport): number {
  return report.unreferenced.length + report.duplication.dataClones.length + report.weakTests.length;
}

/** The writer's feedback when a hard slop check fails, or undefined when the change is clean. */
export function describeBlockingSlop(report: SlopReport, settings: SlopSettings): string | undefined {
  const problems: string[] = [];
  if (report.duplication.clones.length > 0) {
    problems.push(
      `New code repeats code the repo already has. Reuse or extract the original instead:\n${formatClones(report.duplication.clones)}`,
    );
  }
  if (report.suppressions.length > settings.maxNewSuppressions) {
    const list = report.suppressions
      .map((suppression) => `- ${suppression.file}:${suppression.line} ${suppression.directive}`)
      .join("\n");
    problems.push(
      `The change silences ${report.suppressions.length} lint or type checks and the limit is ${settings.maxNewSuppressions}. Fix the underlying problem instead:\n${list}`,
    );
  }
  if (report.attribution.length > 0) {
    const list = report.attribution.map((marker) => `- ${marker.file}:${marker.line} ${marker.text}`).join("\n");
    problems.push(`The change credits an AI tool for the work. Remove these notes:\n${list}`);
  }
  return problems.length > 0 ? problems.join("\n\n") : undefined;
}
