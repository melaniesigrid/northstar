/**
 * Top-level declarations in common languages. Each is matched against the raw
 * line, so indented (nested) declarations are skipped. `export default` is
 * left out on purpose, because default exports are imported by file, not by name.
 */
const DECLARATIONS = [
  /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
  /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^func\s+([A-Za-z_]\w*)/,
];

/** Visible outside its own file: exported in JS and TS, any top-level function in Python and Go. */
const EXPORTED = /^(export|def|async def|func)\b/;

/** The name a line declares at the top level of its file, if it declares one. */
export function declaredName(line: string): string | undefined {
  for (const pattern of DECLARATIONS) {
    const name = pattern.exec(line)?.[1];
    if (name) return name;
  }
  return undefined;
}

export function isExported(line: string): boolean {
  return EXPORTED.test(line);
}
