import { addedLinesOf, type ChangeSnapshot } from "./snapshot.js";
import { STRING_LITERAL } from "./source-lines.js";

export interface Suppression {
  file: string;
  line: number;
  /** Which kind of escape hatch the line uses, for example "@ts-ignore". */
  directive: string;
}

/** Directives that only mean something inside a comment. */
const COMMENT_DIRECTIVES = [
  "eslint-disable",
  "@ts-ignore",
  "@ts-expect-error",
  "@ts-nocheck",
  "biome-ignore",
  "type: ignore",
  "noqa",
  "nolint",
  "rubocop:disable",
];

/** Escapes written in code itself. */
const CODE_ESCAPES: [directive: string, pattern: RegExp][] = [
  ["cast to any", /\bas\s+any\b/],
  ["any annotation", /:\s*any\b/],
  ["any type argument", /[<,]\s*any\s*[>,]/],
];

const COMMENT_START = String.raw`(?://|/\*|#)\s*`;
const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMMENT_PATTERNS = COMMENT_DIRECTIVES.map(
  (directive): [string, RegExp] => [directive, new RegExp(COMMENT_START + escapeForRegExp(directive))],
);

const COMMENT_TEXT = /\/\/.*$|\/\*.*?\*\//g;

/**
 * String contents are dropped first, so text that merely mentions a directive
 * is not read as one. Comments are dropped before looking for code escapes, so
 * prose such as "accepts: any value" is not read as a type annotation.
 */
function directiveIn(line: string): string | undefined {
  const withoutStrings = line.replace(STRING_LITERAL, '""');
  const comment = COMMENT_PATTERNS.find(([, pattern]) => pattern.test(withoutStrings));
  if (comment) return comment[0];
  const codeOnly = withoutStrings.replace(COMMENT_TEXT, "");
  return CODE_ESCAPES.find(([, pattern]) => pattern.test(codeOnly))?.[0];
}

/**
 * Finds lint and type-checker escape hatches the change adds. Silencing a
 * check is the cheapest way for an agent to make a gate pass, so new ones are
 * counted and, past the configured limit, blocked.
 */
export function findSuppressions(snapshot: ChangeSnapshot): Suppression[] {
  const suppressions: Suppression[] = [];
  for (const { file, number, text } of addedLinesOf(snapshot)) {
    const directive = directiveIn(text);
    if (directive) suppressions.push({ file, line: number, directive });
  }
  return suppressions;
}
