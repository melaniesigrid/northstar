import { readFile } from "node:fs/promises";
import path from "node:path";
import { listTrackedFiles, stagedAddedLines } from "./git.js";

/** The repo's source files with the change applied, plus which lines the change added. */
export interface ChangeSnapshot {
  files: Map<string, string>;
  addedLines: Map<string, Set<number>>;
}

export interface AddedLine {
  file: string;
  number: number;
  text: string;
}

const MAX_FILE_BYTES = 512 * 1024;
const DATA_AND_PROSE_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".json", ".lock", ".yaml", ".yml", ".toml", ".csv", ".svg", ".snap",
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
    if (DATA_AND_PROSE_EXTENSIONS.has(path.extname(file))) continue;
    const content = await readSource(path.join(cwd, file));
    if (content !== undefined) files.set(file, content);
  }
  return { files, addedLines: await stagedAddedLines(cwd) };
}

/** The added lines of every source file in the snapshot, in file order. */
export function addedLinesOf(snapshot: ChangeSnapshot): AddedLine[] {
  const added: AddedLine[] = [];
  for (const [file, numbers] of snapshot.addedLines) {
    const lines = snapshot.files.get(file)?.split("\n") ?? [];
    for (const number of [...numbers].sort((a, b) => a - b)) {
      const text = lines[number - 1];
      if (text !== undefined) added.push({ file, number, text });
    }
  }
  return added;
}
