import type { RepoContext } from "./context.js";
import { formatHelpers } from "./helper-index.js";
import type { Config } from "./types.js";

export interface WriterBrief {
  task: string;
  /** The planner's plan, when a planner is configured. */
  plan?: string;
  context: RepoContext;
  config: Config;
  /** Why the previous attempt was rejected. */
  feedback?: string;
}

const CONSTRAINTS = `Constraints:
- Change only what the task needs.
- Import existing code instead of copying it.
- Fix the cause of a lint or type error. Do not silence it.
- Do not add comments that restate the code.
- Leave no trace of AI authorship: no generated-by notes, no AI co-author lines, and no mention of an assistant in code, comments or docs.
- Do not commit. Leave your changes in the working directory.`;

function doneWhen(config: Config): string {
  const commands = config.gates.map((gate) => `  ${gate.command}`).join("\n");
  return `Done when:
- These commands pass. Run them before you finish, if your environment lets you:
${commands}
- The change is no more than ${config.maxChangedLines} changed lines.`;
}

/**
 * Goal, context, constraints, done-when: the shape Codex's own guidance
 * recommends, kept short because coding models do worse when over-prompted.
 * The writer sees up front every hard limit it will be checked against, so a
 * weaker model does not have to discover them one rejection at a time.
 */
export function buildWriterPrompt({ task, plan, context, config, feedback }: WriterBrief): string {
  const sections = [task];
  if (plan) sections.push(`Plan to follow:\n${plan}`);

  const repoRules = config.writerConventions === "all" ? context.conventions : context.notes;
  if (repoRules) sections.push(repoRules);
  if (context.helpers.length > 0) {
    sections.push(
      `Existing helpers that look relevant. Reuse them instead of writing new ones:\n${formatHelpers(context.helpers)}`,
    );
  }

  sections.push(CONSTRAINTS, doneWhen(config));
  if (feedback) {
    sections.push(`Your previous attempt was rejected. Fix this and keep the rest of your work:\n${feedback}`);
  }
  return sections.join("\n\n");
}
