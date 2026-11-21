import { gatherContext } from "./context.js";
import {
  commitMessage,
  createDetachedWorktree,
  discardUnstaged,
  listCommits,
  removeWorktree,
  restageCommit,
  stagedDiff,
  stagedStat,
  type CommitInfo,
} from "./git.js";
import { formatFindings, parseFindings, requestReview } from "./review.js";
import { checkSlop, reviewerHints } from "./slop.js";
import type { AgentAdapter, Config, Finding, Usage } from "./types.js";

/** What the reviewer said about one staged change. */
export interface Verdict {
  findings: Finding[];
  /** Whether the reviewer would have stopped this change. */
  blocked: boolean;
  /** Why the change got no verdict, when it got none. */
  skipped?: string;
  usage?: Usage;
}

export interface CommitReview extends CommitInfo, Verdict {
  linesChanged: number;
}

/**
 * Reviews whatever is staged in `cwd` with everything a real run would send:
 * the same brief, the repo's conventions, and the signals from the slop checks.
 */
export async function reviewStagedChange(reviewer: AgentAdapter, config: Config, cwd: string, task: string): Promise<Verdict> {
  const reviewed = await requestReview(reviewer, config, cwd, {
    task,
    diff: await stagedDiff(cwd),
    conventions: (await gatherContext(cwd, task)).conventions,
    hints: reviewerHints(await checkSlop(cwd, config)),
  });
  await discardUnstaged(cwd);
  const verdict: Verdict = { findings: [], blocked: false, usage: reviewed.usage };
  if (reviewed.status !== "ok") return { ...verdict, skipped: `The reviewer ended with status "${reviewed.status}".` };

  const parsed = parseFindings(reviewed.finalMessage);
  if (!parsed.ok) return { ...verdict, skipped: parsed.reason };
  return {
    ...verdict,
    findings: parsed.findings,
    blocked: parsed.findings.some((finding) => finding.severity === "blocking"),
  };
}

export interface CalibrationInput {
  repoRoot: string;
  config: Config;
  reviewer: AgentAdapter;
  maxCommits: number;
  calibrationId: string;
}

async function reviewCommit(input: CalibrationInput, cwd: string, info: CommitInfo): Promise<CommitReview> {
  const { config } = input;
  await restageCommit(cwd, info.commit);
  const { files, linesChanged } = await stagedStat(cwd);
  const review: CommitReview = { ...info, linesChanged, findings: [], blocked: false };
  if (files.length === 0) return { ...review, skipped: "It changed no files." };
  if (linesChanged > config.maxChangedLines) {
    return { ...review, skipped: `It is over the budget of ${config.maxChangedLines} changed lines, so a run would never reach review.` };
  }

  // The commit message stands in for the task.
  const task = await commitMessage(cwd, info.commit);
  return { ...review, ...(await reviewStagedChange(input.reviewer, config, cwd, task)) };
}

/**
 * Shows the reviewer commits a person already accepted and records how often it
 * would have blocked them. A reviewer that rejects sound work wastes attempts
 * and ends runs with "needs a human", so its strictness on this repo should be
 * known before a run depends on it.
 */
export async function calibrateReviewer(input: CalibrationInput): Promise<CommitReview[]> {
  const worktree = await createDetachedWorktree(input.repoRoot, `calibrate-${input.calibrationId}`);
  try {
    const reviews: CommitReview[] = [];
    for (const info of await listCommits(input.repoRoot, input.maxCommits)) {
      reviews.push(await reviewCommit(input, worktree, info));
    }
    return reviews;
  } finally {
    await removeWorktree(input.repoRoot, worktree);
  }
}

function countByRule(findings: Finding[]): string {
  const counts = new Map<string, number>();
  for (const { rule } of findings) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return [...counts]
    .sort(([, a], [, b]) => b - a)
    .map(([rule, count]) => `${rule} ${count}`)
    .join(", ");
}

function verdict(review: CommitReview): string {
  if (review.skipped !== undefined) return "skipped";
  return review.blocked ? "BLOCKED" : "approved";
}

export function renderCalibration(reviews: CommitReview[]): string {
  if (reviews.length === 0) return "No commits to review. A commit needs a parent to be compared against.\n";

  const judged = reviews.filter((review) => review.skipped === undefined);
  const blocked = judged.filter((review) => review.blocked);
  const blocking = blocked.flatMap((review) => review.findings.filter((finding) => finding.severity === "blocking"));
  const skipped = reviews.filter((review) => review.skipped !== undefined);

  const rows = reviews.map((review) => {
    const count = (severity: Finding["severity"]): number =>
      review.findings.filter((finding) => finding.severity === severity).length;
    const cells = [review.commit, review.date, review.linesChanged, count("blocking"), count("advisory"), verdict(review), review.subject];
    return `| ${cells.join(" | ")} |`;
  });

  const sections = [
    `# NorthStar reviewer calibration on ${reviews.length} commits`,
    `The reviewer would have blocked ${blocked.length} of the ${judged.length} commits it judged.`,
    "Every one of these commits was accepted by a person. Read each block below and decide whether it was deserved. The blocks you disagree with are the reviewer being too strict for this repo, and each of them would have cost a run an attempt.",
  ];
  if (blocking.length > 0) sections.push(`Blocking findings by rule: ${countByRule(blocking)}.`);
  sections.push(
    [
      "| Commit | Date | Lines changed | Blocking | Advisory | Verdict | Subject |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
    ].join("\n"),
    ...blocked.map((review) => `## ${review.commit} ${review.subject}\n\n${formatFindings(review.findings)}`),
  );
  if (skipped.length > 0) {
    sections.push(["Skipped:", ...skipped.map((review) => `- ${review.commit}: ${review.skipped}`)].join("\n"));
  }
  return `${sections.join("\n\n")}\n`;
}
