import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline, type PipelineInput } from "../src/pipeline.js";
import type { AgentAdapter, Config } from "../src/types.js";
import {
  CLEAN_REVIEW,
  createTempRepo,
  fakeAgent,
  gitIn,
  newRunId,
  SLUGIFY_SOURCE,
  testConfig,
  writeFileTurn,
} from "./helpers.js";

function pipelineInput(
  writer: AgentAdapter,
  reviewer: AgentAdapter,
  config: Partial<Config> = {},
  repoRoot = createTempRepo(),
): PipelineInput {
  return {
    task: "Add feature.txt",
    runId: newRunId(),
    repoRoot,
    baseRef: "HEAD",
    config: testConfig(config),
    writer,
    reviewer,
  };
}

const BLOCKING_REVIEW = () =>
  JSON.stringify({
    findings: [
      { severity: "blocking", rule: "reuse", file: "feature.txt", line: 1, explanation: "Duplicates README." },
    ],
  });

describe("runPipeline", () => {
  it("commits the change on its own branch when gates and review pass", async () => {
    const input = pipelineInput(
      fakeAgent("a", [writeFileTurn("feature.txt", "hello\n")]),
      fakeAgent("b", [CLEAN_REVIEW]),
    );

    const outcome = await runPipeline(input);

    expect(outcome.status).toBe("passed");
    expect(outcome.attempts).toHaveLength(1);
    expect(gitIn(input.repoRoot, "show", `${outcome.branch}:feature.txt`)).toBe("hello\n");
    expect(outcome.worktreePath).toBeUndefined();
  });

  it("sends a failed gate back to the writer with the gate's name", async () => {
    const writer = fakeAgent("a", [
      writeFileTurn("feature.txt", "broken\n"),
      writeFileTurn("feature.txt", "fixed\n"),
    ]);
    const input = pipelineInput(writer, fakeAgent("b", [CLEAN_REVIEW]), {
      gates: [{ name: "content", command: "grep -q fixed feature.txt" }],
    });

    const outcome = await runPipeline(input);

    expect(outcome.status).toBe("passed");
    expect(outcome.attempts.map((attempt) => attempt.failure?.stage)).toEqual(["gate", undefined]);
    expect(writer.prompts[1]).toContain('The "content" gate failed');
  });

  it("stops for a human when the reviewer keeps blocking, and commits nothing", async () => {
    const writer = fakeAgent("a", [writeFileTurn("feature.txt", "one\n"), writeFileTurn("feature.txt", "two\n")]);
    const input = pipelineInput(writer, fakeAgent("b", [BLOCKING_REVIEW, BLOCKING_REVIEW]), { maxIterations: 2 });
    const baseCommit = gitIn(input.repoRoot, "rev-parse", "HEAD");

    const outcome = await runPipeline(input);

    expect(outcome.status).toBe("needs_human");
    expect(outcome.attempts).toHaveLength(2);
    expect(writer.prompts[1]).toContain("Duplicates README.");
    expect(gitIn(input.repoRoot, "rev-parse", outcome.branch)).toBe(baseCommit);
    expect(existsSync(outcome.worktreePath ?? "")).toBe(true);
  });

  it("discards anything the reviewer writes", async () => {
    const meddlingReviewer = fakeAgent("b", [
      (spec) => {
        writeFileSync(path.join(spec.cwd, "sneaky.txt"), "reviewer was here\n");
        writeFileSync(path.join(spec.cwd, "feature.txt"), "rewritten by reviewer\n");
        return '{"findings": []}';
      },
    ]);
    const input = pipelineInput(fakeAgent("a", [writeFileTurn("feature.txt", "hello\n")]), meddlingReviewer);

    const outcome = await runPipeline(input);

    const committedFiles = gitIn(input.repoRoot, "ls-tree", "--name-only", outcome.branch).split("\n");
    expect(committedFiles).not.toContain("sneaky.txt");
    expect(gitIn(input.repoRoot, "show", `${outcome.branch}:feature.txt`)).toBe("hello\n");
  });

  it("never treats an unreadable review as a pass, and does not retry the writer for it", async () => {
    const writer = fakeAgent("a", [writeFileTurn("feature.txt", "hello\n")]);
    const input = pipelineInput(writer, fakeAgent("b", [() => "Looks good to me!"]));

    const outcome = await runPipeline(input);

    expect(outcome.status).toBe("needs_human");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.failure).toMatchObject({ stage: "review", retryable: false });
  });

  it("rejects a change that exceeds the line budget before running any gate", async () => {
    const writer = fakeAgent("a", [writeFileTurn("feature.txt", "1\n2\n3\n4\n5\n")]);
    const input = pipelineInput(writer, fakeAgent("b", []), { maxChangedLines: 2, maxIterations: 1 });

    const outcome = await runPipeline(input);

    expect(outcome.attempts[0]?.failure?.stage).toBe("scope");
    expect(outcome.attempts[0]?.gates).toEqual([]);
  });

  it("blocks new code that copies an existing helper and tells the writer where the original is", async () => {
    const helper = `${SLUGIFY_SOURCE}\n`;
    const repoRoot = createTempRepo();
    writeFileSync(path.join(repoRoot, "slug.ts"), helper);
    gitIn(repoRoot, "add", "-A");
    gitIn(repoRoot, "commit", "-q", "-m", "add slugify");
    const writer = fakeAgent("a", [
      (spec) => {
        writeFileSync(path.join(spec.cwd, "feature.txt"), "uses a slug\n");
        writeFileSync(path.join(spec.cwd, "copy.ts"), helper);
        return "done";
      },
      writeFileTurn("copy.ts", 'export { slugify } from "./slug.js";\n'),
    ]);

    const outcome = await runPipeline(pipelineInput(writer, fakeAgent("b", [CLEAN_REVIEW]), {}, repoRoot));

    expect(outcome.attempts.map((attempt) => attempt.failure?.stage)).toEqual(["slop", undefined]);
    expect(writer.prompts[1]).toContain("copy.ts:1-5 repeats slug.ts:1");
    expect(outcome.attempts[1]?.slop?.duplication.duplicatedLines).toBe(0);
  });

  it("lets a new page repeat the markup every page shares", async () => {
    const page = ["<head>", "<meta charset='utf-8'>", "<title>Site</title>", "<link rel='icon' href='/i.png'>", "<link rel='stylesheet' href='/s.css'>", "</head>"].join("\n");
    const repoRoot = createTempRepo();
    writeFileSync(path.join(repoRoot, "index.html"), page);
    gitIn(repoRoot, "add", "-A");
    gitIn(repoRoot, "commit", "-q", "-m", "add home page");
    const writer = fakeAgent("a", [
      (spec) => {
        writeFileSync(path.join(spec.cwd, "feature.txt"), "about page\n");
        writeFileSync(path.join(spec.cwd, "about.html"), page);
        return "done";
      },
    ]);

    const outcome = await runPipeline(pipelineInput(writer, fakeAgent("b", [CLEAN_REVIEW]), {}, repoRoot));

    expect(outcome.status).toBe("passed");
  });

  it("blocks a change that silences the type checker and names the line", async () => {
    const writer = fakeAgent("a", [
      (spec) => {
        writeFileSync(path.join(spec.cwd, "feature.txt"), "typed value\n");
        writeFileSync(path.join(spec.cwd, "value.ts"), "export const parsed = JSON.parse(raw) as any;\n");
        return "done";
      },
      writeFileTurn("value.ts", "export const parsed: unknown = JSON.parse(raw);\n"),
    ]);

    const outcome = await runPipeline(pipelineInput(writer, fakeAgent("b", [CLEAN_REVIEW])));

    expect(outcome.attempts.map((attempt) => attempt.failure?.stage)).toEqual(["slop", undefined]);
    expect(writer.prompts[1]).toContain("value.ts:1 cast to any");
  });

  it("blocks a change that credits an AI tool, even in documentation", async () => {
    const credit = ["Generated", "with", "Claude"].join(" ");
    const writer = fakeAgent("a", [
      (spec) => {
        writeFileSync(path.join(spec.cwd, "feature.txt"), "feature\n");
        writeFileSync(path.join(spec.cwd, "NOTES.md"), `# Notes\n\n${credit}\n`);
        return "done";
      },
      writeFileTurn("NOTES.md", "# Notes\n"),
    ]);

    const outcome = await runPipeline(pipelineInput(writer, fakeAgent("b", [CLEAN_REVIEW])));

    expect(outcome.attempts.map((attempt) => attempt.failure?.stage)).toEqual(["slop", undefined]);
    expect(writer.prompts[1]).toContain("NOTES.md:3");
  });

  it("asks the reviewer to verify new symbols that nothing references", async () => {
    const writer = fakeAgent("a", [
      (spec) => {
        writeFileSync(path.join(spec.cwd, "feature.txt"), "feature\n");
        writeFileSync(path.join(spec.cwd, "orphan.ts"), "export function orphanHelper() {}\n");
        return "done";
      },
    ]);
    const reviewer = fakeAgent("b", [CLEAN_REVIEW]);

    await runPipeline(pipelineInput(writer, reviewer));

    expect(reviewer.prompts[0]).toContain("orphan.ts:1 orphanHelper");
  });

  it("points the writer to an existing helper the task could reuse", async () => {
    const repoRoot = createTempRepo();
    writeFileSync(path.join(repoRoot, "slug.ts"), `${SLUGIFY_SOURCE}\n`);
    gitIn(repoRoot, "add", "-A");
    gitIn(repoRoot, "commit", "-q", "-m", "add slugify");
    const writer = fakeAgent("a", [writeFileTurn("feature.txt", "slugged\n")]);
    const input = pipelineInput(writer, fakeAgent("b", [CLEAN_REVIEW]), {}, repoRoot);

    const outcome = await runPipeline({ ...input, task: "Slugify the feature name in feature.txt" });

    expect(writer.prompts[0]).toContain("- slugify (slug.ts:1)");
    expect(outcome.suggestedHelpers).toEqual([{ name: "slugify", file: "slug.ts", line: 1, exported: true }]);
  });

  it("gives both agents the rules a person wrote into the committed profile", async () => {
    const repoRoot = createTempRepo();
    writeFileSync(path.join(repoRoot, "northstar.profile.json"), JSON.stringify({ notes: ["Store dates in UTC."] }));
    gitIn(repoRoot, "add", "-A");
    gitIn(repoRoot, "commit", "-q", "-m", "add profile");
    const writer = fakeAgent("a", [writeFileTurn("feature.txt", "feature\n")]);
    const reviewer = fakeAgent("b", [CLEAN_REVIEW]);

    await runPipeline(pipelineInput(writer, reviewer, {}, repoRoot));

    expect(writer.prompts[0]).toContain("- Store dates in UTC.");
    expect(reviewer.prompts[0]).toContain("- Store dates in UTC.");
  });

  it("stops before any agent runs when setup fails", async () => {
    const writer = fakeAgent("a", []);
    const input = pipelineInput(writer, fakeAgent("b", []), { setup: ["exit 3"] });

    const outcome = await runPipeline(input);

    expect(outcome.status).toBe("needs_human");
    expect(outcome.setupFailure).toContain('Setup command "exit 3" failed');
    expect(writer.prompts).toEqual([]);
  });

  it("flags a review done by the writer's own vendor", async () => {
    const input = pipelineInput(
      fakeAgent("same", [writeFileTurn("feature.txt", "hello\n")]),
      fakeAgent("same", [CLEAN_REVIEW]),
    );

    const outcome = await runPipeline(input);

    expect(outcome.sameVendorReview).toBe(true);
  });
});
