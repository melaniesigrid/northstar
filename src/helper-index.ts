import { declaredName, isExported } from "./declarations.js";
import { isTestFile } from "./profile.js";

export interface Helper {
  name: string;
  file: string;
  line: number;
  /** False for a helper private to its file. Still worth reusing: export it, do not copy it. */
  exported: boolean;
}

const DEFAULT_LIMIT = 12;
const MIN_WORD_LENGTH = 3;
/** Shortest word that may match a longer one it begins, so "share" finds "shareable" but "form" does not find "format". */
const MIN_STEM_LENGTH = 5;

/** Words too common in tasks and identifiers to say what a helper is about. */
const GENERIC_WORDS = new Set([
  "add", "and", "build", "create", "data", "delete", "file", "find", "for", "from", "function", "get", "handle",
  "helper", "list", "load", "make", "name", "new", "remove", "run", "save", "set", "test", "the", "type", "update",
  "use", "value", "with",
]);

/** Splits prose or an identifier into lowercase words: "formatDueDates" gives format, due, date. */
function meaningfulWords(text: string): Set<string> {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => (word.length > MIN_WORD_LENGTH && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .filter((word) => word.length >= MIN_WORD_LENGTH && !GENERIC_WORDS.has(word));
  return new Set(words);
}

function sameWordFamily(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_STEM_LENGTH && longer.startsWith(shorter);
}

/** Every top-level declaration outside test files, exported or not. */
export function indexHelpers(files: Map<string, string>): Helper[] {
  const helpers: Helper[] = [];
  for (const [file, content] of files) {
    if (isTestFile(file)) continue;
    content.split("\n").forEach((line, index) => {
      const name = declaredName(line);
      if (name) helpers.push({ name, file, line: index + 1, exported: isExported(line) });
    });
  }
  return helpers;
}

/**
 * Picks helpers whose names share words with the task. This is a keyword
 * match, so it surfaces `slugify` for "slugify the title" but will miss a
 * helper the task describes in other words, such as `sd` for "standard
 * deviation".
 */
export function findRelevantHelpers(task: string, helpers: Helper[], limit = DEFAULT_LIMIT): Helper[] {
  const taskWords = [...meaningfulWords(task)];
  return helpers
    .map((helper) => {
      const sharedWords = [...meaningfulWords(helper.name)].filter((word) =>
        taskWords.some((taskWord) => sameWordFamily(word, taskWord)),
      ).length;
      return { helper, sharedWords };
    })
    .filter(({ sharedWords }) => sharedWords > 0)
    .sort((a, b) => b.sharedWords - a.sharedWords || a.helper.name.length - b.helper.name.length)
    .slice(0, limit)
    .map(({ helper }) => helper);
}

export function formatHelpers(helpers: Helper[]): string {
  return helpers
    .map((helper) => `- ${helper.name} (${helper.file}:${helper.line}${helper.exported ? "" : ", not exported yet"})`)
    .join("\n");
}
