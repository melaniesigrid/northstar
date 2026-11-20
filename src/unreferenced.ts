import { declaredName } from "./declarations.js";
import { addedLinesOf, type ChangeSnapshot } from "./snapshot.js";

export interface UnreferencedSymbol {
  file: string;
  line: number;
  name: string;
}

/** Names a runtime, test runner or web framework finds by convention, with no reference in code. */
const FOUND_BY_CONVENTION = /^(main$|[Tt]est|(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$)/;

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

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
