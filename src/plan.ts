import type { RepoContext } from "./context.js";
import { formatHelpers } from "./helper-index.js";

const PLAN_FORMAT = `Write a short plan the other agent can follow without asking questions:
1. Files to change or create, with one line each on what changes.
2. Existing code to reuse, by name and path.
3. Tests to add or update.
4. Done when: the observable checks that prove the task is complete.

Keep the change as small as the task allows. No code and no preamble. Under 30 lines.`;

/**
 * The planner reads the repo and decides what to build and how it will be
 * verified, so the writer can spend its effort on writing. Pairing a stronger
 * planner with a weaker writer is the point of making this a separate role.
 */
export function buildPlanPrompt(task: string, context: RepoContext): string {
  const sections = [
    "Plan a change that another coding agent will carry out. Read the code you need first. Do not edit any files.",
    `The task:\n${task}`,
  ];
  if (context.conventions) sections.push(context.conventions);
  if (context.helpers.length > 0) {
    sections.push(`Existing helpers that may be relevant:\n${formatHelpers(context.helpers)}`);
  }
  sections.push(PLAN_FORMAT);
  return sections.join("\n\n");
}
