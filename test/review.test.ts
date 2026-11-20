import { describe, expect, it } from "vitest";
import { buildReviewPrompt, FINDINGS_SCHEMA, parseFindings } from "../src/review.js";

describe("parseFindings", () => {
  it("reads findings even when the reviewer wraps the JSON in prose or a code fence", () => {
    const message = [
      "Here is my review:",
      "```json",
      '{"findings": [{"severity": "advisory", "rule": "naming", "file": "a.ts", "line": 3, "explanation": "Vague name."}]}',
      "```",
    ].join("\n");

    expect(parseFindings(message)).toEqual({
      ok: true,
      findings: [{ severity: "advisory", rule: "naming", file: "a.ts", line: 3, explanation: "Vague name." }],
    });
  });

  it("reads a structured finding with no suggested fix and the performance rule", () => {
    const message = JSON.stringify({
      findings: [
        { severity: "blocking", rule: "performance", file: "a.ts", line: 9, explanation: "Query in a loop.", suggestedFix: null },
      ],
    });

    expect(parseFindings(message)).toEqual({
      ok: true,
      findings: [{ severity: "blocking", rule: "performance", file: "a.ts", line: 9, explanation: "Query in a loop." }],
    });
  });

  it("accepts an empty list as a clean review", () => {
    expect(parseFindings('{"findings": []}')).toEqual({ ok: true, findings: [] });
  });

  it.each([
    ["plain prose", "Looks good to me!"],
    ["a missing findings list", '{"verdict": "pass"}'],
    ["an unknown severity", '{"findings": [{"severity": "meh", "rule": "naming", "file": "a", "line": 1, "explanation": "x"}]}'],
    ["an unknown rule", '{"findings": [{"severity": "blocking", "rule": "vibes", "file": "a", "line": 1, "explanation": "x"}]}'],
    ["a finding without a location", '{"findings": [{"severity": "blocking", "rule": "naming", "explanation": "x"}]}'],
  ])("rejects %s", (_label, message) => {
    expect(parseFindings(message).ok).toBe(false);
  });
});

describe("FINDINGS_SCHEMA", () => {
  it("requires every field at every level, which strict structured output demands", () => {
    const finding = FINDINGS_SCHEMA.properties.findings.items;

    expect(FINDINGS_SCHEMA.additionalProperties).toBe(false);
    expect(finding.additionalProperties).toBe(false);
    expect([...finding.required].sort()).toEqual(Object.keys(finding.properties).sort());
  });
});

describe("buildReviewPrompt", () => {
  it("tells the reviewer to be skeptical and shows what blocking means", () => {
    const prompt = buildReviewPrompt({ task: "task", diff: "diff" });

    expect(prompt).toContain("talk itself out of reporting it");
    expect(prompt).toContain("- performance:");
    expect(prompt).toContain("a careful human reviewer would refuse to merge");
  });

  it("truncates a very large diff and tells the reviewer where to read the rest", () => {
    const prompt = buildReviewPrompt({ task: "task", diff: "x".repeat(100_000) });

    expect(prompt.length).toBeLessThan(70_000);
    expect(prompt).toContain("diff truncated");
  });
});
