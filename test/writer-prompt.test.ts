import { describe, expect, it } from "vitest";
import type { RepoContext } from "../src/context.js";
import { buildWriterPrompt } from "../src/writer-prompt.js";
import { testConfig } from "./helpers.js";

const CONTEXT: RepoContext = {
  conventions: "Conventions of this repo. Follow them:\n- Most code is in .ts (30 files).\n- Store dates in UTC.",
  notes: "Rules of this repo. Follow them:\n- Store dates in UTC.",
  helpers: [{ name: "formatDate", file: "src/dates.ts", line: 4, exported: true }],
};

const config = testConfig({
  gates: [
    { name: "typecheck", command: "npm run typecheck" },
    { name: "test", command: "npm test" },
  ],
  maxChangedLines: 250,
});

describe("buildWriterPrompt", () => {
  it("opens with the task and states every hard limit the change will be checked against", () => {
    const prompt = buildWriterPrompt({ task: "Show due dates on cards", context: CONTEXT, config });

    expect(prompt.startsWith("Show due dates on cards\n")).toBe(true);
    expect(prompt).toContain("  npm run typecheck\n  npm test");
    expect(prompt).toContain("no more than 250 changed lines");
    expect(prompt).toContain("- formatDate (src/dates.ts:4)");
  });

  it("tells the writer only the hand-written rules by default", () => {
    const prompt = buildWriterPrompt({ task: "task", context: CONTEXT, config });

    expect(prompt).toContain("- Store dates in UTC.");
    expect(prompt).not.toContain("Most code is in");
  });

  it("includes the scanned conventions when the config asks for all of them", () => {
    const prompt = buildWriterPrompt({ task: "task", context: CONTEXT, config: { ...config, writerConventions: "all" } });

    expect(prompt).toContain("Most code is in .ts (30 files).");
  });

  it("puts the plan right after the task and the rejection reason last", () => {
    const prompt = buildWriterPrompt({
      task: "task",
      plan: "1. Edit src/cards.ts.",
      context: CONTEXT,
      config,
      feedback: 'The "test" gate failed.',
    });

    expect(prompt.indexOf("Plan to follow:")).toBeLessThan(prompt.indexOf("Rules of this repo."));
    expect(prompt.trimEnd().endsWith('The "test" gate failed.')).toBe(true);
  });

  it("stays short enough to read in one glance when there is nothing special to say", () => {
    const bare = buildWriterPrompt({ task: "task", context: { helpers: [] }, config });

    expect(bare.split("\n").length).toBeLessThan(20);
  });
});
