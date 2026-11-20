import type { AgentAdapter } from "../types.js";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";

const ADAPTERS: AgentAdapter[] = [claudeCode, codex];

export function listAdapters(): AgentAdapter[] {
  return ADAPTERS;
}

export function getAdapter(id: string): AgentAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) {
    const known = ADAPTERS.map((candidate) => candidate.id).join(", ");
    throw new Error(`Unknown agent "${id}". Available: ${known}.`);
  }
  return adapter;
}
