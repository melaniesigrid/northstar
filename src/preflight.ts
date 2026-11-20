import { tail } from "./exec.js";
import type { AgentAdapter } from "./types.js";

/** One job in a run and the agent that will do it. */
export interface AgentRole {
  role: string;
  adapter: AgentAdapter;
  model?: string;
}

export interface AgentCheck {
  agent: string;
  model?: string;
  /** Every role this agent and model fill, since one call checks them all. */
  roles: string[];
  ready: boolean;
  /** The agent's own explanation when it is not ready. */
  detail?: string;
}

const PROBE_PROMPT = "Reply with the single word: ready";
const PROBE_TIMEOUT_MS = 120_000;

async function probe(roles: AgentRole[], cwd: string): Promise<AgentCheck> {
  const [{ adapter, model }] = roles as [AgentRole, ...AgentRole[]];
  const check = { agent: adapter.id, model, roles: roles.map((entry) => entry.role) };
  const { installed } = await adapter.detect();
  if (!installed) return { ...check, ready: false, detail: "Not found on PATH." };

  const result = await adapter.run({ prompt: PROBE_PROMPT, cwd, model, readOnly: true, timeoutMs: PROBE_TIMEOUT_MS });
  if (result.status === "ok") return { ...check, ready: true };
  return { ...check, ready: false, detail: tail(result.finalMessage, 500).trim() || `Ended with status "${result.status}".` };
}

/**
 * Asks each agent for a one-word answer, which is the only way to learn that it
 * is signed in and that its model name is accepted before real work depends on
 * it. Roles that share an agent and a model are checked with one call.
 */
export async function checkAgents(roles: AgentRole[], cwd: string): Promise<AgentCheck[]> {
  const groups = new Map<string, AgentRole[]>();
  for (const entry of roles) {
    const key = `${entry.adapter.id}\0${entry.model ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return Promise.all([...groups.values()].map((group) => probe(group, cwd)));
}

export function renderChecks(checks: AgentCheck[]): string {
  return checks
    .map((check) => {
      const name = check.model === undefined ? check.agent : `${check.agent} with ${check.model}`;
      const status = check.ready ? "ready" : `NOT READY. ${check.detail}`;
      return `${name} (${check.roles.join(", ")}): ${status}`;
    })
    .join("\n");
}
