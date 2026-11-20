import { describe, expect, it } from "vitest";
import { findUnreferencedSymbols } from "../src/unreferenced.js";
import { snapshotWithAdded } from "./helpers.js";

function unreferencedNames(files: Record<string, string>, ...addedFiles: string[]): string[] {
  return findUnreferencedSymbols(snapshotWithAdded(files, ...addedFiles)).map((symbol) => symbol.name);
}

describe("findUnreferencedSymbols", () => {
  it("flags a new top-level symbol whose name appears nowhere else", () => {
    const snapshot = snapshotWithAdded(
      { "src/dates.ts": "export const ZONE = 'UTC';\nexport function formatLegacyDate() {}" },
      "src/dates.ts",
    );

    expect(findUnreferencedSymbols(snapshot)).toEqual([
      { file: "src/dates.ts", line: 1, name: "ZONE" },
      { file: "src/dates.ts", line: 2, name: "formatLegacyDate" },
    ]);
  });

  it("accepts a symbol that another file uses", () => {
    const files = {
      "src/dates.ts": "export function formatDate() {}",
      "src/app.ts": "render(formatDate());",
    };

    expect(unreferencedNames(files, "src/dates.ts")).toEqual([]);
  });

  it("accepts a symbol used later in its own file", () => {
    expect(unreferencedNames({ "src/a.ts": "const LIMIT = 3;\nexport const cap = Math.min(LIMIT, size);\nuse(cap);" }, "src/a.ts")).toEqual([]);
  });

  it("leaves unused symbols that were already in the repo alone", () => {
    const files = { "src/old.ts": "export function forgotten() {}", "src/new.ts": "start();" };

    expect(unreferencedNames(files, "src/new.ts")).toEqual([]);
  });

  it("skips nested declarations, which compilers and linters already cover", () => {
    expect(unreferencedNames({ "src/a.ts": "run(() => {\n  const scratch = 1;\n});" }, "src/a.ts")).toEqual([]);
  });

  it.each([
    ["a default export", "export default function Page() {}"],
    ["a main function", "function main() {}"],
    ["a Python test", "def test_totals():"],
    ["a Go test", "func TestTotals(t *testing.T) {"],
  ])("skips %s, which is found by convention", (_label, line) => {
    expect(unreferencedNames({ "src/entry.txt": line }, "src/entry.txt")).toEqual([]);
  });

  it.each([
    ["class", "export class LegacyParser {}", "LegacyParser"],
    ["type", "export type LegacyShape = { id: string };", "LegacyShape"],
    ["Python function", "def build_legacy_report():", "build_legacy_report"],
    ["Go function", "func buildLegacyReport() {", "buildLegacyReport"],
  ])("recognizes a %s declaration", (_label, line, name) => {
    expect(unreferencedNames({ "src/code.txt": line }, "src/code.txt")).toEqual([name]);
  });
});
