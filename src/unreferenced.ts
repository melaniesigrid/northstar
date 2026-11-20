import { addedLinesOf, type ChangeSnapshot } from "./snapshot.js";

export interface UnreferencedSymbol {
  file: string;
  line: number;
  name: string;
}

/**
 * Top-level declarations in common languages. Each is matched against the raw
 * line, so indented (nested) declarations are skipped: compilers and linters
 * already catch unused locals. `export default` is left out on purpose,
 * because default exports are imported by file, not by name.
 */
const DECLARATIONS = [
  /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
  /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^func\s+([A-Za-z_]\w*)/,
];

/** Names a runtime, test runner or web framework finds by convention, with no reference in code. */
const FOUND_BY_CONVENTION = /^(main$|[Tt]est|(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$)/;

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

function declaredName(line: string): string | undefined {
  for (const pattern of DECLARATIONS) {
    const name = pattern.exec(line)?.[1];
    if (name) return name;
  }
  return undefined;
}

function countIdentifiers(files: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const content of files.values()) {
    for (const [identifier] of content.matchAll(IDENTIFIER)) {
      counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Finds top-level symbols the change declares whose name appears nowhere else
 * in the repo. This is a textual signal, not proof: a public API or a name a
 * framework looks up will show here too. The reviewer verifies each one.
 */
export function findUnreferencedSymbols(snapshot: ChangeSnapshot): UnreferencedSymbol[] {
  const counts = countIdentifiers(snapshot.files);
  const unreferenced: UnreferencedSymbol[] = [];
  for (const { file, number, text } of addedLinesOf(snapshot)) {
    const name = declaredName(text);
    if (name && !FOUND_BY_CONVENTION.test(name) && counts.get(name) === 1) {
      unreferenced.push({ file, line: number, name });
    }
  }
  return unreferenced;
}
