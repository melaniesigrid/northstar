import { describe, expect, it } from "vitest";
import { parseClaudeOutput } from "../src/adapters/claude-code.js";
import { parseCodexEvents } from "../src/adapters/codex.js";
import { getAdapter } from "../src/adapters/index.js";

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
});

describe("getAdapter", () => {
  it("lists the available agents when the id is unknown", () => {
    expect(() => getAdapter("gemini")).toThrow("Available: claude-code, codex");
  });
});
