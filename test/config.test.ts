import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const MINIMAL = {
  gates: [{ name: "test", command: "npm test" }],
};

describe("parseConfig", () => {
  it("fills defaults for everything a minimal config leaves out", () => {
    expect(parseConfig(MINIMAL)).toMatchObject({
      maxIterations: 3,
      maxChangedLines: 400,
      setup: [],
    });
  });

  it("keeps values the repo owner set", () => {
    const config = parseConfig({ ...MINIMAL, maxIterations: 5, setup: ["npm ci"], writerModel: "some-model" });

    expect(config).toMatchObject({ maxIterations: 5, setup: ["npm ci"], writerModel: "some-model" });
  });

  it("reads the planner, efforts and what the writer is told about the repo", () => {
    const config = parseConfig({ ...MINIMAL, planner: "claude-code", writerEffort: "high", writerConventions: "all" });

    expect(config).toMatchObject({ planner: "claude-code", writerEffort: "high", writerConventions: "all" });
  });

  it("tells the writer only hand-written rules unless asked otherwise", () => {
    expect(parseConfig(MINIMAL).writerConventions).toBe("notes");
  });

  it("gives every role to Codex when the config names no agent, and adds no planner", () => {
    expect(parseConfig(MINIMAL)).toMatchObject({ writer: "codex", reviewer: "codex" });
    expect(parseConfig(MINIMAL).planner).toBeUndefined();
  });

  it("keeps the agents a config does name", () => {
    expect(parseConfig({ ...MINIMAL, reviewer: "claude-code" })).toMatchObject({ writer: "codex", reviewer: "claude-code" });
  });

  it.each([
    ["an unknown effort level", { ...MINIMAL, writerEffort: "extreme" }, '"writerEffort"'],
    ["an unknown conventions mode", { ...MINIMAL, writerConventions: "some" }, '"writerConventions"'],
    ["an empty writer", { ...MINIMAL, writer: "" }, '"writer"'],
    ["no gates", { ...MINIMAL, gates: [] }, '"gates"'],
    ["a gate without a command", { ...MINIMAL, gates: [{ name: "test" }] }, '"command"'],
    ["a zero iteration limit", { ...MINIMAL, maxIterations: 0 }, '"maxIterations"'],
    ["a setup that is not a list", { ...MINIMAL, setup: "npm ci" }, '"setup"'],
  ])("rejects a config with %s and names the key", (_label, raw, key) => {
    expect(() => parseConfig(raw)).toThrow(key);
  });
});
