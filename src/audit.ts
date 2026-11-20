import { createDetachedWorktree, listCommits, removeWorktree, restageCommit, type CommitInfo } from "./git.js";
import { analyzeSlop, countReviewerSignals, describeBlockingSlop, type SlopReport } from "./slop.js";
import { addedLinesOf, loadSnapshot } from "./snapshot.js";
import type { SlopSettings } from "./types.js";

export interface CommitAudit extends CommitInfo {
  /** Added lines of source code, the base for per-1,000-line rates. */
  addedLines: number;
  slop: SlopReport;
  /** Why the pipeline would have rejected this commit, if it would have. */
  blockedBecause?: string;
}

export interface AuditReport {
  commits: CommitAudit[];
}

/**
 * Runs the slop checks over recent history, one commit at a time, in a scratch
 * worktree. Each commit is judged as the change it was when it was made, so the
 * result is what the pipeline would have said had it been in place.
 */
export async function auditCommits(
  repoRoot: string,
  settings: SlopSettings,
  maxCommits: number,
  auditId: string,
): Promise<AuditReport> {
  const worktree = await createDetachedWorktree(repoRoot, `audit-${auditId}`);
  try {
    const commits: CommitAudit[] = [];
    for (const info of await listCommits(repoRoot, maxCommits)) {
      await restageCommit(worktree, info.commit);
      const snapshot = await loadSnapshot(worktree);
      const slop = analyzeSlop(snapshot, settings);
      commits.push({
        ...info,
        addedLines: addedLinesOf(snapshot).length,
        slop,
        blockedBecause: describeBlockingSlop(slop, settings),
      });
    }
    return { commits };
  } finally {
    await removeWorktree(repoRoot, worktree);
  }
}

function perThousandLines(count: number, lines: number): string {
  return lines === 0 ? "0" : ((count / lines) * 1000).toFixed(1);
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

export function renderAudit({ commits }: AuditReport): string {
  if (commits.length === 0) return "No commits to audit. A commit needs a parent to be compared against.\n";

  const blocked = commits.filter((commit) => commit.blockedBecause !== undefined);
  const lines = sum(commits.map((commit) => commit.addedLines));
  const duplicated = sum(commits.map((commit) => commit.slop.duplication.duplicatedLines));
  const suppressions = sum(commits.map((commit) => commit.slop.suppressions.length));
  const credits = sum(commits.map((commit) => commit.slop.attribution.length));

  const rows = commits.map((commit) => {
    const { slop } = commit;
    const cells = [
      commit.commit,
      commit.date,
      commit.addedLines,
      slop.duplication.duplicatedLines,
      slop.suppressions.length,
      slop.attribution.length,
      countReviewerSignals(slop),
      commit.blockedBecause === undefined ? "" : "yes",
      commit.subject,
    ];
    return `| ${cells.join(" | ")} |`;
  });

  const sections = [
    `# NorthStar audit of ${commits.length} commits`,
    `${blocked.length} of ${commits.length} commits would have been blocked.`,
    [
      `Per 1,000 added lines of source (${lines} lines in total):`,
      `- Duplicated lines: ${perThousandLines(duplicated, lines)}`,
      `- New suppressions: ${perThousandLines(suppressions, lines)}`,
      `- AI credit notes: ${perThousandLines(credits, lines)}`,
    ].join("\n"),
    [
      "| Commit | Date | Added | Duplicated | Suppressions | AI credits | For review | Blocked | Subject |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
    ].join("\n"),
    ...blocked.map((commit) => `## ${commit.commit} ${commit.subject}\n\n${commit.blockedBecause}`),
  ];
  return `${sections.join("\n\n")}\n`;
}
