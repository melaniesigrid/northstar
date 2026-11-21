import path from "node:path";
import { isTestFile } from "./profile.js";
import type { ChangeSnapshot } from "./snapshot.js";
import { codeOnlyLines } from "./source-lines.js";

export interface ComplexFunction {
  file: string;
  /** Where the function starts. */
  line: number;
  name: string;
  /** Estimated cognitive complexity of the whole function. */
  score: number;
  /** The part of the score that sits on lines this change added. */
  addedScore: number;
}

/** The limit most linters ship with for this metric. */
export const COMPLEXITY_LIMIT = 15;
/** Below this, a change to a function that was already over the limit is too small to hold against it. */
const NOTABLE_ADDITION = 5;

/** The estimate reads braces and keywords, so it only covers languages written that way. */
const SCORED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const CONTROL_LINE = /^(?:\}\s*)?(?:else\b|if\b|for\b|while\b|do\b|switch\b|catch\b|try\b|finally\b)/;
/** What stands before the brace of a function body: an arrow, a parameter list, or a return type. */
const FUNCTION_BRACE = /(?:=>|\)|\)\s*:\s*[^=;{}()]+)\s*$/;
/** Braces of these raise the nesting level, as a function body does. `try` and plain blocks do not. */
const NESTING_CONTROL = /^(?:\}\s*)?(?:else\b|if\b|for\b|while\b|do\b|switch\b|catch\b)/;

