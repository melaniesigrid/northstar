import { isTestFile } from "./profile.js";
import type { ChangeSnapshot } from "./snapshot.js";
import { templateTextLines } from "./source-lines.js";

export interface WeakTest {
  file: string;
  line: number;
  name: string;
  weakness: "no assertion" | "only checks that a value exists";
}

/** `it("name", ...)` and `test("name", ...)`, including forms such as `it.each(table)("name", ...)`. */
const JS_TEST = /^(\s*)(?:it|test)\b([^"'`]*)\(\s*(["'`])(.+?)\3/;
const PYTHON_TEST = /^(\s*)(?:async\s+)?def\s+(test_\w+)\s*\(/;
/** Skipped and placeholder tests are not expected to assert anything. */
const NOT_RUN = /\.(skip|todo)\b/;

/** Any call or statement that checks a result, including helpers named like `expectClean(...)`. */
const ASSERTION = /\bexpect\w*\s*[.(]|\bassert\w*\s*[.(]|\bassert\s|\.should\b|\bshould\.|pytest\.(?:raises|warns)|\bverify\w*\s*\(/;

/**
 * Assertions that pass for almost any result: the value exists, is truthy, or
 * nothing threw. A test made only of these says little about behavior.
 */
const EXISTENCE_ONLY =
  /\.(?:toBeDefined|toBeTruthy|toBeInstanceOf|toBeTypeOf)\s*\(|\.not\.(?:toBeNull|toBeUndefined|toThrow)\s*\(|\bassert\s+[\w.]+(?:\s+is\s+not\s+None)?\s*$|\.assertIsNotNone\(/;

interface TestStart {
  indent: number;
  name: string;
}

function testStart(line: string): TestStart | undefined {
  const js = JS_TEST.exec(line);
  if (js) return NOT_RUN.test(js[2] ?? "") ? undefined : { indent: (js[1] ?? "").length, name: js[4] ?? "" };
  const python = PYTHON_TEST.exec(line);
  return python ? { indent: (python[1] ?? "").length, name: python[2] ?? "" } : undefined;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * The test's own line plus every following line indented deeper than it. Text
 * inside a template literal is skipped over, since a fixture written at the
 * left margin would otherwise look like the end of the test.
 */
function testBody(lines: string[], startIndex: number, indent: number, templateText: Set<number>): string[] {
  const body = [lines[startIndex] ?? ""];
  for (let index = startIndex + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "" || templateText.has(index + 1)) continue;
    if (indentOf(line) <= indent) break;
    body.push(line);
  }
  return body;
}

function weaknessOf(body: string[]): WeakTest["weakness"] | undefined {
  const assertions = body.filter((line) => ASSERTION.test(line));
  if (assertions.length === 0) return "no assertion";
  return assertions.every((line) => EXISTENCE_ONLY.test(line)) ? "only checks that a value exists" : undefined;
}

/**
 * Finds tests the change adds that would pass almost whatever the code does:
 * they assert nothing, or only that a value exists. A test may still be fine,
 * for instance if it delegates its checks to a helper with an unusual name, so
 * this is a signal for the reviewer and does not block on its own.
 */
export function findWeakTests({ files, addedLines }: ChangeSnapshot): WeakTest[] {
  const weakTests: WeakTest[] = [];
  for (const [file, added] of addedLines) {
    const content = files.get(file);
    if (content === undefined || !isTestFile(file)) continue;
    const lines = content.split("\n");
    const templateText = templateTextLines(content);
    lines.forEach((line, index) => {
      const start = added.has(index + 1) ? testStart(line) : undefined;
      const weakness = start && weaknessOf(testBody(lines, index, start.indent, templateText));
      if (start && weakness) weakTests.push({ file, line: index + 1, name: start.name, weakness });
    });
  }
  return weakTests;
}
