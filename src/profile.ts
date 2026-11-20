import { readFile } from "node:fs/promises";
import path from "node:path";
import { listTrackedFiles } from "./git.js";
import { loadSnapshot, SKIPPED_EXTENSIONS } from "./snapshot.js";

export const PROFILE_FILE = "northstar.profile.json";

export type CaseStyle = "kebab-case" | "snake_case" | "camelCase" | "PascalCase";

/** How a repo is written, as far as file names and manifests show it. */
export interface ConventionProfile {
  /** Source file extensions by how many files use them, most common first. */
  extensions: { extension: string; files: number }[];
  /** The naming style most files of an extension follow. */
  fileNaming: Record<string, CaseStyle>;
  tests?: { pattern: string; location: string };
  /** Top-level folders holding the most source files. */
  directories: string[];
  libraries: string[];
  /** Rules people add by hand. Kept when the profile is regenerated. */
  notes: string[];
}

const CASE_STYLES: [CaseStyle, RegExp][] = [
  ["kebab-case", /^[a-z0-9]+(-[a-z0-9]+)+$/],
  ["snake_case", /^[a-z0-9]+(_[a-z0-9]+)+$/],
  ["camelCase", /^[a-z]+[a-z0-9]*([A-Z][a-z0-9]*)+$/],
  ["PascalCase", /^([A-Z][a-z0-9]*)+$/],
];

const TEST_FOLDER = /(^|\/)(__tests__|tests?)\//;
const TEST_SUFFIX = /\.(test|spec)\.[^/.]+$/;
const PYTHON_TEST = /(^|\/)test_[^/]+\.py$/;

const MAX_EXTENSIONS = 4;
/** An extension used by fewer source files than this share is not worth telling an agent about. */
const MIN_EXTENSION_SHARE = 0.05;
const MAX_DIRECTORIES = 5;
const MAX_LIBRARIES_SHOWN = 40;
/** A style is "the convention" only when most files that show any style agree on it. */
const DOMINANT_SHARE = 0.6;
const MIN_FILES_FOR_A_STYLE = 3;

export function isTestFile(file: string): boolean {
  return TEST_FOLDER.test(file) || TEST_SUFFIX.test(file) || PYTHON_TEST.test(file);
}

function isSourceFile(file: string): boolean {
  const extension = path.extname(file);
  return extension !== "" && !SKIPPED_EXTENSIONS.has(extension) && !file.includes("node_modules/");
}

function mostCommon<T>(items: T[]): { item: T; share: number } | undefined {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  const [top] = [...counts].sort((a, b) => b[1] - a[1]);
  return top && { item: top[0], share: top[1] / items.length };
}

function caseStyleOf(file: string): CaseStyle | undefined {
  const stem = path.basename(file).split(".")[0] ?? "";
  return CASE_STYLES.find(([, pattern]) => pattern.test(stem))?.[0];
}

function dominantNaming(files: string[]): CaseStyle | undefined {
  const styles = files.map(caseStyleOf).filter((style) => style !== undefined);
  const top = mostCommon(styles);
  return top && styles.length >= MIN_FILES_FOR_A_STYLE && top.share >= DOMINANT_SHARE ? top.item : undefined;
}

function describeTests(testFiles: string[]): ConventionProfile["tests"] {
  if (testFiles.length === 0) return undefined;
  const patterns = testFiles.map((file) => {
    if (PYTHON_TEST.test(file)) return "test_*.py";
    const suffix = TEST_SUFFIX.exec(file)?.[0];
    return suffix ? `*${suffix}` : `*${path.extname(file)}`;
  });
  const locations = testFiles.map((file) => {
    if (file.includes("__tests__/")) return "in __tests__ folders";
    const topFolder = file.split("/")[0] ?? "";
    return /^tests?$/.test(topFolder) ? `in the top-level ${topFolder}/ folder` : "beside the code they test";
  });
  return { pattern: mostCommon(patterns)?.item ?? "", location: mostCommon(locations)?.item ?? "" };
}

function librariesIn(manifests: string[]): string[] {
  const names = new Set<string>();
  for (const manifest of manifests) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(manifest) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const group of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const name of Object.keys((parsed[group] as object | undefined) ?? {})) {
        if (!name.startsWith("@types/")) names.add(name);
      }
    }
  }
  return [...names].sort();
}

