# NorthStar

An agent-agnostic quality pipeline for coding agents. Any supported agent writes the code, hard gates check it, and a second agent from a different vendor reviews it. Only a change that clears both is committed.

It is built to lift a weaker writer. The checks, the plan, and the review do not care which model wrote the code, so the standard stays the same when the writer is the cheaper or weaker agent.

The goal is code a human can read and maintain: no duplicated helpers, no dead code, no drive-by edits.

## Status

Early. This repo covers phases 1 and 2 of the Quality Pipeline Spec v0.1.

| Built | Not built yet |
| --- | --- |
| Isolated git worktree per run | Convention rules proposed by an agent |
| Claude Code and Codex adapters behind one interface | Benchmark results from a live run |
| Setup commands and configurable hard gates | Writer rebuttal round |
| Line budget check | Pull request creation |
| Convention profile and reuse search | |
| Optional planner role | |
| Complexity signal for the reviewer | |
| `northstar audit` for scoring past commits | |
| `northstar bench` for comparing the writer alone with the pipeline | |
| Weak test signal for the reviewer | |
| `northstar doctor --live` sign-in check | |
| `northstar calibrate` for measuring the reviewer on commits you accepted | |
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
11. On success the change is committed on the branch. After `maxIterations` failures the run stops and a human decides. It also stops as soon as the writer answers feedback with exactly the change it made before, because another attempt would end the same way. Thresholds are never relaxed to make a run pass.

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

## Measure the difference: bench

`northstar bench` answers the question the whole project rests on: does the pipeline produce cleaner code than the same agent working alone?

It runs each task in `benchmark/tasks` twice from the same commit. The first time the writer gets the task and nothing else, one shot. The second time the task goes through the full pipeline. Both results are then scored by the same gates and slop checks.

```
# NorthStar benchmark of 5 tasks

Clean means every gate passed and no hard slop check failed. Both arms are held to the same test.
- Writer alone: 2 of 5 clean
- Through the pipeline: 5 of 5 clean, 4 of 5 also approved by the reviewer
```

The numbers above only show the layout. No live benchmark has been run yet. Below the summary comes one row per task and arm, with lines changed, duplicated lines, suppressions, attempts, tokens, cost, and time, so the price of the extra quality is always next to it.

Seven seed tasks against NorthStar's own code are included: five that add something near code worth reusing, and two refactors where behavior must hold. See `benchmark/tasks/README.md` for the task format and what makes a good task.

## Measure your reviewer: calibrate

An AI reviewer can be too strict. Studies of models judging code find that they often reject correct code, and that asking for an explanation and a fix along with the verdict makes this worse (see `docs/RESEARCH.md`, decision 10). In NorthStar every wrong block costs an attempt, and three of them end a run with "needs a human".

`northstar calibrate` measures this on your own repo. It shows the reviewer your recent commits, one at a time, exactly as a run would: the commit message as the task, the diff, your conventions, and the slop signals. Then it reports how many of those commits the reviewer would have blocked.

```bash
northstar calibrate              # the last 10 commits
northstar calibrate --commits 25
```

```text
# NorthStar reviewer calibration on 10 commits

The reviewer would have blocked 2 of the 9 commits it judged.

Blocking findings by rule: tests 2, reuse 1.
```

The numbers above only show the layout. Below the summary comes one row per commit and every finding behind each block. A person accepted all of these commits, so read the blocks and decide which were deserved. A block you agree with is the reviewer doing its job on code that slipped through. A block you disagree with is the reviewer being too strict for this repo.

It needs only the reviewer agent, so you can run it before your writer is set up. It costs one review per commit, skips commits over the line budget, and never touches your checkout. The report is saved under `.northstar/calibrate/<id>/`.

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

### Complexity

NorthStar estimates the cognitive complexity of each function a change touches in JavaScript and TypeScript files. Cognitive complexity counts what a reader has to hold in their head: every branch or loop costs one plus its nesting depth, an `else` costs one, and each run of `&&` or `||` costs one. Most linters ship this rule with a limit of 15.

A function is pointed out to the reviewer when it scores over 15 and the change is the reason: the change took it over the limit, or added 5 or more of the points. A two-line fix inside a function that was already complex is left alone.

Named inner functions, such as an event handler declared inside a React component, are scored on their own. Anonymous callbacks count toward the function around them, one nesting level deeper. Test files are skipped.

This is a signal and never blocks by itself. The score is an estimate read from braces and keywords, not from a parser, and a long but flat component can be perfectly readable. On 74 replayed commits it pointed at functions in 10.

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
northstar doctor --live   # also checks that each one is signed in
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

A run that stops for a human leaves its worktree in place so you can read the work. The one exception is a run in which no file was changed, for example because the writer was signed out. That run has nothing to read, so its worktree and branch are removed and the report says so.

### Check that your agents are signed in

A CLI can be installed and still be signed out, and nothing shows it until the first model call. Claude Code, for one, exits 0 and labels the result a success while the answer is an authentication error.

```bash
northstar doctor --live
```

```text
claude-code: installed (2.1.330 (Claude Code))
codex: installed (codex-cli 0.171.0)

codex (writer): ready
claude-code (planner, reviewer): NOT READY. Authentication error
```

It asks each agent for a one-word answer, read-only, with the model your config names, so a mistyped model name shows up here too. Roles that share an agent and a model are checked with one call. In a repo without a config it checks every installed agent. It exits 1 when any agent is not ready.

`northstar bench` runs the same check before its first task and refuses to start when an agent is not ready, because a benchmark with a signed-out agent would spend its whole run producing a table of failures.

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
