import { describe, expect, it } from "vitest";
import { buildClaudeArgs, parseClaudeOutput } from "../src/adapters/claude-code.js";
import { buildCodexArgs, parseCodexEvents } from "../src/adapters/codex.js";
import type { RunSpec } from "../src/types.js";
import { getAdapter } from "../src/adapters/index.js";

const spec = (overrides: Partial<RunSpec>): RunSpec => ({
  prompt: "Do the task",
  cwd: "/repo",
  readOnly: false,
  timeoutMs: 1000,
  ...overrides,
});

describe("buildClaudeArgs", () => {
  it("lets a writer edit files and run the commands it will be judged by", () => {
    const args = buildClaudeArgs(spec({ allowedCommands: ["npm test"], effort: "high", model: "opus" }));

    expect(args).toEqual([
      "-p", "Do the task", "--output-format", "json",
      "--permission-mode", "acceptEdits",
      "--allowedTools", "Bash(npm test)", "Bash(npm test *)",
      "--model", "opus",
      "--effort", "high",
    ]);
  });

  it("limits a read-only agent to reading and asks for output that matches the schema", () => {
    const args = buildClaudeArgs(spec({ readOnly: true, outputSchema: { type: "object" } }));

    expect(args).toEqual([
      "-p", "Do the task", "--output-format", "json",
      "--allowedTools", "Read,Grep,Glob",
      "--json-schema", '{"type":"object"}',
    ]);
  });
});

describe("buildCodexArgs", () => {
  const files = { lastMessage: "/tmp/last.txt" };

  it("writes in the workspace sandbox and takes the prompt from stdin", () => {
    expect(buildCodexArgs(spec({}), files)).toEqual([
      "exec", "--json", "--sandbox", "workspace-write", "--output-last-message", "/tmp/last.txt", "-",
    ]);
  });

  it("runs read-only with a model, reasoning effort and output schema when asked", () => {
    const args = buildCodexArgs(spec({ readOnly: true, model: "some-model", effort: "high" }), {
      ...files,
      schema: "/tmp/schema.json",
    });

    expect(args).toEqual([
      "exec", "--json", "--sandbox", "read-only", "--output-last-message", "/tmp/last.txt",
      "--model", "some-model",
      "--config", 'model_reasoning_effort="high"',
      "--output-schema", "/tmp/schema.json",
      "-",
    ]);
  });
});

describe("parseClaudeOutput", () => {
  it("maps a successful result to message, session and usage", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Added the helper.",
      session_id: "abc123",
      total_cost_usd: 0.0123,
      usage: { input_tokens: 1200, output_tokens: 340 },
    });

    expect(parseClaudeOutput(stdout)).toMatchObject({
      status: "ok",
      finalMessage: "Added the helper.",
      sessionId: "abc123",
      usage: { inputTokens: 1200, outputTokens: 340, costUsd: 0.0123 },
    });
  });

  it("returns structured output as the final message when a schema was used", () => {
    const stdout = JSON.stringify({ is_error: false, result: "", structured_output: { findings: [] } });

    expect(parseClaudeOutput(stdout).finalMessage).toBe('{"findings":[]}');
  });

  it("reports an error result as failed", () => {
    expect(parseClaudeOutput('{"is_error": true, "result": "Credit balance is too low"}').status).toBe("failed");
  });

  it("reports non-JSON output as failed instead of throwing", () => {
    expect(parseClaudeOutput("command not recognized").status).toBe("failed");
  });
});

describe("parseCodexEvents", () => {
  const events = (...list: object[]) => list.map((event) => JSON.stringify(event)).join("\n");

  it("takes the answer from the last-message file and usage from the stream", () => {
    const stdout = events(
      { type: "thread.started", thread_id: "t-1" },
      { type: "turn.started" },
      { type: "turn.completed", usage: { input_tokens: 900, output_tokens: 120 } },
    );

    expect(parseCodexEvents(stdout, '{"findings": []}', 0)).toMatchObject({
      status: "ok",
      finalMessage: '{"findings": []}',
      sessionId: "t-1",
      usage: { inputTokens: 900, outputTokens: 120 },
    });
  });

  it("reports a failed turn with the vendor's message", () => {
    const stdout = events({ type: "turn.failed", error: { message: "model overloaded" } });

    expect(parseCodexEvents(stdout, "", 1)).toMatchObject({ status: "failed", finalMessage: "model overloaded" });
  });

  it("reports a non-zero exit as failed even when no error event was printed", () => {
    expect(parseCodexEvents("not json at all", "", 2).status).toBe("failed");
  });

  it("does not fail a run that reconnected and then finished its turn", () => {
    const stdout = events(
      { type: "thread.started", thread_id: "t-2" },
      { type: "item.completed", item: { id: "item_0", type: "error", message: "Model metadata not found." } },
      { type: "turn.started" },
      { type: "error", message: "Reconnecting... 2/5 (stream disconnected before completion)" },
      { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
    );

    expect(parseCodexEvents(stdout, "done", 0)).toMatchObject({ status: "ok", finalMessage: "done" });
  });

  it("fails a run that never completed a turn, with the last error it printed", () => {
    const stdout = events({ type: "turn.started" }, { type: "error", message: "Reconnecting... 5/5 (proxy refused)" });

    expect(parseCodexEvents(stdout, "", null)).toMatchObject({
      status: "failed",
      finalMessage: "Reconnecting... 5/5 (proxy refused)",
    });
  });
});

describe("getAdapter", () => {
  it("lists the available agents when the id is unknown", () => {
    expect(() => getAdapter("gemini")).toThrow("Available: claude-code, codex");
  });
});