/** Builds a profile from tracked file paths and the contents of any package manifests. */
export function scanConventions(files: string[], manifests: string[], notes: string[] = []): ConventionProfile {
  const sourceFiles = files.filter(isSourceFile);
  const byExtension = new Map<string, string[]>();
  for (const file of sourceFiles) {
    const extension = path.extname(file);
    byExtension.set(extension, [...(byExtension.get(extension) ?? []), file]);
  }
  const commonExtensions = [...byExtension]
    .filter(([, extensionFiles]) => extensionFiles.length / sourceFiles.length >= MIN_EXTENSION_SHARE)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_EXTENSIONS);

  const fileNaming: Record<string, CaseStyle> = {};
  for (const [extension, extensionFiles] of commonExtensions) {
    const style = dominantNaming(extensionFiles.filter((file) => !isTestFile(file)));
    if (style) fileNaming[extension] = style;
  }

  const folderCounts = new Map<string, number>();
  for (const file of sourceFiles.filter((source) => source.includes("/"))) {
    const folder = `${file.split("/")[0]}/`;
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }

  return {
    extensions: commonExtensions.map(([extension, extensionFiles]) => ({ extension, files: extensionFiles.length })),
    fileNaming,
    tests: describeTests(sourceFiles.filter(isTestFile)),
    directories: [...folderCounts].sort((a, b) => b[1] - a[1]).slice(0, MAX_DIRECTORIES).map(([folder]) => folder),
    libraries: librariesIn(manifests),
    notes,
  };
}

/** The profile as instructions for an agent, or undefined when there is nothing to say. */
export function renderConventions(profile: ConventionProfile): string | undefined {
  const lines: string[] = [];
  if (profile.extensions.length > 0) {
    const list = profile.extensions.map(({ extension, files }) => `${extension} (${files} files)`).join(", ");
    lines.push(`Most code is in ${list}.`);
  }
  const extensionsByStyle = new Map<string, string[]>();
  for (const [extension, style] of Object.entries(profile.fileNaming)) {
    extensionsByStyle.set(style, [...(extensionsByStyle.get(style) ?? []), extension]);
  }
  const naming = [...extensionsByStyle].map(([style, extensions]) => `${style} for ${extensions.join(" and ")}`);
  if (naming.length > 0) lines.push(`File names use ${naming.join(", ")}.`);
  if (profile.tests) lines.push(`Tests are named ${profile.tests.pattern} and live ${profile.tests.location}.`);
  if (profile.directories.length > 0) lines.push(`Code lives mainly in ${profile.directories.join(", ")}.`);
  if (profile.libraries.length > 0) {
    const shown = profile.libraries.slice(0, MAX_LIBRARIES_SHOWN).join(", ");
    const more = profile.libraries.length > MAX_LIBRARIES_SHOWN ? `, and ${profile.libraries.length - MAX_LIBRARIES_SHOWN} more` : "";
    lines.push(`Libraries already in use: ${shown}${more}. Use these before adding a dependency.`);
  }
  lines.push(...profile.notes);
  if (lines.length === 0) return undefined;
  return `Conventions of this repo. Follow them:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

/** Only the rules people wrote by hand, as instructions for an agent. */
export function renderNotes(profile: ConventionProfile): string | undefined {
  if (profile.notes.length === 0) return undefined;
  return `Rules of this repo. Follow them:\n${profile.notes.map((note) => `- ${note}`).join("\n")}`;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Reads a profile a person may have edited. Missing fields fall back to empty. */
export function parseProfile(raw: unknown): ConventionProfile {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Profile: ${PROFILE_FILE} must contain a JSON object.`);
  }
  const profile = raw as Partial<ConventionProfile>;
  for (const key of ["directories", "libraries", "notes"] as const) {
    if (profile[key] !== undefined && !isStringList(profile[key])) {
      throw new Error(`Profile: "${key}" must be a list of strings.`);
    }
  }
  return {
    extensions: profile.extensions ?? [],
    fileNaming: profile.fileNaming ?? {},
    tests: profile.tests,
    directories: profile.directories ?? [],
    libraries: profile.libraries ?? [],
    notes: profile.notes ?? [],
  };
}

/** The committed profile, or undefined when the repo has none. */
export async function loadProfile(cwd: string): Promise<ConventionProfile | undefined> {
  const text = await readFile(path.join(cwd, PROFILE_FILE), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return parseProfile(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Profile: ${PROFILE_FILE} is not valid JSON. ${error.message}`);
    throw error;
  }
}

export async function scanRepo(cwd: string, notes: string[] = []): Promise<ConventionProfile> {
  // The snapshot holds readable source text only, so fonts, images and other binaries never count as code.
  const { files } = await loadSnapshot(cwd);
  const tracked = await listTrackedFiles(cwd);
  const manifestPaths = tracked.filter((file) => path.basename(file) === "package.json" && !file.includes("node_modules/"));
  const manifests = await Promise.all(manifestPaths.map((file) => readFile(path.join(cwd, file), "utf8").catch(() => "")));
  return scanConventions([...files.keys()], manifests, notes);
}
