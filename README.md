# NorthStar

An agent-agnostic quality pipeline for coding agents. Any supported agent writes the code, hard gates check it, and a second agent from a different vendor reviews it. Only a change that clears both is committed.

The goal is code a human can read and maintain: no duplicated helpers, no dead code, no drive-by edits.

## Status

Early. This repo covers phases 1 and 2 of the Quality Pipeline Spec v0.1.

| Built | Not built yet |
| --- | --- |
| Isolated git worktree per run | Complexity check |
| Claude Code and Codex adapters behind one interface | Repo convention profile and reuse search |
| Setup commands and configurable hard gates | Slop score and benchmark |
| Line budget check | Writer rebuttal round |
| Duplication gate | Pull request creation |
| Suppression gate | |
| Unreferenced symbol signal for the reviewer | |
| Cross-vendor review with structured findings | |
| Retry loop with exact feedback, capped attempts | |
| Run report and JSON audit log | |

The adapters are checked against each CLI's documented flags and output, and their parsers are unit tested. They have not yet been exercised in a full live run with both agents. See `docs/EXPERIMENTS.md`.

## How a run works

1. NorthStar creates a branch `northstar/<run id>` in its own worktree. Your checkout is never touched.
2. Setup commands run once, for example `npm ci`.
3. The writer agent makes the change.
4. The change is staged and checked against the line budget.
5. The built-in slop checks run on the added code: duplication, new suppressions, and unreferenced symbols.
6. Each configured gate runs in order. A gate is any command that exits 0 on success.
7. The reviewer agent reads the staged diff and returns findings as JSON. Anything it writes is discarded.
8. A failed check or a blocking finding goes back to the writer with the exact reason.
9. On success the change is committed on the branch. After `maxIterations` failures the run stops and a human decides. Thresholds are never relaxed to make a run pass.

A review that cannot be parsed is never treated as a pass.

## Slop checks

Three checks run on every change before any configured gate. They need no setup and no extra dependencies, and they only ever look at lines the change added. Code that was already in the repo is never held against a change.

| Check | Catches | Outcome |
| --- | --- | --- |
| Duplication | Copy-pasted code | Blocks the change |
| Suppressions | New `as any`, `@ts-ignore`, `eslint-disable` and similar | Blocks past `maxNewSuppressions` |
| Repeated data | Copied lists of literals and field mappings | Passed to the reviewer to verify |
| Unreferenced symbols | New top-level names nothing else uses | Passed to the reviewer to verify |

The split is deliberate. A check blocks only where replaying real commit history showed its findings were deserved. Signals that are often fine in practice go to the reviewer, who can read the repo and decide.

### Duplication

The gate blocks added code that repeats code already in the repo, and tells the writer where the original lives:

```
New code repeats code the repo already has. Reuse or extract the original instead:
- src/copy.ts:1-5 repeats src/slug.ts:1
```

How it decides:

- A clone is `minDuplicateLines` or more consecutive meaningful lines (default 5) that also appear elsewhere, in another file or the same one.
- Blank lines, comments, imports including multi-line name lists, and lines that are only brackets are skipped, and indentation is ignored.
- Text inside a multi-line template literal is skipped. It is embedded HTML or CSS, not code.
- Only blocks made entirely of added lines count. Duplication that existed before the change is never held against it.
- A block the change adds twice is flagged in both places.
- A clone blocks only if it holds at least `minDuplicateLines` lines of logic. Lines that just declare a value do not count toward that: list entries, `key: "value"` pairs, union members, and plain field mappings such as `title: row.title,`. A repeat made mostly of those goes to the reviewer as repeated data.
- Prose, data, markup, and stylesheets are not checked: Markdown, JSON, YAML, lockfiles, HTML, XML, CSS and similar. Pages share a head and a footer and style rules share declarations, so repetition there is structure, not copy-paste.

Limits: matching is textual, so a copy with renamed variables gets through. Catching those is the reviewer's job for now. Script or style blocks written inline in an HTML file are not checked either.

### Suppressions

Silencing a check is the cheapest way for an agent to make a gate pass. This check counts the escape hatches a change adds and blocks it when the count is over `maxNewSuppressions` (default 0):

- Comment directives: `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `# type: ignore`, `# noqa`, `nolint`, `rubocop:disable`
- TypeScript escapes: `as any`, `: any`, and `any` as a type argument

Text inside string literals and prose inside comments is ignored, so an error message that says "Expected: any of..." does not count.

### Unreferenced symbols

For each new top-level function, constant, class, or type, the check looks for the name anywhere else in the repo. A name that appears only at its own declaration is likely dead code, but it could also be a public API or something a framework finds by convention. So this check never blocks on its own. It gives the reviewer the list and asks for a blocking finding only where the symbol is truly unused.

Default exports, `main`, and test functions are skipped.

## Quick start

Requires Node 20 or newer, git, and the agent CLIs you plan to use, each installed and signed in by you.

```bash
npm install
npm run build
npm link              # makes the `northstar` command available

northstar doctor      # shows which agent CLIs are installed
```

In the repo you want to work on, add `northstar.config.json`:

```json
{
  "writer": "claude-code",
  "reviewer": "codex",
  "setup": ["npm ci"],
  "gates": [
    { "name": "typecheck", "command": "npm run typecheck" },
    { "name": "test", "command": "npm test" }
  ]
}
```

Then run a task:

```bash
northstar run "Add a slugify helper to src/strings.ts with tests"
```

The report prints to the terminal and is saved with a JSON log under `.northstar/runs/<run id>/`. Add `.northstar/` to that repo's `.gitignore`.

Exit codes: `0` the change passed and is committed on its branch, `1` a human needs to look, `2` usage or config error.

## Config reference

| Key | Required | Default | Meaning |
| --- | --- | --- | --- |
| `writer` | yes | | Agent that writes: `claude-code` or `codex` |
| `reviewer` | yes | | Agent that reviews. Pick a different vendor from the writer |
| `gates` | yes | | List of `{ "name", "command" }`. At least one |
| `setup` | no | `[]` | Commands run once in the fresh worktree |
| `writerModel`, `reviewerModel` | no | CLI default | Passed to the agent's `--model` flag |
| `maxIterations` | no | `3` | Writer attempts before a human takes over |
| `maxChangedLines` | no | `400` | Line budget for one change |
| `minDuplicateLines` | no | `5` | Length of a repeated block that counts as a clone |
| `maxNewSuppressions` | no | `0` | New lint or type suppressions a change may add |
| `agentTimeoutMs` | no | `900000` | Time limit for one agent turn |
| `gateTimeoutMs` | no | `300000` | Time limit for one gate or setup command |

Gates should check, not fix. Anything a gate writes is dropped, so use `prettier --check` rather than `prettier --write`.

If writer and reviewer share a vendor, the run still works and the report says the review was a weaker check.

## Credentials

NorthStar never reads, stores, or forwards credentials. It starts the vendor's own unmodified CLI, which uses whatever sign-in or API key you set up for it. Each vendor bills you directly.

## Adding an agent

Implement `AgentAdapter` from `src/types.ts` and register it in `src/adapters/index.ts`. The core never branches on which agent it is running, so nothing else changes.

## Development

```bash
npm run typecheck
npm test
```

`northstar.config.json` in this repo lets NorthStar work on itself.

## License

Not yet chosen. Until it is, all rights are reserved.
