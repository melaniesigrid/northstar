import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reviewStagedChange, type Verdict } from "./calibrate.js";
import { commitBaseline, stageAll } from "./git.js";
import { formatFindings } from "./review.js";
import { checkSlop, describeBlockingSlop } from "./slop.js";
import { FINDING_RULES, type AgentAdapter, type Config, type FindingRule } from "./types.js";

/** A small hand-built change whose right verdict is known in advance. */
export interface ReviewCase {
  id: string;
  title: string;
  expect: "block" | "approve";
  /** The rule a reviewer should cite for a seeded problem. */
  rule?: FindingRule;
  task: string;
  /** What is wrong with the change, for the report. The reviewer never sees it. */
  problem?: string;
  before: Map<string, string>;
  after: Map<string, string>;
}

export interface CaseResult extends Verdict {
  id: string;
  title: string;
  expect: ReviewCase["expect"];
  rule?: FindingRule;
  problem?: string;
  /** A blocking finding names the rule the problem was seeded under. */
  blockedForRule: boolean;
}

const FILE_BLOCK = /^### (.+)\n+```[a-z]*\n([\s\S]*?)\n```/gm;

function section(markdown: string, heading: string): string | undefined {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start === -1) return undefined;
  const bodyStart = start + heading.length + 5;
  const end = markdown.indexOf("\n## ", bodyStart);
  return markdown.slice(bodyStart, end === -1 ? undefined : end).trim();
}

function filesIn(text: string | undefined): Map<string, string> {
  return new Map([...(text ?? "").matchAll(FILE_BLOCK)].map((match) => [match[1] ?? "", `${match[2]}\n`]));
}

/** Reads a case from its Markdown file: a title, what to expect, the task, and the files before and after. */
export function parseCase(id: string, markdown: string): ReviewCase {
  const expect = /^- Expect: (block|approve)$/m.exec(markdown)?.[1] as ReviewCase["expect"] | undefined;
  const rule = /^- Rule: (\w+)$/m.exec(markdown)?.[1] as FindingRule | undefined;
  const task = section(markdown, "Task");
  const after = filesIn(section(markdown, "After"));
  if (expect === undefined) throw new Error(`Review case ${id}: needs a line "- Expect: block" or "- Expect: approve".`);
  if (rule !== undefined && !FINDING_RULES.includes(rule)) throw new Error(`Review case ${id}: unknown rule "${rule}".`);
  if (!task || after.size === 0) throw new Error(`Review case ${id}: needs a "## Task" and at least one file under "## After".`);
  return {
    id,
    title: /^# (.+)$/m.exec(markdown)?.[1] ?? id,
    expect,
    rule,
    task,
    problem: section(markdown, "Seeded problem"),
    before: filesIn(section(markdown, "Before")),
    after,
  };
}

export async function loadCases(directory: string): Promise<ReviewCase[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".md") && name !== "README.md").sort();
  return Promise.all(
    names.map(async (name) => parseCase(path.basename(name, ".md"), await readFile(path.join(directory, name), "utf8"))),
  );
}

async function writeFiles(root: string, files: Map<string, string>): Promise<void> {
  for (const [file, content] of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
}

/**
 * Builds the case as a real repo with the change staged, the state a reviewer
 * meets in a run. The folder name gives nothing away about the case.
 */
export async function stageCase(reviewCase: ReviewCase): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "northstar-change-"));
  await writeFiles(repo, reviewCase.before);
  if (reviewCase.before.size === 0) await writeFile(path.join(repo, ".gitkeep"), "");
  await commitBaseline(repo);
  await writeFiles(repo, reviewCase.after);
  await stageAll(repo);
  return repo;
}

async function reviewCase(reviewer: AgentAdapter, config: Config, item: ReviewCase): Promise<CaseResult> {
  const { id, title, expect, rule, problem } = item;
  const result = { id, title, expect, rule, problem, findings: [], blocked: false, blockedForRule: false };
  const repo = await stageCase(item);
  try {
    // A change the plain checks stop never reaches review in a run, so it cannot test the reviewer.
    const stoppedEarlier = describeBlockingSlop(await checkSlop(repo, config), config);
    if (stoppedEarlier) return { ...result, skipped: `The slop checks stop this change before review: ${stoppedEarlier}` };

    const verdict = await reviewStagedChange(reviewer, config, repo, item.task);
    const blockedForRule = verdict.findings.some((finding) => finding.severity === "blocking" && finding.rule === rule);
    return { ...result, ...verdict, blockedForRule };
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

/**
 * Runs the reviewer over changes with a known right answer. Replaying accepted
 * commits shows how often it blocks good work. This shows the other error: how
 * often it lets a real problem through.
 */
export async function reviewCases(reviewer: AgentAdapter, config: Config, cases: ReviewCase[]): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const item of cases) results.push(await reviewCase(reviewer, config, item));
  return results;
}

function outcomeOf(result: CaseResult): string {
  if (result.skipped !== undefined) return "skipped";
  if (result.expect === "approve") return result.blocked ? "WRONGLY BLOCKED" : "approved, as it should be";
  if (!result.blocked) return "MISSED";
  return result.blockedForRule ? "caught" : "blocked for another reason";
}

export function renderCaseResults(results: CaseResult[]): string {
  const judged = results.filter((result) => result.skipped === undefined);
  const seeded = judged.filter((result) => result.expect === "block");
  const clean = judged.filter((result) => result.expect === "approve");
  const missed = seeded.filter((result) => !result.blocked);
  const wronglyBlocked = clean.filter((result) => result.blocked);
  const forTheReason = seeded.filter((result) => result.blockedForRule).length;

  const sections = [
    `# NorthStar seeded review on ${results.length} cases`,
    `The reviewer blocked ${seeded.length - missed.length} of ${seeded.length} changes with a seeded problem, ${forTheReason} of them under the rule the problem was seeded for. It blocked ${wronglyBlocked.length} of ${clean.length} clean changes.`,
    "Each case is a small hand-built change with a known right answer. A missed problem means the reviewer lets that kind of thing through. A wrongly blocked clean change means it is too strict. These cases are small and obvious on purpose, so a miss here is a strong signal and a full score is a weak one.",
    [
      "| Case | Expected | Rule | Result |",
      "| --- | --- | --- | --- |",
      ...results.map((result) => `| ${result.id} | ${result.expect} | ${result.rule ?? ""} | ${outcomeOf(result)} |`),
    ].join("\n"),
  ];
  if (missed.length > 0) {
    sections.push(["## Missed", ...missed.map((result) => `- ${result.id}: ${result.problem ?? result.title}`)].join("\n"));
  }
  for (const result of wronglyBlocked) {
    sections.push(`## Wrongly blocked: ${result.id}\n\n${formatFindings(result.findings)}`);
  }
  const skipped = results.filter((result) => result.skipped !== undefined);
  if (skipped.length > 0) {
    sections.push(["Skipped:", ...skipped.map((result) => `- ${result.id}: ${result.skipped}`)].join("\n"));
  }
  return `${sections.join("\n\n")}\n`;
}
