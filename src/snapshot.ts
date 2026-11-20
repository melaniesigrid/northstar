import { readFile } from "node:fs/promises";
import path from "node:path";
import { groupNumbersByFile, listTrackedFiles, stagedAddedText, type AddedLine } from "./git.js";

/** The repo's source files with the change applied, plus what the change added. */
export interface ChangeSnapshot {
  /** Source files only. Prose, data, markup and stylesheets are left out. */
  files: Map<string, string>;
  /** Added line numbers per file. */
  addedLines: Map<string, Set<number>>;
  /** Every added line in every file, documentation included. */
  addedText: AddedLine[];
}

const MAX_FILE_BYTES = 512 * 1024;
/**
 * Files the slop checks leave alone. Prose and data repeat by nature. Markup
 * and stylesheets do too: pages share a head and a footer, and rules share
 * declarations, with no way to "reuse" them short of a build step. Replaying
 * a static site's history blocked 10 of 32 commits before these were skipped.
 */
export const SKIPPED_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".json", ".lock", ".yaml", ".yml", ".toml", ".csv", ".svg", ".snap",
  ".html", ".htm", ".xml", ".css", ".scss", ".less",
]);

async function readSource(file: string): Promise<string | undefined> {
  const content = await readFile(file).catch(() => undefined);
  if (!content || content.length > MAX_FILE_BYTES || content.includes(0)) return undefined;
  return content.toString("utf8");
}

/** Reads every tracked source file in `cwd` and the lines its staged change added. */
export async function loadSnapshot(cwd: string): Promise<ChangeSnapshot> {
  const files = new Map<string, string>();
  for (const file of await listTrackedFiles(cwd)) {
    if (SKIPPED_EXTENSIONS.has(path.extname(file))) continue;
    const content = await readSource(path.join(cwd, file));
    if (content !== undefined) files.set(file, content);
  }
  const addedText = await stagedAddedText(cwd);
  return { files, addedLines: groupNumbersByFile(addedText), addedText };
}

/** The added lines that belong to source files. */
export function addedLinesOf(snapshot: ChangeSnapshot): AddedLine[] {
  return snapshot.addedText.filter((line) => snapshot.files.has(line.file));
}
