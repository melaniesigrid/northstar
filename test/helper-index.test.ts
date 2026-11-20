import { describe, expect, it } from "vitest";
import { findRelevantHelpers, formatHelpers, indexHelpers, type Helper } from "../src/helper-index.js";

const names = (helpers: Helper[]): string[] => helpers.map((helper) => helper.name);

describe("indexHelpers", () => {
  it("lists top-level declarations with where they live and whether they are exported", () => {
    const files = new Map([
      ["src/strings.ts", "const SEPARATOR = '-';\nexport function slugify(input: string) {}\nexport const MAX_SLUG = 80;"],
      ["tools/report.py", "def build_report():\n    def inner():\n        pass"],
    ]);

    expect(indexHelpers(files)).toEqual([
      { name: "SEPARATOR", file: "src/strings.ts", line: 1, exported: false },
      { name: "slugify", file: "src/strings.ts", line: 2, exported: true },
      { name: "MAX_SLUG", file: "src/strings.ts", line: 3, exported: true },
      { name: "build_report", file: "tools/report.py", line: 1, exported: true },
    ]);
  });

  it("leaves out helpers that only exist for tests", () => {
    const files = new Map([["test/helpers.ts", "export function fakeAgent() {}"]]);

    expect(indexHelpers(files)).toEqual([]);
  });
});

describe("findRelevantHelpers", () => {
  const helper = (name: string, file: string, exported = true): Helper => ({ name, file, line: 1, exported });
  const helpers = [
    helper("slugify", "src/strings.ts"),
    helper("formatDueDate", "src/dates.ts"),
    helper("parseDate", "src/dates.ts"),
    helper("createInvoice", "src/billing.ts"),
    helper("getValue", "src/store.ts"),
  ];

  it("finds a helper the task names outright", () => {
    expect(names(findRelevantHelpers("Slugify the article title before saving", helpers))).toEqual(["slugify"]);
  });

  it("matches across plurals and ranks the closest name first", () => {
    expect(names(findRelevantHelpers("Show due dates on each card", helpers))).toEqual(["formatDueDate", "parseDate"]);
  });

  it("matches a word to a longer form of itself, but not to a different word that starts the same", () => {
    const candidates = [helper("useShareable", "src/share.js"), helper("formatDate", "src/dates.ts")];

    expect(names(findRelevantHelpers("Add a share link to the form", candidates))).toEqual(["useShareable"]);
  });

  it("does not match on words that fit almost any task", () => {
    expect(findRelevantHelpers("Create a new value and get the data", helpers)).toEqual([]);
  });

  it("says when a helper still needs exporting before it can be reused", () => {
    const found = findRelevantHelpers("Use the mean of returns", [helper("mean", "src/causal.ts", false)]);

    expect(formatHelpers(found)).toBe("- mean (src/causal.ts:1, not exported yet)");
  });

  it("returns at most the requested number", () => {
    expect(findRelevantHelpers("due date parsing and formatting", helpers, 1)).toHaveLength(1);
  });
});
