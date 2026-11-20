import { formatFindings } from "./review.js";
import type { Attempt, RunOutcome } from "./pipeline.js";
import type { Usage } from "./types.js";

function describeUsage(label: string, usage: Usage | undefined): string | undefined {
  if (!usage) return undefined;
  const cost = usage.costUsd === undefined ? "" : `, $${usage.costUsd.toFixed(4)}`;
  return `- ${label}: ${usage.inputTokens} tokens in, ${usage.outputTokens} out${cost}`;
}

function renderAttempt(attempt: Attempt): string {
  const gates = attempt.gates.map((gate) => `${gate.name} ${gate.passed ? "passed" : "FAILED"}`).join(", ");
  const lines = [
    `## Attempt ${attempt.number}`,
    `- Changed: ${attempt.filesChanged.length} files, ${attempt.linesChanged} lines`,
    `- Gates: ${gates || "not reached"}`,
    describeUsage("Writer", attempt.writerUsage),
    describeUsage("Reviewer", attempt.reviewerUsage),
  ];
  if (attempt.findings.length > 0) {
    lines.push(`- Review findings:\n${formatFindings(attempt.findings)}`);
  }
  if (attempt.failure) {
    lines.push(`- Stopped at the ${attempt.failure.stage} stage:\n${attempt.failure.detail}`);
  }
  return lines.filter((line) => line !== undefined).join("\n");
}

function renderResult(outcome: RunOutcome): string {
  if (outcome.status === "passed") {
    return `PASSED on attempt ${outcome.attempts.length}. The change is committed on \`${outcome.branch}\`.`;
  }
  const where = outcome.worktreePath ? ` Inspect the work in ${outcome.worktreePath}.` : "";
  return `NEEDS A HUMAN. Nothing was committed.${where}`;
}

export function renderReport(outcome: RunOutcome): string {
  const review = outcome.sameVendorReview
    ? "same vendor as the writer, which is a weaker check"
    : "a different vendor from the writer";
  const sections = [
    `# NorthStar run ${outcome.runId}`,
    `Task: ${outcome.task}`,
    `Result: ${renderResult(outcome)}`,
    `Review: ${review}.`,
  ];
  if (outcome.setupFailure) sections.push(outcome.setupFailure);
  sections.push(...outcome.attempts.map(renderAttempt));
  return `${sections.join("\n\n")}\n`;
}
