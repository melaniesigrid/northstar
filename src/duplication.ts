import { readFile } from "node:fs/promises";
import path from "node:path";
import { listTrackedFiles, stagedAddedLines } from "./git.js";

export interface Clone {
  file: string;
  startLine: number;
  endLine: number;
  /** Where the same code already lives. */
  duplicateOf: { file: string; line: number };
}

export interface DuplicationResult {
  clones: Clone[];
  /** Meaningful added lines that sit inside a clone. */
  duplicatedLines: number;
}

interface SourceLine {
  number: number;
  text: string;
}

/** A run of `minLines` consecutive meaningful lines, addressed by the index of its first line. */
interface WindowLocation {
  file: string;
  index: number;
}

const MAX_FILE_BYTES = 512 * 1024;
const DATA_AND_PROSE_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".json", ".lock", ".yaml", ".yml", ".toml", ".csv", ".svg", ".snap",
]);

// Lines that repeat across files for good reasons and say nothing about copy-paste.
const COMMENT = /^(\/\/|\/\*|\*|#[ !]|<!--)/;
const IMPORT = /^(import\b|from\b|export \* from\b|\} from\b|#include\b|using\b|package\b)/;
const HAS_SUBSTANCE = /[A-Za-z0-9].*[A-Za-z0-9]/;

function meaningfulLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  content.split("\n").forEach((raw, index) => {
    const text = raw.trim();
    if (HAS_SUBSTANCE.test(text) && !COMMENT.test(text) && !IMPORT.test(text)) {
      lines.push({ number: index + 1, text });
    }
  });
  return lines;
}

function windowKey(lines: SourceLine[], index: number, size: number): string {
  return lines
    .slice(index, index + size)
    .map((line) => line.text)
    .join("\n");
}

/**
 * Finds added code that repeats code elsewhere in the repo. Only windows made
 * entirely of added lines count, so duplication that existed before the change
 * is never held against it: the rule is "add no new debt".
 */
export function findClones(
  files: Map<string, string>,
  addedLines: Map<string, Set<number>>,
  minLines: number,
): DuplicationResult {
  const sources = new Map<string, SourceLine[]>();
  const windows = new Map<string, WindowLocation[]>();
  for (const [file, content] of files) {
    const lines = meaningfulLines(content);
    sources.set(file, lines);
    for (let index = 0; index + minLines <= lines.length; index++) {
      const key = windowKey(lines, index, minLines);
      const locations = windows.get(key) ?? [];
      locations.push({ file, index });
      windows.set(key, locations);
    }
  }

  const lineNumberAt = ({ file, index }: WindowLocation): number => sources.get(file)?.[index]?.number ?? 0;
  const isAddedCode = (location: WindowLocation): boolean =>
    addedLines.get(location.file)?.has(lineNumberAt(location)) ?? false;

  /** Another place holding the same window, preferring code that predates the change. */
  const findOrigin = (self: WindowLocation, key: string): WindowLocation | undefined => {
    const others = (windows.get(key) ?? []).filter(
      (other) => other.file !== self.file || Math.abs(other.index - self.index) >= minLines,
    );
    return others.find((other) => !isAddedCode(other)) ?? others[0];
  };

  const result: DuplicationResult = { clones: [], duplicatedLines: 0 };
  for (const [file, added] of addedLines) {
    const lines = sources.get(file) ?? [];
    const runs: { start: number; end: number; origin: WindowLocation }[] = [];
    for (let index = 0; index + minLines <= lines.length; index++) {
      const window = lines.slice(index, index + minLines);
      if (!window.every((line) => added.has(line.number))) continue;
      const origin = findOrigin({ file, index }, windowKey(lines, index, minLines));
      if (!origin) continue;

      // Overlapping or touching windows are one clone, not several.
      const lastRun = runs.at(-1);
      if (lastRun && index <= lastRun.end + 1) lastRun.end = index + minLines - 1;
      else runs.push({ start: index, end: index + minLines - 1, origin });
    }

    for (const run of runs) {
      result.duplicatedLines += run.end - run.start + 1;
      result.clones.push({
        file,
        startLine: lineNumberAt({ file, index: run.start }),
        endLine: lineNumberAt({ file, index: run.end }),
        duplicateOf: { file: run.origin.file, line: lineNumberAt(run.origin) },
      });
    }
  }
  return result;
}

async function readSource(file: string): Promise<string | undefined> {
  const content = await readFile(file).catch(() => undefined);
  if (!content || content.length > MAX_FILE_BYTES || content.includes(0)) return undefined;
  return content.toString("utf8");
}

/** Checks the staged change in `cwd` against every tracked source file. */
export async function checkDuplication(cwd: string, minLines: number): Promise<DuplicationResult> {
  const files = new Map<string, string>();
  for (const file of await listTrackedFiles(cwd)) {
    if (DATA_AND_PROSE_EXTENSIONS.has(path.extname(file))) continue;
    const content = await readSource(path.join(cwd, file));
    if (content !== undefined) files.set(file, content);
  }
  return findClones(files, await stagedAddedLines(cwd), minLines);
}

export function formatClones(clones: Clone[]): string {
  return clones
    .map((clone) => {
      const { file, line } = clone.duplicateOf;
      return `- ${clone.file}:${clone.startLine}-${clone.endLine} repeats ${file}:${line}`;
    })
    .join("\n");
}
