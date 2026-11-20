import type { ChangeSnapshot } from "./snapshot.js";
import { meaningfulLines, type SourceLine } from "./source-lines.js";

export interface Clone {
  file: string;
  startLine: number;
  endLine: number;
  /** Where the same code already lives. */
  duplicateOf: { file: string; line: number };
}

export interface DuplicationResult {
  /** Repeated code. These block the change. */
  clones: Clone[];
  /** Repeated blocks made mostly of literals, such as lists and lookup tables. The reviewer judges these. */
  dataClones: Clone[];
  /** Added lines that sit inside a blocking clone. */
  duplicatedLines: number;
}

/** A run of `minLines` consecutive meaningful lines, addressed by the index of its first line. */
interface WindowLocation {
  file: string;
  index: number;
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
 *
 * A repeat blocks only when it holds at least `minLines` lines of actual code.
 * Repeated literals (status lists, theme tokens, seed rows) are common and
 * often fine, so they are reported separately for a reviewer to judge.
 */
export function findClones({ files, addedLines }: ChangeSnapshot, minLines: number): DuplicationResult {
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

  const result: DuplicationResult = { clones: [], dataClones: [], duplicatedLines: 0 };
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
      const clone: Clone = {
        file,
        startLine: lineNumberAt({ file, index: run.start }),
        endLine: lineNumberAt({ file, index: run.end }),
        duplicateOf: { file: run.origin.file, line: lineNumberAt(run.origin) },
      };
      const codeLines = lines.slice(run.start, run.end + 1).filter((line) => !line.isData).length;
      if (codeLines < minLines) {
        result.dataClones.push(clone);
        continue;
      }
      result.clones.push(clone);
      result.duplicatedLines += run.end - run.start + 1;
    }
  }
  return result;
}

export function formatClones(clones: Clone[]): string {
  return clones
    .map((clone) => {
      const { file, line } = clone.duplicateOf;
      return `- ${clone.file}:${clone.startLine}-${clone.endLine} repeats ${file}:${line}`;
    })
    .join("\n");
}
