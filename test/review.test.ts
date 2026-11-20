import { describe, expect, it } from "vitest";
import { buildReviewPrompt, parseFindings } from "../src/review.js";

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

describe("buildReviewPrompt", () => {
  it("truncates a very large diff and tells the reviewer where to read the rest", () => {
    const prompt = buildReviewPrompt({ task: "task", diff: "x".repeat(100_000) });

    expect(prompt.length).toBeLessThan(70_000);
    expect(prompt).toContain("diff truncated");
  });
});
