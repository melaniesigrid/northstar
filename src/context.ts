import { findRelevantHelpers, indexHelpers, type Helper } from "./helper-index.js";
import { loadProfile, renderConventions, scanRepo } from "./profile.js";
import { loadSnapshot } from "./snapshot.js";

/** What an agent is told about the repo before it starts. */
export interface RepoContext {
  conventions?: string;
  /** Existing helpers whose names relate to the task. */
  helpers: Helper[];
}

/** Uses the committed profile when the repo has one, and scans the repo when it does not. */
export async function gatherContext(cwd: string, task: string): Promise<RepoContext> {
  const profile = (await loadProfile(cwd)) ?? (await scanRepo(cwd));
  const { files } = await loadSnapshot(cwd);
  return {
    conventions: renderConventions(profile),
    helpers: findRelevantHelpers(task, indexHelpers(files)),
  };
}
