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
/**
 * A CLI with no stored sign-in can still work, through a key in the
 * environment, so it gets a real try. It does not get long.
 */
const UNLIKELY_PROBE_TIMEOUT_MS = 20_000;

async function probe(roles: AgentRole[], cwd: string): Promise<AgentCheck> {
  const [{ adapter, model }] = roles as [AgentRole, ...AgentRole[]];
  const check = { agent: adapter.id, model, roles: roles.map((entry) => entry.role) };
  const { installed } = await adapter.detect();
  if (!installed) return { ...check, ready: false, detail: "Not found on PATH." };

  const signInProblem = await adapter.signInProblem?.();
  const timeoutMs = signInProblem === undefined ? PROBE_TIMEOUT_MS : UNLIKELY_PROBE_TIMEOUT_MS;
  const result = await adapter.run({ prompt: PROBE_PROMPT, cwd, model, readOnly: true, timeoutMs });
  if (result.status === "ok") return { ...check, ready: true };
  const detail = signInProblem ?? (tail(result.finalMessage, 500).trim() || `Ended with status "${result.status}".`);
  return { ...check, ready: false, detail };
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

export interface InstallState {
  installed: boolean;
  version?: string;
  /** Set when the CLI could tell, without a model call, that nobody is signed in. */
  signInProblem?: string;
}

/** What `doctor` can learn about a CLI for free: whether it is there and, for some, whether it is signed in. */
export async function inspectInstall(adapter: AgentAdapter): Promise<InstallState> {
  const detected = await adapter.detect();
  if (!detected.installed) return detected;
  return { ...detected, signInProblem: await adapter.signInProblem?.() };
}

/** A needed CLI that is missing or signed out is a problem. One the setup does not use is not. */
export function isUsable(state: InstallState): boolean {
  return state.installed && state.signInProblem === undefined;
}

/** One line for `doctor`. */
export function describeInstall(agent: string, state: InstallState, needed: boolean): string {
  if (!state.installed) {
    return needed ? `${agent}: NOT FOUND on PATH, and your setup uses it` : `${agent}: not installed, and not needed by your setup`;
  }
  if (!needed) return `${agent}: installed (${state.version}), not used by your setup`;
  const signIn = state.signInProblem === undefined ? "" : `, NOT SIGNED IN. ${state.signInProblem}`;
  return `${agent}: installed (${state.version})${signIn}`;
}

/**
 * The roles whose CLI says, without a model call, that nobody is signed in.
 * Checking this first costs nothing, and it keeps a run from waiting out its
 * full time limit on a CLI that was never going to answer.
 */
export async function rolesWithoutSignIn(roles: AgentRole[]): Promise<AgentRole[]> {
  const problems = await Promise.all(roles.map((entry) => entry.adapter.signInProblem?.()));
  return roles.filter((_, index) => problems[index] !== undefined);
}

