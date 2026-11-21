import { describe, expect, it } from "vitest";
import { calibrateReviewer, renderCalibration, type CommitReview } from "../src/calibrate.js";
import { CLEAN_REVIEW, commitFile, createTempRepo, fakeAgent, gitIn, newRunId, testConfig } from "./helpers.js";

const BLOCK_FOR_TESTS = () =>
  JSON.stringify({
    findings: [
      { severity: "blocking", rule: "tests", file: "price.ts", line: 1, explanation: "No test covers the discount." },
      { severity: "advisory", rule: "naming", file: "price.ts", line: 1, explanation: "`d` says little." },
    ],
  });

function repoWithTwoCommits(): string {
  const repo = createTempRepo();
  commitFile(repo, "price.ts", "export const d = 0.1;\n", "Add the discount\n\nUsed by the checkout total.");
  commitFile(repo, "tax.ts", "export const taxRate = 0.13;\n", "Add the tax rate");
  return repo;
}

function calibrationInput(repoRoot: string, reviewer = fakeAgent("b", [CLEAN_REVIEW, BLOCK_FOR_TESTS])) {
  return { repoRoot, config: testConfig(), reviewer, maxCommits: 10, calibrationId: newRunId() };
}

describe("calibrateReviewer", () => {
  it("gives the reviewer each commit as the change it was, with the commit message as the task", async () => {
    const reviewer = fakeAgent("b", [CLEAN_REVIEW, BLOCK_FOR_TESTS]);

    const reviews = await calibrateReviewer(calibrationInput(repoWithTwoCommits(), reviewer));

    expect(reviews.map((review) => [review.subject, review.blocked])).toEqual([
      ["Add the tax rate", false],
      ["Add the discount", true],
    ]);
    expect(reviewer.prompts[1]).toContain("Add the discount\n\nUsed by the checkout total.");
    expect(reviewer.prompts[1]).toContain("+export const d = 0.1;");
    expect(reviewer.prompts[1]).not.toContain("taxRate");
    expect(reviewer.specs[1]).toMatchObject({ readOnly: true });
  });

  it("leaves the user's checkout, history and worktree list as they were", async () => {
    const repo = repoWithTwoCommits();
    const before = [gitIn(repo, "rev-parse", "HEAD"), gitIn(repo, "status", "--porcelain"), gitIn(repo, "worktree", "list")];

    await calibrateReviewer(calibrationInput(repo));

    expect([gitIn(repo, "rev-parse", "HEAD"), gitIn(repo, "status", "--porcelain"), gitIn(repo, "worktree", "list")]).toEqual(before);
  });

  it("skips a commit that is over the line budget without spending a review on it", async () => {
    const repo = createTempRepo();
    commitFile(repo, "big.ts", "export const value = 1;\n".repeat(30), "Add a big file");
    const reviewer = fakeAgent("b", []);

    const reviews = await calibrateReviewer({ ...calibrationInput(repo, reviewer), config: testConfig({ maxChangedLines: 20 }) });

    expect(reviews[0]?.skipped).toContain("over the budget of 20 changed lines");
    expect(reviewer.prompts).toEqual([]);
  });

  it("records a failed review as skipped and carries on with the next commit", async () => {
    const failed = () => ({ status: "timeout" as const, finalMessage: "", raw: null });

    const reviews = await calibrateReviewer(calibrationInput(repoWithTwoCommits(), fakeAgent("b", [failed, CLEAN_REVIEW])));

    expect(reviews.map((review) => review.skipped)).toEqual(['The reviewer ended with status "timeout".', undefined]);
  });
});

describe("renderCalibration", () => {
  const base = { date: "2026-11-20", linesChanged: 4, findings: [], blocked: false };
  const blockedReview: CommitReview = {
    ...base,
    commit: "abc1234",
    subject: "Add the discount",
    blocked: true,
    findings: JSON.parse(BLOCK_FOR_TESTS()).findings,
  };

  it("counts blocks against the commits that got a verdict and lists each blocking finding", () => {
    const report = renderCalibration([
      blockedReview,
      { ...base, commit: "def5678", subject: "Add the tax rate" },
      { ...base, commit: "9990000", subject: "Vendor a library", skipped: "It is over the budget." },
    ]);

    expect(report).toContain("The reviewer would have blocked 1 of the 2 commits it judged.");
    expect(report).toContain("Blocking findings by rule: tests 1.");
    expect(report).toContain("| abc1234 | 2026-11-20 | 4 | 1 | 1 | BLOCKED | Add the discount |");
    expect(report).toContain("## abc1234 Add the discount\n\n- [tests] price.ts:1 No test covers the discount.");
    expect(report).toContain("- 9990000: It is over the budget.");
  });

  it("says so when there is nothing to review", () => {
    expect(renderCalibration([])).toContain("No commits to review.");
  });
});
