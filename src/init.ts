import type { GateConfig } from "./types.js";

/** What `init` can work out from a repo: how to install it and which of its own scripts can serve as gates. */
export interface Suggestion {
  setup: string[];
  gates: GateConfig[];
}

/** The lockfile says which package manager the repo uses, and each has its own exact-install command. */
const PACKAGE_MANAGERS = [
  { lockfile: "pnpm-lock.yaml", run: "pnpm", install: "pnpm install --frozen-lockfile" },
  { lockfile: "yarn.lock", run: "yarn", install: "yarn install --frozen-lockfile" },
  { lockfile: "bun.lockb", run: "bun run", install: "bun install --frozen-lockfile" },
  { lockfile: "bun.lock", run: "bun run", install: "bun install --frozen-lockfile" },
  { lockfile: "package-lock.json", run: "npm run", install: "npm ci" },
];
const NPM = { run: "npm run", install: "npm install" };

/** Scripts worth running as gates, cheapest first, each under the names repos commonly give it. */
const GATE_SCRIPTS = [
  { gate: "typecheck", scripts: ["typecheck", "type-check", "check-types", "tsc"] },
  { gate: "lint", scripts: ["lint"] },
  { gate: "test", scripts: ["test"] },
];

/** The script `npm init` writes, which fails on purpose. */
const PLACEHOLDER_TEST = /no test specified/;

/**
 * Suggests setup and gates from a package manifest and the files next to it.
 * It only offers scripts the repo already has, since a gate nobody runs by
 * hand is a gate nobody trusts.
 */
export function suggestConfig(manifest: unknown, files: string[]): Suggestion {
  const scripts = (manifest as { scripts?: Record<string, unknown> } | undefined)?.scripts ?? {};
  const manager = PACKAGE_MANAGERS.find(({ lockfile }) => files.includes(lockfile)) ?? NPM;
  const gates: GateConfig[] = [];
  for (const { gate, scripts: names } of GATE_SCRIPTS) {
    const script = names.find((name) => typeof scripts[name] === "string" && !PLACEHOLDER_TEST.test(scripts[name]));
    if (script) gates.push({ name: gate, command: `${manager.run} ${script}` });
  }
  return { setup: manifest === undefined ? [] : [manager.install], gates };
}

const IGNORE_ENTRY = ".northstar/";

/** The ignore file with NorthStar's working folder added, or undefined when it is already covered. */
export function withIgnoreEntry(gitignore: string): string | undefined {
  const covered = gitignore.split("\n").some((line) => [".northstar", IGNORE_ENTRY].includes(line.trim()));
  if (covered) return undefined;
  const separator = gitignore === "" || gitignore.endsWith("\n") ? "" : "\n";
  return `${gitignore}${separator}${IGNORE_ENTRY}\n`;
}
