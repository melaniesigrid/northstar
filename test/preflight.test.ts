import { describe, expect, it } from "vitest";
import { checkAgents, renderChecks } from "../src/preflight.js";
import type { AgentAdapter } from "../src/types.js";
import { fakeAgent } from "./helpers.js";

const READY = () => "ready";
const SIGNED_OUT = () => ({ status: "failed" as const, finalMessage: "Authentication error", raw: null });

describe("checkAgents", () => {
  it("checks roles that share an agent and a model with one read-only call", async () => {
    const claude = fakeAgent("anthropic", [READY]);
    const codex = fakeAgent("openai", [READY]);

    const checks = await checkAgents(
      [
        { role: "planner", adapter: claude },
        { role: "writer", adapter: codex },
        { role: "reviewer", adapter: claude },
      ],
      process.cwd(),
    );

    expect(checks).toEqual([
      { agent: "fake-anthropic", model: undefined, roles: ["planner", "reviewer"], ready: true },
      { agent: "fake-openai", model: undefined, roles: ["writer"], ready: true },
    ]);
    expect(claude.specs).toHaveLength(1);
    expect(claude.specs[0]).toMatchObject({ readOnly: true });
  });

  it("checks each model separately, since a wrong model name fails on its own", async () => {
    const claude = fakeAgent("anthropic", [READY, SIGNED_OUT]);

    const checks = await checkAgents(
      [
        { role: "planner", adapter: claude, model: "opus" },
        { role: "reviewer", adapter: claude, model: "sonnet" },
      ],
      process.cwd(),
    );

    expect(claude.specs.map((spec) => spec.model)).toEqual(["opus", "sonnet"]);
    expect(checks.map((check) => check.ready)).toEqual([true, false]);
  });

  it("passes on the agent's own explanation when it is not ready", async () => {
    const checks = await checkAgents([{ role: "writer", adapter: fakeAgent("openai", [SIGNED_OUT]) }], process.cwd());

    expect(checks[0]).toMatchObject({ ready: false, detail: "Authentication error" });
    expect(renderChecks(checks)).toBe("fake-openai (writer): NOT READY. Authentication error");
  });

  it("does not call an agent that is not installed", async () => {
    const missing: AgentAdapter = {
      ...fakeAgent("openai", []),
      detect: async () => ({ installed: false }),
    };

    const checks = await checkAgents([{ role: "writer", adapter: missing }], process.cwd());

    expect(checks[0]).toMatchObject({ ready: false, detail: "Not found on PATH." });
  });
});

describe("renderChecks", () => {
  it("names the model when one is set", () => {
    const line = renderChecks([{ agent: "codex", model: "gpt-5.2", roles: ["writer"], ready: true }]);

    expect(line).toBe("codex with gpt-5.2 (writer): ready");
  });
});
