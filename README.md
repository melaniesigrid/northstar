# NorthStar

An agent-agnostic quality pipeline for coding agents. Any supported agent writes the code, hard gates check it, and a second agent from a different vendor reviews it. Only a change that clears both is committed.

It is built to lift a weaker writer. The checks, the plan, and the review do not care which model wrote the code, so the standard stays the same when the writer is the cheaper or weaker agent.

The goal is code a human can read and maintain: no duplicated helpers, no dead code, no drive-by edits.

## Status

Early. This repo covers phases 1 and 2 of the Quality Pipeline Spec v0.1.

| Built | Not built yet |
| --- | --- |
| Isolated git worktree per run | Complexity check |
| Claude Code and Codex adapters behind one interface | Convention rules proposed by an agent |
| Setup commands and configurable hard gates | Slop score and benchmark |
| Line budget check | Writer rebuttal round |
| Convention profile and reuse search | Pull request creation |
| Optional planner role | |
| `northstar audit` for scoring past commits | |
| Weak test signal for the reviewer | |
| Duplication gate | |
| Suppression gate | |
| AI credit gate | |
| Unreferenced symbol signal for the reviewer | |
| Cross-vendor review with structured findings | |
| Retry loop with exact feedback, capped attempts | |
| Run report and JSON audit log | |

The adapters are checked against each CLI's documented flags, and the Codex adapter's exact arguments were run through the real Codex CLI up to the sign-in step. No full live run with both agents has happened yet. See `docs/EXPERIMENTS.md`. The reasons behind the design are in `docs/RESEARCH.md`.

## How a run works

1. NorthStar creates a branch `northstar/<run id>` in its own worktree. Your checkout is never touched.
2. Setup commands run once, for example `npm ci`.
3. NorthStar reads the repo's conventions and finds existing helpers that relate to the task.
4. If a planner is configured, it reads the repo and writes a short plan with done-when checks.
5. The writer agent makes the change. Its brief holds the task, the plan, your rules, the relevant helpers, and every limit it will be checked against.
6. The change is staged and checked against the line budget.
7. The built-in slop checks run on what the change added.
8. Each configured gate runs in order. A gate is any command that exits 0 on success.
9. The reviewer agent reads the staged diff and returns findings as JSON. Anything it writes is discarded.
10. A failed check or a blocking finding goes back to the writer with the exact reason.
11. On success the change is committed on the branch. After `maxIterations` failures the run stops and a human decides. Thresholds are never relaxed to make a run pass.

A review that cannot be parsed is never treated as a pass.

## Try it in one minute: audit your history

`northstar audit` runs the slop checks over your recent commits and shows what the pipeline would have said about each one. It needs no config file and no agent, and it works in a scratch worktree, so your checkout is never touched.

```bash
northstar audit                 # the last 30 commits
northstar audit --commits 100
northstar audit --json          # the full findings, for your own analysis
```

```
# NorthStar audit of 9 commits

1 of 9 commits would have been blocked.

Per 1,000 added lines of source (9342 lines in total):
- Duplicated lines: 2.6
- New suppressions: 0.0
- AI credit notes: 0.0
```

Below the summary comes one row per commit, then the exact reason for each blocked commit with file and line. Merge commits and a repo's first commit are left out, since neither has a single parent to compare against.

The audit is also how NorthStar measures itself: the same command scores a raw agent's output and the pipeline's output on the same tasks.

## Using NorthStar with Codex

A good setup when Codex is your everyday writer and you also have Claude Code:

```json
{
  "writer": "codex",
  "planner": "claude-code",
  "reviewer": "claude-code",
  "writerEffort": "high",
  "setup": ["npm ci"],
  "gates": [
    { "name": "typecheck", "command": "npm run typecheck" },
    { "name": "test", "command": "npm test" }
  ]
}
```

What this does for a weaker writer:

- **The planner thinks first.** It reads the repo and decides which files change, what to reuse, which tests to add, and what "done" means. The writer spends its effort on writing.
- **The brief is short.** Codex's own guidance is that coding models do worse when over-prompted, so the writer gets the task, the plan, your rules, and its limits, and little else.
- **Nothing is a surprise.** The writer is told the exact commands it will be checked with and may run them itself before it finishes.
- **The judge is not the author.** A second vendor reviews with a skeptical brief and concrete examples of what blocks a merge. Findings come back as structured output, so a chatty reply cannot break the run.
- **Rejections are exact.** A failed check returns the file, the line, and the reason, which is the feedback a weaker model needs to fix a problem in one more try.

