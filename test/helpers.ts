import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentAdapter, Config, RunResult, RunSpec } from "../src/types.js";

export function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

export function createTempRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "northstar-test-"));
  gitIn(dir, "init", "-q", "-b", "main");
  gitIn(dir, "config", "user.name", "Test");
  gitIn(dir, "config", "user.email", "test@example.com");
  gitIn(dir, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(dir, "README.md"), "# fixture\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "initial");
  return dir;
}

export function newRunId(): string {
  return `test-${randomBytes(4).toString("hex")}`;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    writer: "fake-writer",
    reviewer: "fake-reviewer",
    maxIterations: 3,
    maxChangedLines: 400,
    minDuplicateLines: 5,
    setup: [],
    gates: [{ name: "exists", command: "test -f feature.txt" }],
    agentTimeoutMs: 10_000,
    gateTimeoutMs: 10_000,
    ...overrides,
  };
}

type Turn = (spec: RunSpec) => string;

export interface FakeAgent extends AgentAdapter {
  prompts: string[];
}

/** An agent that plays scripted turns: each turn may touch files in `spec.cwd` and returns its final message. */
export function fakeAgent(vendor: string, turns: Turn[]): FakeAgent {
  const prompts: string[] = [];
  return {
    id: `fake-${vendor}`,
    vendor,
    prompts,
    detect: async () => ({ installed: true, version: "fake" }),
    async run(spec: RunSpec): Promise<RunResult> {
      const turn = turns[prompts.length];
      prompts.push(spec.prompt);
      if (!turn) throw new Error(`fake agent ${vendor} was called more often than scripted`);
      return { status: "ok", finalMessage: turn(spec), raw: null };
    },
  };
}

export function writeFileTurn(file: string, content: string): Turn {
  return (spec) => {
    writeFileSync(path.join(spec.cwd, file), content);
    return "done";
  };
}

export const CLEAN_REVIEW: Turn = () => '{"findings": []}';

/** A small helper function used as "existing code" that later changes may copy. */
export const SLUGIFY_SOURCE = [
  "export function slugify(input: string): string {",
  "  const lowered = input.toLowerCase();",
  "  const dashed = lowered.replace(/[^a-z0-9]+/g, '-');",
  "  const trimmed = dashed.replace(/^-|-$/g, '');",
  "  return trimmed;",
  "}",
].join("\n");
