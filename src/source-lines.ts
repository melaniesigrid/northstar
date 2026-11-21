export const STRING_LITERAL = /(["'`])(?:\\.|(?!\1).)*\1/g;

export interface SourceLine {
  number: number;
  text: string;
  /**
   * True when the line declares a value without computing anything: a list
   * entry, a `key: "value"` pair, a union member, or a plain field mapping
   * such as `title: row.title,`.
   */
  isData: boolean;
}

// Lines that repeat across files for good reasons and say nothing about copy-paste.
const COMMENT = /^(\/\/|\/\*|\*|#[ !]|<!--)/;
const IMPORT = /^(import\b|from\b|export \* from\b|\} from\b|#include\b|using\b|package\b)/;
const HAS_SUBSTANCE = /[A-Za-z0-9].*[A-Za-z0-9]/;

/** `import {`, `export {` or Python's `from x import (`, with the names on the lines that follow. */
const IMPORT_BLOCK_OPEN = /^(import\s.*[{(]|export\s+(type\s+)?\{|from\s.*\()$/;
const BLOCK_CLOSE = /^[})]/;
const UNESCAPED_BACKTICK = /(?<!\\)`/g;
const QUOTED = /(["'])(?:\\.|(?!\1).)*\1/g;
const REGEX_LITERAL = /(^|[=(,:;!&|?{}[\s])\/(?![/*\s])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[a-z]*/g;

const LEADING_KEY = /^[\w$-]+\??\s*:/;
const LITERALS = /#[0-9a-fA-F]{3,8}\b|\b\d[\w.]*|\b(?:true|false|null|undefined)\b/g;
/** What is left of `title: row.title,` or `url: seed.url ?? null,` once the key and literals are gone. */
const PLAIN_REFERENCE = /^\s*[\w$]+(?:\??\.[\w$]+)*\s*(?:\?\?)?\s*,?\s*$/;

/** Outside a template, a backtick inside a quoted string or a regex literal does not open one. */
function countTemplateDelimiters(raw: string, insideTemplate: boolean): number {
  const text = insideTemplate ? raw : raw.replace(QUOTED, "").replace(REGEX_LITERAL, "$1");
  return text.match(UNESCAPED_BACKTICK)?.length ?? 0;
}

function isDataOnly(text: string): boolean {
  const rest = text.replace(STRING_LITERAL, "").replace(LEADING_KEY, "").replace(LITERALS, "");
  return !/[A-Za-z_$]/.test(rest) || PLAIN_REFERENCE.test(rest);
}

interface RawLine {
  number: number;
  raw: string;
  /** How many template delimiters the line holds, counted with strings and regex literals set aside. */
  backticks: number;
  /** The line started inside a multi-line template literal. */
  startsInTemplate: boolean;
}

/** Walks a file's lines while keeping track of multi-line template literals. */
function* rawLines(content: string): Generator<RawLine> {
  let insideTemplate = false;
  let number = 0;
  for (const raw of content.split("\n")) {
    number += 1;
    const backticks = countTemplateDelimiters(raw, insideTemplate);
    yield { number, raw, backticks, startsInTemplate: insideTemplate };
    if (backticks % 2 === 1) insideTemplate = !insideTemplate;
  }
}

/**
 * The lines of a file worth comparing, trimmed. Left out: blank and
 * bracket-only lines, comments, imports including multi-line name lists, and
 * the body of multi-line template literals, which is embedded text such as
 * HTML or CSS rather than code.
 */
export function meaningfulLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let insideImportBlock = false;
  for (const { number, raw, backticks, startsInTemplate } of rawLines(content)) {
    const text = raw.trim();
    if (insideImportBlock) {
      if (BLOCK_CLOSE.test(text)) insideImportBlock = false;
      continue;
    }
    if (startsInTemplate && backticks === 0) continue;
    if (IMPORT_BLOCK_OPEN.test(text)) {
      insideImportBlock = true;
      continue;
    }
    if (HAS_SUBSTANCE.test(text) && !COMMENT.test(text) && !IMPORT.test(text)) {
      lines.push({ number, text, isData: isDataOnly(text) });
    }
  }
  return lines;
}

/** Numbers of the lines that begin inside a multi-line template literal. Their indentation says nothing about the code. */
export function templateTextLines(content: string): Set<number> {
  const numbers = new Set<number>();
  for (const line of rawLines(content)) {
    if (line.startsInTemplate) numbers.add(line.number);
  }
  return numbers;
}

const LINE_COMMENT = /\/\/.*$/;
const BLOCK_COMMENT = /\/\*.*?\*\//g;

/** Cuts the part of a line that belongs to a multi-line template literal. */
function outsideTemplate({ raw, backticks, startsInTemplate }: RawLine): string {
  if (startsInTemplate) return backticks % 2 === 1 ? raw.slice(raw.indexOf("`") + 1) : "";
  return backticks % 2 === 1 ? raw.slice(0, raw.lastIndexOf("`")) : raw;
}

/**
 * Every line of a file with only its code left: string contents, regex
 * literals, comments and template text are blanked, so that brackets and
 * keywords found in the result are real ones. Line numbers are kept.
 */
export function codeOnlyLines(content: string): { number: number; code: string }[] {
  let insideBlockComment = false;
  const lines: { number: number; code: string }[] = [];
  for (const line of rawLines(content)) {
    let code = outsideTemplate(line).replace(STRING_LITERAL, '""').replace(REGEX_LITERAL, "$1");
    if (insideBlockComment) {
      const end = code.indexOf("*/");
      insideBlockComment = end === -1;
      code = end === -1 ? "" : code.slice(end + 2);
    }
    code = code.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
    const open = code.indexOf("/*");
    if (open !== -1) {
      insideBlockComment = true;
      code = code.slice(0, open);
    }
    lines.push({ number: line.number, code });
  }
  return lines;
}
