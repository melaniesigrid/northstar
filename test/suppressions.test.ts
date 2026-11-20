import { describe, expect, it } from "vitest";
import { findSuppressions } from "../src/suppressions.js";
import { snapshotWithAdded } from "./helpers.js";

function directivesIn(...lines: string[]): string[] {
  const snapshot = snapshotWithAdded({ "src/change.ts": lines.join("\n") }, "src/change.ts");
  return findSuppressions(snapshot).map((suppression) => suppression.directive);
}

describe("findSuppressions", () => {
  it.each([
    ["// eslint-disable-next-line no-console", "eslint-disable"],
    ["/* eslint-disable */", "eslint-disable"],
    ["// @ts-ignore", "@ts-ignore"],
    ["// @ts-expect-error wrong type on purpose", "@ts-expect-error"],
    ["const value = input as any;", "cast to any"],
    ["function run(input: any) {}", "any annotation"],
    ["const cache: Record<string, any> = {};", "any type argument"],
    ["result = compute()  # type: ignore", "type: ignore"],
    ["import os  # noqa", "noqa"],
  ])("flags %s", (line, directive) => {
    expect(directivesIn(line)).toEqual([directive]);
  });

  it("reports the file and line of each suppression", () => {
    const snapshot = snapshotWithAdded({ "src/a.ts": "const ok = 1;\nconst bad = ok as any;" }, "src/a.ts");

    expect(findSuppressions(snapshot)).toEqual([{ file: "src/a.ts", line: 2, directive: "cast to any" }]);
  });

  it("leaves suppressions that were already in the repo alone", () => {
    const snapshot = snapshotWithAdded({ "src/old.ts": "const legacy = thing as any;", "src/new.ts": "const fresh = 1;" }, "src/new.ts");

    expect(findSuppressions(snapshot)).toEqual([]);
  });

  it.each([
    ['throw new Error("Expected: any of the listed values");'],
    ['const tip = "silence it with // eslint-disable-next-line";'],
    ["const count = total; // accepts: any whole number"],
    ["const options: anyOf = schema;"],
    ["const company = rows.find((row) => row.many);"],
  ])("does not flag %s", (line) => {
    expect(directivesIn(line)).toEqual([]);
  });
});
