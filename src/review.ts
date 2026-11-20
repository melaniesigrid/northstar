import { FINDING_RULES, type Finding, type FindingRule } from "./types.js";

const MAX_DIFF_CHARS = 60_000;

const STANCE = `You are reviewing a change written by another coding agent. You did not write it. Do not edit any files.

Be skeptical. A reviewer's most common failure is to find a real problem and then talk itself out of reporting it. If a problem is real, report it.`;

const RUBRIC = `Judge the diff against these rules, one question each:
- reuse: Does the diff reimplement something the repo already has?
- simplicity: Could this be done with fewer moving parts and the same behavior?
- naming: Would a new team member understand each name without reading the body?
- comments: Does every comment say something the code does not?
- tests: Would each test fail if the behavior broke?
- scope: Is every changed line needed for the task?
- performance: Does the change do needless work, such as a query inside a loop, the same value computed repeatedly, or everything loaded when one item is needed?`;

const GRADING = `How to grade a finding:
- blocking: a careful human reviewer would refuse to merge. Examples: a new date formatter when the repo already exports one; a test that passes whether or not the code works; a database query inside a loop over rows.
- advisory: worth a comment, not worth stopping the merge. Examples: a name that could be clearer; a comment that adds little.`;

const OUTPUT_FORMAT = `Reply with one JSON object and nothing else:
{"findings": [{"severity": "blocking" | "advisory", "rule": "<one of the rules above>", "file": "<path>", "line": <number>, "explanation": "<one or two sentences a human can verify>", "suggestedFix": "<text or null>"}]}
Return {"findings": []} when the diff is clean.`;

/**
 * The same shape as a JSON Schema, for agents whose CLI can enforce one.
 * Every field is required and optional ones are nullable, which is what
 * OpenAI's structured output accepts.
 */
export const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["blocking", "advisory"] },
          rule: { type: "string", enum: [...FINDING_RULES] },
          file: { type: "string" },
          line: { type: "integer" },
          explanation: { type: "string" },
          suggestedFix: { type: ["string", "null"] },
        },
        required: ["severity", "rule", "file", "line", "explanation", "suggestedFix"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

export interface ReviewRequest {
  task: string;
  diff: string;
  /** The plan the writer was given, so the review can check the work against what was agreed. */
  plan?: string;
  /** How this repo is written, so "naming" and "reuse" are judged against it. */
  conventions?: string;
  /** Signals from automated checks for the reviewer to verify. They are not conclusions. */
  hints?: string[];
}

export function buildReviewPrompt({ task, diff, plan, conventions, hints = [] }: ReviewRequest): string {
  const shownDiff =
    diff.length <= MAX_DIFF_CHARS
      ? diff
      : `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated: read the changed files in the working directory for the rest]`;
  return [
    STANCE,
    `The task was:\n${task}`,
    plan && `The plan the writer was given:\n${plan}`,
    conventions,
    RUBRIC,
    GRADING,
    ...hints,
    OUTPUT_FORMAT,
    `The staged diff:\n${shownDiff}`,
  ]
    .filter((section) => section !== undefined)
    .join("\n\n");
}

export type ReviewOutcome = { ok: true; findings: Finding[] } | { ok: false; reason: string };

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(text.slice(start, end + 1));
}

function toFinding(value: unknown): Finding {
  if (typeof value !== "object" || value === null) throw new Error("a finding is not an object");
  const { severity, rule, file, line, explanation, suggestedFix } = value as Record<string, unknown>;
  if (severity !== "blocking" && severity !== "advisory") throw new Error(`unknown severity "${String(severity)}"`);
  if (!FINDING_RULES.includes(rule as FindingRule)) throw new Error(`unknown rule "${String(rule)}"`);
  if (typeof file !== "string" || typeof line !== "number" || typeof explanation !== "string") {
    throw new Error("a finding needs file, line and explanation");
  }
  return {
    severity,
    rule: rule as FindingRule,
    file,
    line,
    explanation,
    ...(typeof suggestedFix === "string" ? { suggestedFix } : {}),
  };
}

/**
 * A review that cannot be parsed is never treated as a pass: silence from the
 * reviewer must not let a diff through.
 */
export function parseFindings(reviewerMessage: string): ReviewOutcome {
  try {
    const { findings } = extractJson(reviewerMessage) as { findings?: unknown };
    if (!Array.isArray(findings)) throw new Error('missing "findings" list');
    return { ok: true, findings: findings.map(toFinding) };
  } catch (error) {
    return { ok: false, reason: `Reviewer output could not be read: ${(error as Error).message}.` };
  }
}

export function formatFindings(findings: Finding[]): string {
  return findings
    .map((finding) => {
      const fix = finding.suggestedFix ? ` Suggested fix: ${finding.suggestedFix}` : "";
      return `- [${finding.rule}] ${finding.file}:${finding.line} ${finding.explanation}${fix}`;
    })
    .join("\n");
}
