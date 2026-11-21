import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { suggestConfig, withIgnoreEntry } from "../src/init.js";

describe("suggestConfig", () => {
  it("turns the repo's own check scripts into gates, cheapest first", () => {
    const manifest = { scripts: { test: "vitest run", build: "tsc", lint: "eslint .", typecheck: "tsc --noEmit" } };

    expect(suggestConfig(manifest, ["package.json", "package-lock.json"])).toEqual({
      setup: ["npm ci"],
      gates: [
        { name: "typecheck", command: "npm run typecheck" },
        { name: "lint", command: "npm run lint" },
        { name: "test", command: "npm run test" },
      ],
    });
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm install --frozen-lockfile", "pnpm test"],
    ["yarn.lock", "yarn install --frozen-lockfile", "yarn test"],
    ["bun.lock", "bun install --frozen-lockfile", "bun run test"],
  ])("uses the package manager that %s points to", (lockfile, install, testCommand) => {
    const suggestion = suggestConfig({ scripts: { test: "vitest run" } }, [lockfile]);

    expect(suggestion).toEqual({ setup: [install], gates: [{ name: "test", command: testCommand }] });
  });

  it("falls back to a plain install when there is no lockfile", () => {
    expect(suggestConfig({ scripts: { test: "jest" } }, ["package.json"]).setup).toEqual(["npm install"]);
  });

  it("finds a type check under another common name", () => {
    const suggestion = suggestConfig({ scripts: { "type-check": "tsc --noEmit" } }, ["package-lock.json"]);

    expect(suggestion.gates).toEqual([{ name: "typecheck", command: "npm run type-check" }]);
  });

  it("does not offer the test script that npm init writes, which always fails", () => {
    const manifest = { scripts: { test: 'echo "Error: no test specified" && exit 1' } };

    expect(suggestConfig(manifest, ["package-lock.json"]).gates).toEqual([]);
  });

  it("suggests nothing for a repo without a package manifest", () => {
    expect(suggestConfig(undefined, ["main.py"])).toEqual({ setup: [], gates: [] });
  });

  it("produces a config that loads", () => {
    const suggestion = suggestConfig({ scripts: { test: "vitest run" } }, ["package-lock.json"]);

    expect(parseConfig(suggestion)).toMatchObject({ writer: "codex", reviewer: "codex", setup: ["npm ci"] });
  });
});

describe("withIgnoreEntry", () => {
  it.each([
    ["an empty file", "", ".northstar/\n"],
    ["a file that ends with a newline", "node_modules/\n", "node_modules/\n.northstar/\n"],
    ["a file that does not", "node_modules/", "node_modules/\n.northstar/\n"],
  ])("adds the working folder to %s", (_label, before, after) => {
    expect(withIgnoreEntry(before)).toBe(after);
  });

  it.each([".northstar/\n", "dist/\n.northstar\n"])("leaves a file alone that already covers it", (gitignore) => {
    expect(withIgnoreEntry(gitignore)).toBeUndefined();
  });
});
