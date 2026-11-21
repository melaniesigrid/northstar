import { describe, expect, it } from "vitest";
import { auditCommits, renderAudit } from "../src/audit.js";
import { DEFAULT_SLOP_SETTINGS } from "../src/config.js";
import { commitFile, createTempRepo, gitIn, newRunId, SLUGIFY_SOURCE } from "./helpers.js";

/** A repo whose history holds one clean commit, one copy-paste and one silenced type error. */
function repoWithHistory(): string {
  const repo = createTempRepo();
  commitFile(repo, "slug.ts", `${SLUGIFY_SOURCE}\n`, "Add slugify");
  commitFile(repo, "copy.ts", `${SLUGIFY_SOURCE}\n`, "Copy slugify");
  commitFile(repo, "value.ts", "export const parsed = JSON.parse(raw) as any;\n", "Parse the value");
  return repo;
}

describe("auditCommits", () => {
  it("judges each commit as the change it was, newest first", async () => {
    const report = await auditCommits(repoWithHistory(), DEFAULT_SLOP_SETTINGS, 10, newRunId());

    expect(report.commits.map((commit) => [commit.subject, commit.blockedBecause !== undefined])).toEqual([
      ["Parse the value", true],
      ["Copy slugify", true],
      ["Add slugify", false],
    ]);
    expect(report.commits[1]?.slop.duplication.duplicatedLines).toBe(5);
    expect(report.commits[0]?.slop.suppressions).toHaveLength(1);
  });

  it("leaves out the first commit of a repo, which has nothing to be compared against", async () => {
    const report = await auditCommits(repoWithHistory(), DEFAULT_SLOP_SETTINGS, 10, newRunId());

    expect(report.commits.map((commit) => commit.subject)).not.toContain("initial");
  });

  it("looks at no more commits than asked", async () => {
    const report = await auditCommits(repoWithHistory(), DEFAULT_SLOP_SETTINGS, 1, newRunId());

    expect(report.commits.map((commit) => commit.subject)).toEqual(["Parse the value"]);
  });

  it("leaves the user's checkout exactly as it was", async () => {
    const repo = repoWithHistory();
    const headBefore = gitIn(repo, "rev-parse", "HEAD");

    await auditCommits(repo, DEFAULT_SLOP_SETTINGS, 10, newRunId());

    expect(gitIn(repo, "rev-parse", "HEAD")).toBe(headBefore);
    expect(gitIn(repo, "status", "--porcelain")).toBe("");
    expect(gitIn(repo, "worktree", "list").trim().split("\n")).toHaveLength(1);
  });
});

describe("renderAudit", () => {
  it("leads with how many commits would have been blocked and the rates per 1,000 lines", async () => {
    const text = renderAudit(await auditCommits(repoWithHistory(), DEFAULT_SLOP_SETTINGS, 10, newRunId()));

    expect(text).toContain("2 of 3 commits would have been blocked.");
    expect(text).toContain("(13 lines in total)");
    expect(text).toContain("- Duplicated lines: 384.6");
    expect(text).toContain("copy.ts:1-5 repeats slug.ts:1");
  });

  it("says so plainly when there is nothing to audit", () => {
    expect(renderAudit({ commits: [] })).toContain("No commits to audit.");
  });
});
