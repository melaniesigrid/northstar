import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadTasks, renderBenchmark, runBenchmark, type BenchInput, type BenchTask } from "../src/bench.js";
import { CLEAN_REVIEW, createTempRepo, fakeAgent, gitIn, newRunId, SLUGIFY_SOURCE, testConfig, writeFileTurn } from "./helpers.js";

/** A repo that already has a slugify helper, which a careless change might copy. */
function repoWithHelper(): string {
  const repo = createTempRepo();
  writeFileSync(path.join(repo, "slug.ts"), `${SLUGIFY_SOURCE}\n`);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", "Add slugify");
  return repo;
}

const copiesTheHelper = writeFileTurn("feature.ts", `${SLUGIFY_SOURCE}\n`);
const importsTheHelper = writeFileTurn("feature.ts", 'export { slugify as featureSlug } from "./slug.js";\n');

function benchInput(repoRoot: string, writerTurns: Parameters<typeof fakeAgent>[1], reviews: number): BenchInput {
  return {
    benchId: newRunId(),
    repoRoot,
    config: testConfig({ gates: [{ name: "exists", command: "test -f feature.ts" }] }),
    writer: fakeAgent("a", writerTurns),
    reviewer: fakeAgent("b", Array.from({ length: reviews }, () => CLEAN_REVIEW)),
  };
}

const TASK: BenchTask = { id: "slug-feature", prompt: "Add a featureSlug export", baseCommit: "HEAD" };

describe("runBenchmark", () => {
  it("scores the writer alone and the pipeline from the same starting point", async () => {
    // The writer copies the helper every time it is asked cold, and fixes it when told why it was rejected.
    const input = benchInput(repoWithHelper(), [copiesTheHelper, copiesTheHelper, importsTheHelper], 1);

    const [result] = await runBenchmark(input, [TASK]);

    expect(result?.raw).toMatchObject({ clean: false, gatesPassed: true, attempts: 1 });
    expect(result?.raw.slop?.duplication.duplicatedLines).toBe(5);
    expect(result?.pipeline).toMatchObject({ clean: true, gatesPassed: true, attempts: 2 });
    expect(result?.pipelinePassed).toBe(true);
  });

  it("gives the lone writer the task and nothing the pipeline would add", async () => {
    const input = benchInput(repoWithHelper(), [importsTheHelper, importsTheHelper], 1);

    await runBenchmark(input, [TASK]);

    const [rawPrompt, pipelinePrompt] = (input.writer as ReturnType<typeof fakeAgent>).prompts;
    expect(rawPrompt).toBe("Add a featureSlug export\n\nDo not commit. Leave your changes in the working directory.");
    expect(pipelinePrompt).toContain("Done when:");
  });

  it("counts a writer that changes nothing as not clean", async () => {
    const input = benchInput(repoWithHelper(), [() => "done", importsTheHelper], 1);
    input.config = testConfig({ gates: [{ name: "always", command: "true" }] });

    const [result] = await runBenchmark(input, [TASK]);

    expect(result?.raw).toMatchObject({ clean: false, linesChanged: 0 });
  });

  it("leaves the user's checkout and branch untouched by the raw arm", async () => {
    const repo = repoWithHelper();
    const headBefore = gitIn(repo, "rev-parse", "HEAD");

    await runBenchmark(benchInput(repo, [importsTheHelper, importsTheHelper], 1), [TASK]);

    expect(gitIn(repo, "rev-parse", "HEAD")).toBe(headBefore);
    expect(gitIn(repo, "status", "--porcelain")).toBe("");
  });
});

describe("renderBenchmark", () => {
  it("leads with how many tasks each arm finished clean", async () => {
    const input = benchInput(repoWithHelper(), [copiesTheHelper, copiesTheHelper, importsTheHelper], 1);

    const report = renderBenchmark(await runBenchmark(input, [TASK]));

    expect(report).toContain("- Writer alone: 0 of 1 clean");
    expect(report).toContain("- Through the pipeline: 1 of 1 clean, 1 of 1 also approved by the reviewer");
    expect(report).toContain("| slug-feature | alone | no | passed |");
    expect(report).toContain("| slug-feature | pipeline | yes | passed |");
  });
});

describe("loadTasks", () => {
  it("reads one task per folder, in name order, with the commit to start from", async () => {
    const repo = createTempRepo();
    for (const [id, meta] of [["b-second", "{}"], ["a-first", '{"baseCommit": "abc123"}']] as const) {
      mkdirSync(path.join(repo, "tasks", id), { recursive: true });
      writeFileSync(path.join(repo, "tasks", id, "task.md"), `Do ${id}\n`);
      writeFileSync(path.join(repo, "tasks", id, "meta.json"), meta);
    }

    expect(await loadTasks(path.join(repo, "tasks"))).toEqual([
      { id: "a-first", prompt: "Do a-first", baseCommit: "abc123" },
      { id: "b-second", prompt: "Do b-second", baseCommit: "HEAD" },
    ]);
  });

  it("names the folder when a task has no prompt", async () => {
    const repo = createTempRepo();
    mkdirSync(path.join(repo, "tasks", "empty"), { recursive: true });

    await expect(loadTasks(path.join(repo, "tasks"))).rejects.toThrow("has no task.md");
  });
});