With Codex alone, set `reviewer` to `codex` and give it a different `reviewerModel` or a higher `reviewerEffort`. The run works, and the report says the review came from the writer's own vendor.

Codex runs the writer in its workspace sandbox, which has no network by default. Put dependency installs in `setup`, which runs before the writer starts.

## Conventions and reuse

Before the writer starts, NorthStar finds out how the repo is written and which existing code looks relevant. The planner and the reviewer get the full conventions, so plans, naming, and reuse are judged against the repo and not against a model's habits.

The writer gets less on purpose: your hand-written rules and the relevant helpers, not the scanned overview. A 2026 study found that broad context files lowered task success and raised cost by more than 20%, while short, specific, human-written instructions helped. Set `"writerConventions": "all"` to give the writer everything.

### Convention profile

A scan of tracked files and package manifests finds:

- The extensions most code is written in
- The file naming style each extension follows, when most files agree on one
- How tests are named and where they live
- The folders that hold most of the code
- The libraries already in use

Run `northstar profile` to write the result to `northstar.profile.json`, then review it, edit it, and commit it. Add your own rules under `notes`. They reach every agent word for word and are kept when you rescan. Keep them few and specific: a rule earns its place when an agent has made the mistake it prevents.

```json
{ "notes": ["Store dates in UTC.", "Server components by default. Add \"use client\" only for interactivity."] }
```

A committed profile is used as it stands. Without one, the repo is scanned at the start of each run.

### Reuse search

NorthStar indexes every top-level declaration outside test files and gives the writer up to 12 whose names share words with the task:

```
Existing helpers that look relevant. Reuse them instead of writing new ones:
- formatDueDate (src/dates.ts:10)
- mean (src/features/causal.ts:55, not exported yet)
```

A helper private to its file is listed too, marked as not exported, because exporting it beats copying it. The match is on keywords, so it finds `slugify` for "slugify the title" and misses `sd` for "standard deviation". The duplication gate is the backstop for what it misses.

### No AI credits

Work that goes through NorthStar reads as written by your team. The writer is told to leave no tool signatures, and the AI credit gate blocks any added line that credits an AI tool, in code, comments, or documentation. The commit NorthStar makes carries the task as its message and nothing else.

## Slop checks

These checks run on every change before any configured gate. They need no setup and no extra dependencies, and they only ever look at lines the change added. Code that was already in the repo is never held against a change.

| Check | Catches | Outcome |
| --- | --- | --- |
| Duplication | Copy-pasted code | Blocks the change |
| Suppressions | New `as any`, `@ts-ignore`, `eslint-disable` and similar | Blocks past `maxNewSuppressions` |
| AI credits | Lines crediting an AI tool, in code or docs | Blocks the change |
| Repeated data | Copied lists of literals and field mappings | Passed to the reviewer to verify |
| Weak tests | New tests with no assertion, or that only check a value exists | Passed to the reviewer to verify |
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

### Weak tests

A test with no assertion runs the code and passes whatever the code does. A test that only checks a value is defined, or that nothing threw, is barely better. This check finds both in the tests a change adds, in JavaScript, TypeScript, and Python, and sends them to the reviewer with the reason.

It does not block on its own, because a test can delegate its checks to a helper the check does not recognize. Skipped tests and `todo` placeholders are ignored.

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
northstar profile     # scans the repo's conventions into northstar.profile.json
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
| `planner` | no | none | Agent that plans before the writer starts |
| `gates` | yes | | List of `{ "name", "command" }`. At least one |
| `setup` | no | `[]` | Commands run once in the fresh worktree |
| `writerModel`, `reviewerModel`, `plannerModel` | no | CLI default | Passed to the agent's `--model` flag |
| `writerEffort`, `reviewerEffort`, `plannerEffort` | no | CLI default | `low`, `medium` or `high`. Mapped to each CLI's reasoning effort setting |
| `writerConventions` | no | `notes` | `notes` gives the writer your hand-written rules only. `all` adds the scanned conventions |
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
