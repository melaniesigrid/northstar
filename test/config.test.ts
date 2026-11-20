import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const MINIMAL = {
  writer: "claude-code",
  reviewer: "codex",
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

  it.each([
    ["no writer", { ...MINIMAL, writer: undefined }, '"writer"'],
    ["no gates", { ...MINIMAL, gates: [] }, '"gates"'],
    ["a gate without a command", { ...MINIMAL, gates: [{ name: "test" }] }, '"command"'],
    ["a zero iteration limit", { ...MINIMAL, maxIterations: 0 }, '"maxIterations"'],
    ["a setup that is not a list", { ...MINIMAL, setup: "npm ci" }, '"setup"'],
  ])("rejects a config with %s and names the key", (_label, raw, key) => {
    expect(() => parseConfig(raw)).toThrow(key);
  });
});
