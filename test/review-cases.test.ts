import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stagedStat } from "../src/git.js";
import { loadCases, parseCase, renderCaseResults, reviewCases, stageCase, type CaseResult } from "../src/review-cases.js";
import { checkSlop, describeBlockingSlop } from "../src/slop.js";
import { CLEAN_REVIEW, fakeAgent, testConfig } from "./helpers.js";

const SHIPPED = fileURLToPath(new URL("../benchmark/review-cases", import.meta.url));

const blockingReview = (rule: string) => () =>
  JSON.stringify({ findings: [{ severity: "blocking", rule, file: "src/a.ts", line: 1, explanation: "Seen." }] });

const CASE = [
  "# Reuse: a second helper",
  "",
  "- Expect: block",
  "- Rule: reuse",
  "",
  "## Task",
  "",
  "Add a greeting.",
  "",
  "## Seeded problem",
  "",
  "The repo already has `greet`.",
  "",
  "## Before",
  "",
  "### src/greet.ts",
  "",
  "```ts",
  "export const greet = (name: string) => `Hello, ${name}`;",
  "```",
  "",
  "## After",
  "",
  "### src/welcome.ts",
  "",
  "```ts",
  "export const welcome = (name: string) => `Hello, ${name}`;",
  "```",
  "",
].join("\n");

const seeded = parseCase("reuse", CASE);
const clean = parseCase("clean", CASE.replace("- Expect: block\n- Rule: reuse", "- Expect: approve"));

describe("parseCase", () => {
  it("reads what to expect, the task, and the files before and after", () => {
    expect(seeded).toMatchObject({ title: "Reuse: a second helper", expect: "block", rule: "reuse", task: "Add a greeting." });
    expect(seeded.problem).toBe("The repo already has `greet`.");
    expect([...seeded.before.keys()]).toEqual(["src/greet.ts"]);
    expect(seeded.after.get("src/welcome.ts")).toBe("export const welcome = (name: string) => `Hello, ${name}`;\n");
  });

  it.each([
    ["no expectation", CASE.replace("- Expect: block\n", ""), "Expect"],
    ["an unknown rule", CASE.replace("- Rule: reuse", "- Rule: vibes"), "vibes"],
    ["no changed file", CASE.slice(0, CASE.indexOf("## After")), "After"],
  ])("rejects a case with %s", (_label, markdown, mention) => {
    expect(() => parseCase("broken", markdown)).toThrow(mention);
  });
});

describe("the cases that ship with NorthStar", () => {
  it("each reach review: they change something and the plain checks let them through", async () => {
    const config = testConfig();
    for (const item of await loadCases(SHIPPED)) {
      const repo = await stageCase(item);
      expect((await stagedStat(repo)).files, item.id).not.toEqual([]);
      expect(describeBlockingSlop(await checkSlop(repo, config), config), item.id).toBeUndefined();
    }
  });

  it("name a rule and a problem exactly when a block is expected", async () => {
    const cases = await loadCases(SHIPPED);

    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const item of cases) {
      const isSeeded = item.expect === "block";
      expect([item.id, item.rule !== undefined, item.problem !== undefined]).toEqual([item.id, isSeeded, isSeeded]);
    }
  });
});

describe("reviewCases", () => {
  it("shows the reviewer the task and the change, and never the seeded problem", async () => {
    const reviewer = fakeAgent("b", [CLEAN_REVIEW]);

    await reviewCases(reviewer, testConfig(), [seeded]);

    expect(reviewer.prompts[0]).toContain("Add a greeting.");
    expect(reviewer.prompts[0]).toContain("+export const welcome");
    expect(reviewer.prompts[0]).not.toContain("The repo already has");
    expect(reviewer.specs[0]?.cwd).not.toContain("reuse");
  });

  it("tells a catch from a block for another reason, a miss, and a wrong block", async () => {
    const reviewer = fakeAgent("b", [blockingReview("reuse"), blockingReview("naming"), CLEAN_REVIEW, blockingReview("tests"), CLEAN_REVIEW]);

    const results = await reviewCases(reviewer, testConfig(), [seeded, seeded, seeded, clean, clean]);

    expect(results.map((result) => [result.blocked, result.blockedForRule])).toEqual([
      [true, true],
      [true, false],
      [false, false],
      [true, false],
      [false, false],
    ]);
    const report = renderCaseResults(results);
    expect(report).toContain("The reviewer blocked 2 of 3 changes with a seeded problem, 1 of them under the rule the problem was seeded for. It blocked 1 of 2 clean changes.");
    expect(report).toContain("## Missed\n- reuse: The repo already has `greet`.");
    expect(report).toContain("## Wrongly blocked: clean\n\n- [tests] src/a.ts:1 Seen.");
  });

  it("skips a case the plain checks would stop, without spending a review on it", async () => {
    // Written in two pieces so this file does not trip the check it is testing.
    const untyped = `welcome = (name: ${"an"}${"y"})`;
    const stopped = parseCase("stopped", CASE.replace("welcome = (name: string)", untyped));
    const reviewer = fakeAgent("b", []);

    const results = await reviewCases(reviewer, testConfig(), [stopped]);

    expect(results[0]?.skipped).toContain("The slop checks stop this change before review");
    expect(reviewer.prompts).toEqual([]);
  });
});

describe("renderCaseResults", () => {
  it("leaves skipped cases out of the counts and lists them", () => {
    const skipped: CaseResult = { id: "x", title: "X", expect: "block", findings: [], blocked: false, blockedForRule: false, skipped: "Timed out." };

    const report = renderCaseResults([skipped]);

    expect(report).toContain("blocked 0 of 0 changes with a seeded problem");
    expect(report).toContain("- x: Timed out.");
  });
});
