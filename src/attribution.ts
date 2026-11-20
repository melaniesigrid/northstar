import type { AddedLine } from "./git.js";

export interface AttributionMarker {
  file: string;
  line: number;
  text: string;
}

const AI_TOOLS = ["claude", "chatgpt", "gpt", "copilot", "codex", "gemini", "cursor", "devin", "openai", "anthropic", "ai", "llm"];
const TOOL = `(?:${AI_TOOLS.join("|")})\\b`;

// Built from parts so that this file does not contain the phrases it looks for.
const CREDIT_PATTERNS = [
  new RegExp(`co-authored-by:.*\\b${TOOL}`, "i"),
  new RegExp(`\\b(?:generated|written|created|authored|produced)\\s+(?:with|by|using)\\s+(?:an?\\s+)?${TOOL}`, "i"),
];

const MAX_SHOWN_CHARS = 80;

/**
 * Finds added lines that credit an AI tool for the work, in code, comments or
 * documentation. House rule: work that goes through the pipeline reads as
 * written by the team, with no tool signatures left in it.
 */
export function findAttributionMarkers(added: AddedLine[]): AttributionMarker[] {
  return added
    .filter(({ text }) => CREDIT_PATTERNS.some((pattern) => pattern.test(text)))
    .map(({ file, number, text }) => ({ file, line: number, text: text.trim().slice(0, MAX_SHOWN_CHARS) }));
}
