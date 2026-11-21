import { describe, expect, it } from "vitest";
import { findComplexFunctions, scoreFile } from "../src/complexity.js";
import type { ChangeSnapshot } from "../src/snapshot.js";

const everyLine = (content: string): Set<number> => new Set(content.split("\n").map((_, index) => index + 1));

/** A change that added the given lines of the given files. */
function change(files: Record<string, string>, added: Record<string, Set<number>>): ChangeSnapshot {
  return { files: new Map(Object.entries(files)), addedLines: new Map(Object.entries(added)), addedText: [] };
}

/** Name and score of each function in a file, in order. */
function scores(content: string): [string, number][] {
  return scoreFile("code.ts", content, new Set()).map((fn) => [fn.name, fn.score]);
}

const SUM_OF_PRIMES = `function sumOfPrimes(max) {
  let total = 0;
  for (let i = 1; i <= max; ++i) {
    for (let j = 2; j < i; ++j) {
      if (i % j === 0) {
        total -= i;
      }
    }
    total += i;
  }
  return total;
}`;

/** Scores 17 by hand: if 1, nested if 2 and its || 1, else if 1 and its && 1, for 3, if 4, else 1, ternary 3. */
const TANGLED = `export function route(event: Event, state: State): string {
  if (event.kind === "key") {
    if (event.meta || event.ctrl) {
      return "ignored";
    } else if (event.key === "j" && state.rows > 0) {
      for (const row of state.list) {
        if (row.active) {
          return row.id;
        }
      }
    } else {
      return state.fallback ? "fallback" : "none";
    }
  }
  return "none";
}`;

describe("scoreFile", () => {
  it("charges a branch or loop one plus its nesting level", () => {
    // for 1, nested for 2, nested if 3
    expect(scores(SUM_OF_PRIMES)).toEqual([["sumOfPrimes", 6]]);
  });

  it("charges else branches and each run of one logical operator a flat one", () => {
    const content = `export function pick(a: boolean, b: boolean, c: boolean): number {
  if (a && b && c) {
    return 1;
  } else if (a || b) {
    return 2;
  } else {
    return 3;
  }
}`;
    // if 1, && run 1, else if 1, || run 1, else 1
    expect(scores(content)).toEqual([["pick", 5]]);
  });

  it("counts a condition that runs over several lines as one run", () => {
    const content = `function ready(a, b, c) {
  return (
    a.loaded &&
    b.loaded &&
    c.loaded
  );
}`;
    expect(scores(content)).toEqual([["ready", 1]]);
  });

  it("treats an anonymous callback as one more level of nesting in its function", () => {
    const content = `const run = (items: Item[]): number => {
  let total = 0;
  items.forEach((item) => {
    if (item.ok) {
      for (const x of item.xs) {
        total += x ? 1 : 0;
      }
    }
  });
  return total;
};`;
    // if 2, for 3, ternary 4
    expect(scores(content)).toEqual([["run", 9]]);
  });

  it("scores a named inner function on its own", () => {
    const content = `export function Page() {
  const onKey = (event) => {
    if (event.meta) return;
    if (event.key === "j") next();
  };
  if (!ready) return null;
  return view;
}`;
    expect(scores(content)).toEqual([
      ["Page", 1],
      ["onKey", 2],
    ]);
  });

  it("scores class methods one by one, without charging for try", () => {
    const content = `export class Parser {
  parse(
    input: string,
    options?: { strict: boolean },
  ): Promise<Result> {
    try {
      while (this.more()) {
        if (input.startsWith("{")) this.depth++;
      }
    } catch (error) {
      if (options?.strict) throw error;
    }
    return done;
  }
  size() { return this.depth; }
}`;
    // while 1, nested if 2, catch 1, nested if 2
    expect(scores(content)).toEqual([
      ["parse", 6],
      ["size", 0],
    ]);
  });

  it("ignores keywords and braces inside strings, comments and template text", () => {
    const content = [
      "function quiet() {",
      '  const text = "if (a && b) { for (;;) {} }"; // if (x) {',
      "  const page = `while (x) {",
      "    if (y) {",
      "  `;",
      "  /* if (z) { */",
      "  return text ?? page;",
      "}",
    ].join("\n");
    expect(scores(content)).toEqual([["quiet", 0]]);
  });

  it("does not take optional members or optional chaining for a ternary", () => {
    const content = `function label(user?: User, options?: { short?: boolean }) {
  return user?.name ?? options?.short;
}`;
    expect(scores(content)).toEqual([["label", 0]]);
  });
});

describe("findComplexFunctions", () => {
  it("reports a function the change wrote that is over the limit", () => {
    const found = findComplexFunctions(change({ "src/route.ts": TANGLED }, { "src/route.ts": everyLine(TANGLED) }));

    expect(found).toEqual([{ file: "src/route.ts", line: 1, name: "route", score: 17, addedScore: 17 }]);
  });

  it("stays quiet about a complex function the change barely touched", () => {
    const lastLineOnly = new Set([TANGLED.split("\n").length - 1]);

    expect(findComplexFunctions(change({ "src/route.ts": TANGLED }, { "src/route.ts": lastLineOnly }))).toEqual([]);
  });

  it("reports a small addition when it is what took the function over the limit", () => {
    // The ternary on line 12 costs 3 here, and without it the function scores 14.
    const found = findComplexFunctions(change({ "src/route.ts": TANGLED }, { "src/route.ts": new Set([12]) }));

    expect(found).toMatchObject([{ name: "route", score: 17, addedScore: 3 }]);
  });

  it("stays quiet about simple functions, test files and languages it cannot read", () => {
    const files = { "src/sum.ts": SUM_OF_PRIMES, "src/route.test.ts": TANGLED, "tools/route.py": TANGLED };
    const added = Object.fromEntries(Object.entries(files).map(([file, content]) => [file, everyLine(content)]));

    expect(findComplexFunctions(change(files, added))).toEqual([]);
  });
});
