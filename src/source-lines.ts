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

/**
 * The lines of a file worth comparing, trimmed. Left out: blank and
 * bracket-only lines, comments, imports including multi-line name lists, and
 * the body of multi-line template literals, which is embedded text such as
 * HTML or CSS rather than code.
 */
export function meaningfulLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let insideTemplate = false;
  let insideImportBlock = false;
  content.split("\n").forEach((raw, index) => {
    const text = raw.trim();
    const backticks = countTemplateDelimiters(raw, insideTemplate);
    const isTemplateBody = insideTemplate && backticks === 0;
    if (backticks % 2 === 1) insideTemplate = !insideTemplate;

    if (insideImportBlock) {
      if (BLOCK_CLOSE.test(text)) insideImportBlock = false;
      return;
    }
    if (isTemplateBody) return;
    if (IMPORT_BLOCK_OPEN.test(text)) {
      insideImportBlock = true;
      return;
    }
    if (HAS_SUBSTANCE.test(text) && !COMMENT.test(text) && !IMPORT.test(text)) {
      lines.push({ number: index + 1, text, isData: isDataOnly(text) });
    }
  });
  return lines;
}