const FUNCTION_NAMES = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/,
  /^\s*(?:(?:public|private|protected|static|async|override|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/,
];
const NOT_A_NAME = new Set(["if", "for", "while", "switch", "catch", "return", "function", "await", "new", "typeof"]);

function functionName(code: string): string | undefined {
  for (const pattern of FUNCTION_NAMES) {
    const name = pattern.exec(code)?.[1];
    if (name && !NOT_A_NAME.has(name)) return name;
  }
  return undefined;
}

const count = (code: string, pattern: RegExp): number => code.match(pattern)?.length ?? 0;

/**
 * What one line adds, following the rules of cognitive complexity: a branch or
 * loop costs one plus its nesting level, `else` costs one, and each run of the
 * same logical operator costs one.
 */
function lineScore(code: string, nesting: number, previousOperator: string | undefined): { score: number; operator?: string } {
  const text = code.trim();
  const elseIfs = count(text, /\belse\s+if\b/g);
  const flat = elseIfs + count(text, /\belse\b(?!\s+if\b)/g);
  const loopTail = /^\}\s*while\b/.test(text) ? 1 : 0;
  const nested =
    count(text, /\bif\s*\(/g) - elseIfs +
    count(text, /\bfor\s*(?:await\s*)?\(/g) +
    count(text, /\bwhile\s*\(/g) - loopTail +
    count(text, /\bdo\s*\{|^do$/g) +
    count(text, /\bswitch\s*\(/g) +
    count(text, /\bcatch\b/g) +
    count(text, /(?:^|\s)\?\s/g);

  let operator = previousOperator;
  let runs = 0;
  for (const found of text.match(/&&|\|\|/g) ?? []) {
    if (found !== operator) runs += 1;
    operator = found;
  }
  // A condition can run over several lines. It ends where a statement or a block does.
  if (/[;{}]$/.test(text)) operator = undefined;
  return { score: flat + runs + nested * (1 + nesting), operator };
}

interface OpenFunction extends ComplexFunction {
  /** Brace depth at which the function's own body opened. */
  depth: number;
}

/**
 * A function with a name of its own, declared inside another one. It is scored
 * by itself, the way a reader takes it in. An anonymous callback is read as
 * part of the code around it, so it stays with the enclosing function.
 */
const NAMED_INNER_FUNCTION =
  /\bfunction\s*\*?\s*[A-Za-z_$]|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^()]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)/;

/** Where the reading of a file stands. */
interface Scan {
  file: string;
  added: Set<number>;
  /** One entry per open brace: whether it raises the nesting level. */
  braces: boolean[];
  /** Functions being read, innermost last. */
  open: OpenFunction[];
  finished: ComplexFunction[];
  /** The latest function name seen, and its line: a signature can span several lines. */
  pending?: { name: string; line: number };
  /** The logical operator a condition was last using, carried across its lines. */
  operator?: string;
}

function addLineScore(scan: Scan, number: number, code: string): void {
  const current = scan.open.at(-1);
  if (!current) return;
  const nesting = scan.braces.slice(current.depth).filter(Boolean).length;
  const scored = lineScore(code, nesting, scan.operator);
  scan.operator = scored.operator;
  current.score += scored.score;
  if (scan.added.has(number)) current.addedScore += scored.score;
}

/** Outside any function every name counts. Inside one, only a function declared with a name of its own. */
function noteFunctionName(scan: Scan, number: number, code: string): void {
  const mayStartFunction = scan.open.length === 0 || NAMED_INNER_FUNCTION.test(code);
  const name = mayStartFunction ? functionName(code) : undefined;
  if (name) scan.pending = { name, line: number };
}

function openBrace(scan: Scan, number: number, before: string, line: string): void {
  const isFunction = !CONTROL_LINE.test(line) && FUNCTION_BRACE.test(before);
  const startsFunction = isFunction && (scan.open.length === 0 || scan.pending !== undefined);
  if (!startsFunction) {
    scan.braces.push(scan.open.length > 0 && (isFunction || NESTING_CONTROL.test(line)));
    return;
  }
  scan.braces.push(false);
  scan.open.push({
    file: scan.file,
    line: scan.pending?.line ?? number,
    name: scan.pending?.name ?? "anonymous function",
    score: 0,
    addedScore: 0,
    depth: scan.braces.length,
  });
  scan.pending = undefined;
}

function closeBrace(scan: Scan): void {
  scan.braces.pop();
  const innermost = scan.open.at(-1);
  if (!innermost || scan.braces.length >= innermost.depth) return;
  const { file, line, name, score, addedScore } = innermost;
  scan.finished.push({ file, line, name, score, addedScore });
  scan.open.pop();
  scan.operator = undefined;
}

/** Scores every function in a file. Exported for the tests, which check scores below the limit too. */
export function scoreFile(file: string, content: string, added: Set<number>): ComplexFunction[] {
  const scan: Scan = { file, added, braces: [], open: [], finished: [] };
  for (const { number, code } of codeOnlyLines(content)) {
    const line = code.trim();
    addLineScore(scan, number, code);
    noteFunctionName(scan, number, code);
    for (let index = 0; index < code.length; index++) {
      if (code[index] === "{") openBrace(scan, number, code.slice(0, index), line);
      else if (code[index] === "}") closeBrace(scan);
    }
    // A name only waits for its body while its signature is still open.
    if (/[;}]$/.test(line)) scan.pending = undefined;
  }
  return scan.finished.sort((a, b) => a.line - b.line);
}

/** The change either took the function over the limit or added a good part of what is there. */
function isDueToChange({ score, addedScore }: ComplexFunction): boolean {
  return score > COMPLEXITY_LIMIT && (score - addedScore <= COMPLEXITY_LIMIT || addedScore >= NOTABLE_ADDITION);
}

/**
 * Functions a change left hard to follow. The score is an estimate from braces
 * and keywords, not a parse, so it goes to the reviewer as something to look at.
 */
export function findComplexFunctions(snapshot: ChangeSnapshot): ComplexFunction[] {
  const found: ComplexFunction[] = [];
  for (const [file, added] of snapshot.addedLines) {
    const content = snapshot.files.get(file);
    if (content === undefined || !SCORED_EXTENSIONS.has(path.extname(file)) || isTestFile(file)) continue;
    found.push(...scoreFile(file, content, added).filter(isDueToChange));
  }
  return found;
}
