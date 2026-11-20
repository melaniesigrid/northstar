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

export async function removeWorktree(repoRoot: string, worktree: Worktree): Promise<void> {
  await git(repoRoot, ["worktree", "remove", "--force", worktree.path]);
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

/** Resets the working tree to the staged state, dropping anything written since staging. */
export async function discardUnstaged(cwd: string): Promise<void> {
  await git(cwd, ["checkout", "--", "."]);
  await git(cwd, ["clean", "-fd"]);
}

export async function commitStaged(cwd: string, message: string): Promise<void> {
  await git(cwd, ["commit", "-m", message]);
}
