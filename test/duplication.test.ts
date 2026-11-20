import { describe, expect, it } from "vitest";
import { findClones } from "../src/duplication.js";
import { parseAddedLines } from "../src/git.js";
import { SLUGIFY_SOURCE as SLUGIFY, snapshotWithAdded } from "./helpers.js";

const UNRELATED = [
  "export function clamp(value: number, low: number, high: number): number {",
  "  if (value < low) return low;",
  "  if (value > high) return high;",
  "  const rounded = Math.round(value);",
  "  return rounded;",
  "}",
].join("\n");

const MIN_LINES = 5;

describe("findClones", () => {
  it("flags a new block that repeats existing code and points at the original", () => {
    const files = {
      "src/slug.ts": SLUGIFY,
      "src/copy.ts": `const unrelated = 1;\n${SLUGIFY}`,
    };

    const result = findClones(snapshotWithAdded(files, "src/copy.ts"), MIN_LINES);

    expect(result).toEqual({
      duplicatedLines: 5,
      clones: [{ file: "src/copy.ts", startLine: 2, endLine: 6, duplicateOf: { file: "src/slug.ts", line: 1 } }],
      dataClones: [],
    });
  });

  it("matches through differences in indentation, blank lines and comments", () => {
    const reformatted = SLUGIFY.split("\n")
      .map((line) => `    ${line}\n\n// a comment between lines`)
      .join("\n");
    const files = {
      "src/slug.ts": SLUGIFY,
      "src/copy.ts": reformatted,
    };

    expect(findClones(snapshotWithAdded(files, "src/copy.ts"), MIN_LINES).clones).toHaveLength(1);
  });

  it("does not hold duplication that predates the change against it", () => {
    const files = {
      "src/slug.ts": SLUGIFY,
      "src/old-copy.ts": SLUGIFY,
      "src/clamp.ts": UNRELATED,
    };

    expect(findClones(snapshotWithAdded(files, "src/clamp.ts"), MIN_LINES).clones).toEqual([]);
  });

  it("ignores a repeat shorter than the threshold", () => {
    const fourLines = SLUGIFY.split("\n").slice(0, 4).join("\n");
    const files = {
      "src/slug.ts": SLUGIFY,
      "src/copy.ts": fourLines,
    };

    expect(findClones(snapshotWithAdded(files, "src/copy.ts"), MIN_LINES).clones).toEqual([]);
  });

  it("ignores a repeated block when only part of it is new", () => {
    const files = {
      "src/slug.ts": SLUGIFY,
      "src/copy.ts": SLUGIFY,
    };
    const snapshot = snapshotWithAdded(files);
    snapshot.addedLines.set("src/copy.ts", new Set([1, 2, 3]));

    expect(findClones(snapshot, MIN_LINES).clones).toEqual([]);
  });

  it("flags both copies when the change itself adds the same block twice", () => {
    const files = {
      "src/a.ts": SLUGIFY,
      "src/b.ts": SLUGIFY,
    };

    const { clones } = findClones(snapshotWithAdded(files, "src/a.ts", "src/b.ts"), MIN_LINES);

    expect(clones.map((clone) => [clone.file, clone.duplicateOf.file])).toEqual([
      ["src/a.ts", "src/b.ts"],
      ["src/b.ts", "src/a.ts"],
    ]);
  });

  it("reports one clone for a long repeated block, not one per window", () => {
    const longBlock = `${SLUGIFY}\n${UNRELATED}`;
    const files = {
      "src/original.ts": longBlock,
      "src/copy.ts": longBlock,
    };

    const result = findClones(snapshotWithAdded(files, "src/copy.ts"), MIN_LINES);

    expect(result.clones).toHaveLength(1);
    expect(result.duplicatedLines).toBe(10);
  });

  it("does not treat shared import lines as copy-paste", () => {
    const imports = ["a", "b", "c", "d", "e", "f"].map((name) => `import { ${name} } from "./${name}.js";`).join("\n");
    const files = {
      "src/one.ts": imports,
      "src/two.ts": imports,
    };

    expect(findClones(snapshotWithAdded(files, "src/two.ts"), MIN_LINES).clones).toEqual([]);
  });

  it("does not treat a shared multi-line import list as copy-paste", () => {
    const importList = ["import {", "  assessments,", "  boards,", "  cards,", "  projects,", "  rubrics,", '} from "./schema.js";'].join("\n");
    const files = { "src/queries.ts": importList, "src/seed.ts": importList };

    expect(findClones(snapshotWithAdded(files, "src/seed.ts"), MIN_LINES)).toMatchObject({ clones: [], dataClones: [] });
  });

  it("ignores text embedded in a multi-line template literal", () => {
    const page = ["const html = `<!doctype html>", "<head>", "<meta charset='utf-8'>", "<title>Board</title>", "<link rel='icon' href='/i.png'>", "<link rel='stylesheet' href='/s.css'>", "</head>`;"].join("\n");
    const files = { "src/boards.ts": page, "src/kanban.ts": page };

    expect(findClones(snapshotWithAdded(files, "src/kanban.ts"), MIN_LINES)).toMatchObject({ clones: [], dataClones: [] });
  });

  it("keeps track of template literals past backticks in regexes and strings", () => {
    const styles = ["const CODE = /`([^`]+)`/g;", 'const plain = text.replace(/`/g, "");', "const tick = '`';", "const CSS = `", ":root {", "--paper: #121a18;", "--card: #18211f;", "--ink: #e9ece7;", "--sea: #6fae9d;", "--ready: #79c497;", "}`;"].join("\n");
    const files = { "scripts/page.mjs": styles, "scripts/prompts.mjs": styles };

    expect(findClones(snapshotWithAdded(files, "scripts/prompts.mjs"), MIN_LINES)).toMatchObject({ clones: [], dataClones: [] });
  });

  it("reports repeated literal values separately, for a reviewer to judge", () => {
    const statuses = ['"not_started",', '"in_progress",', '"met",', '"waived",', '"not_applicable",'].join("\n");
    const files = { "src/types.ts": statuses, "src/row.tsx": statuses };

    const result = findClones(snapshotWithAdded(files, "src/row.tsx"), MIN_LINES);

    expect(result.clones).toEqual([]);
    expect(result.duplicatedLines).toBe(0);
    expect(result.dataClones).toEqual([
      { file: "src/row.tsx", startLine: 1, endLine: 5, duplicateOf: { file: "src/types.ts", line: 1 } },
    ]);
  });

  it("treats a repeated block of plain field mappings as data, not logic", () => {
    const mapping = ["slug: seed.slug,", "name: seed.name,", "summary: seed.summary,", "status: seed.status,", "color: seed.color,", "productionUrl: seed.productionUrl ?? null,"].join("\n");
    const files = { "src/seed.ts": mapping, "scripts/portfolio.mjs": mapping };

    const result = findClones(snapshotWithAdded(files, "scripts/portfolio.mjs"), MIN_LINES);

    expect(result.clones).toEqual([]);
    expect(result.dataClones).toHaveLength(1);
  });

  it("does not match a run of identical lines against itself", () => {
    const files = { "src/fill.ts": Array.from({ length: 7 }, () => "rows.push(nextRow());").join("\n") };

    expect(findClones(snapshotWithAdded(files, "src/fill.ts"), MIN_LINES).clones).toEqual([]);
  });
});

describe("parseAddedLines", () => {
  it("collects added line numbers per file and skips deleted files", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@",
      "+first",
      "+second",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "diff --git a/src/gone.ts b/src/gone.ts",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-bye",
      "-bye",
    ].join("\n");

    expect(parseAddedLines(diff)).toEqual(new Map([["src/a.ts", new Set([4, 5, 12])]]));
  });

  it("does not mistake added content that starts with ++ for a file header", () => {
    const diff = ["--- a/notes.ts", "+++ b/notes.ts", "@@ -0,0 +1,2 @@", "+++ counter;", "+done();"].join("\n");

    expect(parseAddedLines(diff)).toEqual(new Map([["notes.ts", new Set([1, 2])]]));
  });
});
