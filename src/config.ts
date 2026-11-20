import { readFile } from "node:fs/promises";
import { EFFORTS, type Config, type Effort, type GateConfig, type SlopSettings } from "./types.js";

export const CONFIG_FILE = "northstar.config.json";

const DEFAULTS = {
  maxIterations: 3,
  maxChangedLines: 400,
  minDuplicateLines: 5,
  maxNewSuppressions: 0,
  agentTimeoutMs: 15 * 60_000,
  gateTimeoutMs: 5 * 60_000,
};

export const DEFAULT_SLOP_SETTINGS: SlopSettings = {
  minDuplicateLines: DEFAULTS.minDuplicateLines,
  maxNewSuppressions: DEFAULTS.maxNewSuppressions,
};

type RawConfig = Record<string, unknown>;

function requireString(raw: RawConfig, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Config: "${key}" must be a non-empty string.`);
  }
  return value;
}

function optionalString(raw: RawConfig, key: string): string | undefined {
  return raw[key] === undefined ? undefined : requireString(raw, key);
}

function integerAtLeast(minimum: number, raw: RawConfig, key: keyof typeof DEFAULTS): number {
  const value = raw[key] ?? DEFAULTS[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`Config: "${key}" must be a whole number, ${minimum} or more.`);
  }
  return value;
}

function optionalChoice<T extends string>(raw: RawConfig, key: string, choices: readonly T[]): T | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!choices.includes(value as T)) {
    throw new Error(`Config: "${key}" must be one of: ${choices.join(", ")}.`);
  }
  return value as T;
}

const optionalEffort = (raw: RawConfig, key: string): Effort | undefined => optionalChoice(raw, key, EFFORTS);

function parseSetup(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((command) => typeof command !== "string")) {
    throw new Error('Config: "setup" must be a list of commands.');
  }
  return value as string[];
}

function parseGates(value: unknown): GateConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Config: "gates" must list at least one gate. A run with no gates proves nothing.');
  }
  return value.map((gate: unknown, index) => {
    if (typeof gate !== "object" || gate === null) {
      throw new Error(`Config: gate ${index + 1} must be an object with "name" and "command".`);
    }
    return {
      name: requireString(gate as RawConfig, "name"),
      command: requireString(gate as RawConfig, "command"),
    };
  });
}

export function parseConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Config: the file must contain a JSON object.");
  }
  const config = raw as RawConfig;
  return {
    writer: requireString(config, "writer"),
    reviewer: requireString(config, "reviewer"),
    planner: optionalString(config, "planner"),
    writerModel: optionalString(config, "writerModel"),
    reviewerModel: optionalString(config, "reviewerModel"),
    plannerModel: optionalString(config, "plannerModel"),
    writerEffort: optionalEffort(config, "writerEffort"),
    reviewerEffort: optionalEffort(config, "reviewerEffort"),
    plannerEffort: optionalEffort(config, "plannerEffort"),
    writerConventions: optionalChoice(config, "writerConventions", ["notes", "all"] as const) ?? "notes",
    maxIterations: integerAtLeast(1, config, "maxIterations"),
    maxChangedLines: integerAtLeast(1, config, "maxChangedLines"),
    minDuplicateLines: integerAtLeast(1, config, "minDuplicateLines"),
    maxNewSuppressions: integerAtLeast(0, config, "maxNewSuppressions"),
    setup: parseSetup(config.setup),
    gates: parseGates(config.gates),
    agentTimeoutMs: integerAtLeast(1, config, "agentTimeoutMs"),
    gateTimeoutMs: integerAtLeast(1, config, "gateTimeoutMs"),
  };
}

export async function loadConfig(file: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(`Config: could not read ${file}. Create it in the repo root (see README).`);
  }
  try {
    return parseConfig(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Config: ${file} is not valid JSON. ${error.message}`);
    throw error;
  }
}
