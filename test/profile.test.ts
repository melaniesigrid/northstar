import { describe, expect, it } from "vitest";
import { parseProfile, renderConventions, scanConventions } from "../src/profile.js";

const REACT_REPO = [
  "src/components/UserCard.tsx",
  "src/components/NavBar.tsx",
  "src/components/DataTable.tsx",
  "src/lib/date-utils.ts",
  "src/lib/api-client.ts",
  "src/lib/form-state.ts",
  "src/lib/date-utils.test.ts",
  "src/lib/api-client.test.ts",
  "README.md",
  "package.json",
];

const MANIFEST = JSON.stringify({
  dependencies: { react: "^19.0.0", "@tanstack/react-query": "^5.0.0" },
  devDependencies: { vitest: "^3.0.0", "@types/node": "^22.0.0" },
});

describe("scanConventions", () => {
  it("reads naming, tests, layout and libraries from a typical React repo", () => {
    expect(scanConventions(REACT_REPO, [MANIFEST])).toEqual({
      extensions: [
        { extension: ".ts", files: 5 },
        { extension: ".tsx", files: 3 },
      ],
      fileNaming: { ".ts": "kebab-case", ".tsx": "PascalCase" },
      tests: { pattern: "*.test.ts", location: "beside the code they test" },
      directories: ["src/"],
      libraries: ["@tanstack/react-query", "react", "vitest"],
      notes: [],
    });
  });

  it("recognizes tests kept in a top-level folder", () => {
    const profile = scanConventions(["src/a.ts", "test/a.test.ts", "test/b.test.ts"], []);

    expect(profile.tests).toEqual({ pattern: "*.test.ts", location: "in the top-level test/ folder" });
  });

  it("leaves out extensions only a stray file uses", () => {
    const files = [...Array.from({ length: 30 }, (_, index) => `src/module-${index}.ts`), ".env.example"];

    expect(scanConventions(files, []).extensions).toEqual([{ extension: ".ts", files: 30 }]);
  });

  it("claims no naming style when files do not agree on one", () => {
    const mixed = ["src/date-utils.ts", "src/api-client.ts", "src/formState.ts", "src/userStore.ts"];

    expect(scanConventions(mixed, []).fileNaming).toEqual({});
  });

  it("keeps hand-written notes through a rescan", () => {
    expect(scanConventions(["src/a.ts"], [], ["Store dates in UTC."]).notes).toEqual(["Store dates in UTC."]);
  });

  it("ignores a manifest that is not valid JSON", () => {
    expect(scanConventions(["src/a.ts"], ["{ not json"]).libraries).toEqual([]);
  });
});

describe("renderConventions", () => {
  it("turns a profile into instructions an agent can follow", () => {
    const text = renderConventions(scanConventions(REACT_REPO, [MANIFEST], ["Store dates in UTC."]));

    expect(text).toBe(
      [
        "Conventions of this repo. Follow them:",
        "- Most code is in .ts (5 files), .tsx (3 files).",
        "- File names use kebab-case for .ts, PascalCase for .tsx.",
        "- Tests are named *.test.ts and live beside the code they test.",
        "- Code lives mainly in src/.",
        "- Libraries already in use: @tanstack/react-query, react, vitest. Use these before adding a dependency.",
        "- Store dates in UTC.",
      ].join("\n"),
    );
  });

  it("says nothing when there is nothing to say", () => {
    expect(renderConventions(scanConventions(["README.md"], []))).toBeUndefined();
  });
});

describe("parseProfile", () => {
  it("accepts a file that holds only notes", () => {
    expect(parseProfile({ notes: ["Store dates in UTC."] })).toMatchObject({
      notes: ["Store dates in UTC."],
      libraries: [],
      fileNaming: {},
    });
  });

  it("rejects notes that are not a list of strings", () => {
    expect(() => parseProfile({ notes: "Store dates in UTC." })).toThrow('"notes"');
  });
});
