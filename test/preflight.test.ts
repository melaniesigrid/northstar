import { describe, expect, it } from "vitest";
import { checkAgents, describeInstall, renderChecks, rolesWithoutSignIn } from "../src/preflight.js";
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

describe("describeInstall", () => {
  it.each([
    [{ installed: true, version: "1.2.3" }, true, "codex: installed (1.2.3)"],
    [{ installed: true, version: "1.2.3" }, false, "codex: installed (1.2.3), not used by your setup"],
    [{ installed: true, version: "1.2.3", signInProblem: "Run `codex login`." }, true, "codex: installed (1.2.3), NOT SIGNED IN. Run `codex login`."],
    [{ installed: false }, true, "codex: NOT FOUND on PATH, and your setup uses it"],
    [{ installed: false }, false, "codex: not installed, and not needed by your setup"],
  ])("treats a missing CLI as a problem only when the setup uses it", (detected, needed, line) => {
    expect(describeInstall("codex", detected, needed)).toBe(line);
  });
});

describe("checkAgents with a CLI that knows whether it is signed in", () => {
  const signedOutCli = (turns: Parameters<typeof fakeAgent>[1]) => ({
    ...fakeAgent("openai", turns),
    signInProblem: async () => "No sign-in is stored. Run `codex login`.",
  });

  it("gives the fix instead of the CLI's network noise when nobody is signed in", async () => {
    const waiting = () => ({ status: "timeout" as const, finalMessage: "Codex timed out.", raw: null });
    const agent = signedOutCli([waiting]);

    const checks = await checkAgents([{ role: "writer", adapter: agent }], process.cwd());

    expect(checks[0]).toMatchObject({ ready: false, detail: "No sign-in is stored. Run `codex login`." });
    expect(agent.specs[0]?.timeoutMs).toBeLessThan(60_000);
  });

  it("still counts the agent as ready when it answers anyway, as it does with a key in the environment", async () => {
    const checks = await checkAgents([{ role: "writer", adapter: signedOutCli([READY]) }], process.cwd());

    expect(checks[0]?.ready).toBe(true);
  });
});

describe("rolesWithoutSignIn", () => {
  it("names only the roles whose CLI reports that nobody is signed in, without calling a model", async () => {
    const signedOut = { ...fakeAgent("openai", []), signInProblem: async () => "Run `codex login`." };
    const signedIn = { ...fakeAgent("openai", []), signInProblem: async () => undefined };
    const cannotTell = fakeAgent("anthropic", []);

    const suspects = await rolesWithoutSignIn([
      { role: "writer", adapter: signedOut },
      { role: "reviewer", adapter: signedIn },
      { role: "planner", adapter: cannotTell },
    ]);

    expect(suspects.map((entry) => entry.role)).toEqual(["writer"]);
    expect(signedOut.prompts).toEqual([]);
  });
});

describe("renderChecks", () => {
  it("names the model when one is set", () => {
    const line = renderChecks([{ agent: "codex", model: "gpt-5.2", roles: ["writer"], ready: true }]);

    expect(line).toBe("codex with gpt-5.2 (writer): ready");
  });
});
