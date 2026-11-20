import { describe, expect, it } from "vitest";
import { analyzeSlop, describeBlockingSlop, reviewerHints } from "../src/slop.js";
import { SLUGIFY_SOURCE, snapshotWithAdded, testConfig } from "./helpers.js";

const STATUS_LIST = ['"not_started",', '"in_progress",', '"met",', '"waived",', '"not_applicable",'].join("\n");

describe("slop report", () => {
  it("blocks on repeated code but only hints at repeated data and unreferenced symbols", () => {
    const snapshot = snapshotWithAdded(
      {
        "src/types.ts": STATUS_LIST,
        "src/slug.ts": SLUGIFY_SOURCE,
        "src/new.ts": `${STATUS_LIST}\nexport function orphanHelper() {}`,
      },
      "src/new.ts",
    );

    const report = analyzeSlop(snapshot, testConfig());

    expect(describeBlockingSlop(report, testConfig())).toBeUndefined();
    expect(reviewerHints(report).join("\n")).toContain("src/new.ts:6 orphanHelper");
    expect(reviewerHints(report).join("\n")).toContain("src/new.ts:1-5 repeats src/types.ts:1");
  });

  it("allows suppressions up to the configured limit", () => {
    const snapshot = snapshotWithAdded({ "src/a.ts": "const one = raw as any;" }, "src/a.ts");
    const report = analyzeSlop(snapshot, testConfig());

    expect(describeBlockingSlop(report, testConfig({ maxNewSuppressions: 0 }))).toContain("src/a.ts:1 cast to any");
    expect(describeBlockingSlop(report, testConfig({ maxNewSuppressions: 1 }))).toBeUndefined();
  });

  it("gives the reviewer no hints for a clean change", () => {
    const snapshot = snapshotWithAdded({ "src/a.ts": "start();" }, "src/a.ts");

    expect(reviewerHints(analyzeSlop(snapshot, testConfig()))).toEqual([]);
  });
});
