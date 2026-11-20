import os from "node:os";
import path from "node:path";
import { exec } from "./exec.js";

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

export interface Worktree {
  path: string;
  branch: string;
}

export interface DiffStat {
  files: string[];
  linesChanged: number;
}

export async function findRepoRoot(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

/** Each run gets its own branch and working directory, so the user's checkout is never touched. */
export async function createWorktree(repoRoot: string, runId: string, baseRef: string): Promise<Worktree> {
  const branch = `northstar/${runId}`;
  const worktreePath = path.join(os.tmpdir(), "northstar", runId);
  await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseRef]);
  return { path: worktreePath, branch };
}

export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await git(repoRoot, ["worktree", "remove", "--force", worktreePath]);
}

/** Whether the checkout has no staged, unstaged or untracked changes. Ignored files do not count. */
export async function isUnchanged(cwd: string): Promise<boolean> {
  return (await git(cwd, ["status", "--porcelain"])).trim() === "";
}

/** For a run that produced nothing: leaves no trace of it in the repo. */
export async function removeWorktreeAndBranch(repoRoot: string, worktree: Worktree): Promise<void> {
  await removeWorktree(repoRoot, worktree.path);
  await git(repoRoot, ["branch", "-D", worktree.branch]);
}

/** A scratch checkout on no branch, for reading history without touching the user's own checkout. */
export async function createDetachedWorktree(repoRoot: string, id: string, ref = "HEAD"): Promise<string> {
  const worktreePath = path.join(os.tmpdir(), "northstar", id);
  await git(repoRoot, ["worktree", "add", "--detach", worktreePath, ref]);
  return worktreePath;
}

export interface CommitInfo {
  commit: string;
  date: string;
  subject: string;
}

/** The most recent non-merge commits that have a parent to compare against, newest first. */
export async function listCommits(cwd: string, max: number): Promise<CommitInfo[]> {
  const log = await git(cwd, ["log", "--no-merges", "--min-parents=1", `--max-count=${max}`, "--format=%h%x00%as%x00%s"]);
  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit = "", date = "", subject = ""] = line.split("\0");
      return { commit, date, subject };
    });
}

/**
 * Puts the worktree in the state a change is in just before it is committed:
 * the commit's content staged on top of its parent. The slop checks can then
 * read a past commit exactly as they read a fresh change.
 */
export async function restageCommit(cwd: string, commit: string): Promise<void> {
  await git(cwd, ["checkout", "--quiet", "--detach", "--force", commit]);
  await git(cwd, ["reset", "--quiet", "--soft", `${commit}^`]);
}

export async function stageAll(cwd: string): Promise<void> {
  await git(cwd, ["add", "-A"]);
}

export async function stagedStat(cwd: string): Promise<DiffStat> {
  const numstat = await git(cwd, ["diff", "--cached", "--numstat"]);
  const stat: DiffStat = { files: [], linesChanged: 0 };
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added = "0", deleted = "0", file = ""] = line.split("\t");
    stat.files.push(file);
    // Binary files report "-" for both counts and add no lines.
    stat.linesChanged += (Number(added) || 0) + (Number(deleted) || 0);
  }
  return stat;
}

export async function stagedDiff(cwd: string): Promise<string> {
  return git(cwd, ["diff", "--cached"]);
}

export async function listTrackedFiles(cwd: string): Promise<string[]> {
  return (await git(cwd, ["ls-files", "-z"])).split("\0").filter(Boolean);
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export interface AddedLine {
  file: string;
  number: number;
  text: string;
}

/** Reads a zero-context unified diff into every line the change added, across all files. */
export function parseAddedText(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file: string | undefined;
  let nextNumber = 0;
  // "+++ " names a file only in the header before a file's first hunk; later it is added content.
  let inFileHeader = true;
  for (const line of diff.split("\n")) {
    const hunk = HUNK_HEADER.exec(line);
    if (line.startsWith("diff --git ")) {
      inFileHeader = true;
    } else if (inFileHeader && line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? undefined : line.slice("+++ b/".length);
    } else if (hunk) {
      inFileHeader = false;
      nextNumber = Number(hunk[1]);
    } else if (!inFileHeader && line.startsWith("+") && file !== undefined) {
      added.push({ file, number: nextNumber, text: line.slice(1) });
      nextNumber += 1;
    }
  }
  return added;
}

export function groupNumbersByFile(added: AddedLine[]): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>();
  for (const { file, number } of added) {
    const numbers = byFile.get(file) ?? new Set<number>();
    numbers.add(number);
    byFile.set(file, numbers);
  }
  return byFile;
}

export async function stagedAddedText(cwd: string): Promise<AddedLine[]> {
  return parseAddedText(await git(cwd, ["diff", "--cached", "--unified=0", "--no-color"]));
}

/** Resets the working tree to the staged state, dropping anything written since staging. */
export async function discardUnstaged(cwd: string): Promise<void> {
  await git(cwd, ["checkout", "--", "."]);
  await git(cwd, ["clean", "-fd"]);
}

export async function commitStaged(cwd: string, message: string): Promise<void> {
  await git(cwd, ["commit", "-m", message]);
}
