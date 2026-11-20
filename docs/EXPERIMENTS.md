# Experiment log

A dated record of what was tried, what was expected, and what happened. Newest entry first.

Each entry answers four questions:

- **Question.** What were we trying to find out?
- **Method.** What was run, on which repo and task, with which agents and config?
- **Result.** What happened, with numbers where there are any?
- **Next.** What does this change about the plan?

Record failures and dead ends too. They are the most useful entries later.

## 2026-11-20: Benchmark runner built, not yet run live

**Question.** Can the central claim be tested with one command: that the pipeline produces cleaner code than the same writer working alone?

**Method.** Built `northstar bench`. For each task it starts two runs from the same commit. The first gives the writer the task and nothing else, one shot. The second sends the task through the pipeline. Both are scored by the same gates and slop checks, and the report puts tokens, cost, and time beside the quality columns. Wrote five seed tasks against NorthStar's own code, pinned to one commit, each near code worth reusing and one that a raw agent should handle well.

**Result.** The runner is tested with scripted agents on real git repos: a writer that copies a helper is scored as not clean when alone and clean after the pipeline rejects the copy and it fixes it. That shows the runner measures what it should. It says nothing about real agents.

**Next.** Run it with Codex as the writer. Things to look for beyond the headline: whether the planner pays for itself, how many attempts tasks take, what the pipeline costs per task compared with the writer alone, and whether the weak test and unreferenced symbol signals fire on raw Codex output.

## 2026-11-20: Audit command, checked against the earlier replay

**Question.** Does `northstar audit` give the same answers as the throwaway replay script it replaces, and is it safe to run in a real checkout?

**Method.** Ran the command on the five repos replayed earlier and on NorthStar itself, then compared blocked counts. Tests check that the user's HEAD, working tree, and worktree list are unchanged afterwards.

**Result.** The counts match the replay on every repo.

| Repo | Commits | Blocked | Duplicated lines per 1,000 added |
| --- | --- | --- | --- |
| typecase | 12 | 1 | 0.0 |
| quant-harness | 3 | 1 | 7.6 |
| shipshape-platform | 9 | 1 | 2.6 |
| DueBook | 9 | 0 | 0.0 |
| ZipQuarry | 32 | 0 | 0.0 |
| NorthStar | 5 | 0 | 0.0 |

The rates are per 1,000 added lines of source, so repos of different sizes can be compared. This is the first form of the slop score. It is a set of rates, not one number, because nothing yet justifies how to weigh them against each other.

**Next.** Use the audit as the benchmark's measuring tool: score a raw agent's branch and the pipeline's branch for the same task.

## 2026-11-20: Weak test check on 215 real tests

**Question.** Does a check for tests that assert nothing, or only that a value exists, flag honest tests by mistake?

**Method.** The check reads each added test in JavaScript, TypeScript, and Python, takes the lines indented under it, and looks for assertions. Ran it through the audit over quant-harness, shipshape-platform, and NorthStar, which hold 215 tests between them.

**Result.** It recognized all 215 tests and flagged none. So no false positives on this sample, and also no true positives: these repos have no weak tests of the kinds it looks for, which means the check's ability to catch real ones is shown only by unit tests. It reports to the reviewer and does not block.

**Next.** It needs a repo that has weak tests. Published research found strong checks in only 18% of the new test files Codex writes, so raw Codex output on the benchmark tasks is the place to look.

## 2026-11-20: The adapter's arguments against the real Codex CLI

**Question.** Does Codex accept the exact arguments the adapter builds, and does its event stream look the way the parser assumes?

**Method.** Installed Codex CLI 0.171.0 in a scratch folder with an empty home directory and no credentials. Ran the adapter's argument lists for a writer and for a reviewer with a model, a reasoning effort, and an output schema. With no sign-in and no network route to the API, the run can get as far as starting a turn and no further. Checked Claude Code's flags against the help text of version 2.1.329.

**Result.** Codex accepted both argument lists, read the prompt from stdin, started a thread, and began a turn. So the flags, the config override for reasoning effort, and the schema file are all valid.

The event stream showed a real parser bug. Codex prints an `error` event for every reconnect attempt and then carries on. The parser treated any `error` event as a failed run, so a run that dropped its connection once and then finished would have been thrown away. A run now counts as failed only when a turn fails, the process exits non-zero, or no turn completes. The events seen are kept as test fixtures.

**Next.** This proves the arguments parse. It does not prove a run completes, that the structured output arrives as expected, or that the sandbox lets the writer run the gate commands. Those need a signed-in run.

## 2026-11-20: Convention scan and reuse search on four repos

**Question.** Does a scan of file names and manifests produce conventions that are true of the repo, and does a keyword search over declarations surface the helper a task should reuse?

**Method.** Ran the scan and the helper search on NorthStar, typecase, quant-harness, and shipshape-platform, with one realistic task per repo. Read the output against each repo.

**Result.** The scan was right about naming, test layout, folders, and libraries after three fixes the first run exposed:

- Fonts were counted as code in typecase ("most code is in .otf"). The scan now uses readable source text only.
- A lone `.env.example` showed up as a language. Extensions under 5% of source files are left out.
- Helpers private to a file were missing from the index.

The third one mattered. quant-harness has `mean` and `sd` copied into two files, which the duplication gate caught earlier. For a task about "the standard deviation and mean of returns", the search now lists both copies of `mean`, marked as not exported. A writer shown that list has a reason to reuse the helper before the gate ever fires. `sd` is not found from "standard deviation", which is the limit of matching on keywords.

Other spot checks: "add a readiness score bar to the project page" put `ScoreBar` first in shipshape-platform, and "add a share link" found `useShareable` in typecase once a word was allowed to match a longer form of itself.

**Next.** One task per repo is an anecdote. Whether suggested helpers get reused, and whether stated conventions change what a writer produces, can only be measured with live agents on the benchmark tasks. That is what the seed benchmark is for.

## 2026-11-20: Commit replay on three repos with application code

**Question.** On real TypeScript and JavaScript, how often do the slop checks block a commit, and is each block deserved?

**Method.** Same replay as the entry below, on typecase (React, JS), quant-harness (TS), and shipshape-platform (TS monorepo with Next.js and Drizzle): 24 non-merge commits in total. Every flagged block was read and sorted into deserved, debatable, or false positive. The detector was then tightened and the replay repeated.

**Result.**

| Repo | Commits | Blocked at first | Blocked after tightening |
| --- | --- | --- | --- |
| typecase | 12 | 1 | 1 |
| quant-harness | 3 | 1 | 1 |
| shipshape-platform | 9 | 6 | 1 |
| Total | 24 | 8 | 3 |

The first pass over shipshape-platform flagged four kinds of repetition that are not copy-paste:

- Multi-line import lists, where two files import the same names.
- HTML and CSS embedded in template literals.
- Literal data: status lists, theme tokens, seed rows.
- Plain field mappings such as `title: row.title,` repeated between an insert and an update.

The first two are now skipped. The last two no longer block. They are reported as repeated data and sent to the reviewer, because some are worth fixing: one status list is written out in three files when it could be imported.

The three commits still blocked, all read by hand:

- quant-harness: `mean` and `sd` helpers copied whole into a second file. Deserved.
- shipshape-platform: the same five-line query and lookup built twice in one file. Deserved. The same commit also repeats tenant and board foreign key columns across Drizzle tables, which is debatable: a shared column helper would remove it, but many schemas are written this way.
- typecase: one `eslint-disable-next-line react-hooks/exhaustive-deps`. Correctly detected. Whether it should block is a policy choice, which is what `maxNewSuppressions` is for.

No remaining block is a false positive. The unreferenced check flagged a real unused export in typecase (`looksUsing`) and a mix of unused type exports and convention-based Drizzle relations in shipshape-platform, which supports keeping it advisory. HTTP verb handlers such as `GET` are now skipped as found by convention.

One bug surfaced on the way: backticks inside regex literals threw off template literal tracking and exposed embedded CSS to the gate. Tracking now ignores backticks inside regexes and quoted strings.

**Next.** 24 commits across three repos by one author is a small sample. The blocked rate (3 of 24) and the zero false positive count need checking on code by other people before either number is quoted anywhere. Moving repeated data out of the hard gate means the reviewer now carries that judgment, which only a live run can test.

## 2026-11-20: Commit replay on two real repos

**Question.** How often would the slop checks have blocked real commits, and were those blocks deserved?

**Method.** Cloned DueBook and ZipQuarry with their recent history. For each non-merge commit, restaged it on top of its parent and ran the same `checkSlop` path the pipeline uses, with default settings. Also scanned each repo with every line treated as new. Repeated the replay on NorthStar's own history.

**Result.** Both repos turned out to be static sites: HTML, CSS, and a little JavaScript, with no TypeScript.

| Repo | Commits replayed | Blocked | Cause |
| --- | --- | --- | --- |
| DueBook | 9 | 1 | Shared page head copied into a new page |
| ZipQuarry | 32 | 10 | Shared page head, repeated CSS declarations, styles and scripts inlined in one page and also kept in shared files |
| NorthStar | 3 | 0 | |

No suppressions and no unreferenced symbols were flagged in any of them. Every block came from the duplication gate, and nearly all were structural: a new page has to repeat the head of the others, and CSS rules repeat declarations by design. A 31% block rate on a static site is a false positive problem, not a quality signal. One finding was real: about 50 lines of JavaScript live both inline in ZipQuarry's `index.html` and in `writing/article.js`.

Markup and stylesheets are now skipped by the slop checks. After that change the same replay blocks 0 of 9 and 0 of 32 commits.

**Next.** This run exposed a false positive class but says little about precision on application code, because neither repo has any. See the entry above for that measurement. The inline script duplication is now invisible to the gate, which is a known gap.

## 2026-11-20: Suppression and unreferenced symbol checks

**Question.** Which other slop signals can be measured on added lines alone, with no language tooling, and precisely enough to act on?

**Method.** Added two checks. One counts new lint and type escape hatches such as `as any` and `@ts-ignore`. The other lists new top-level symbols whose names appear nowhere else in the repo. Ran both over NorthStar's own 26 files with every line treated as new.

**Result.** The suppression check is precise enough to block: once string literals and comment prose are ignored, it reported nothing false on our code. Its first run did flag one line, the pattern for Java's `@SuppressWarnings` matching its own definition. That pattern was dropped rather than special-cased, since Java is not a target yet. The unreferenced check reported nothing on our code. It is a textual guess that cannot tell dead code from a public API, so it does not block. It hands its list to the reviewer, who can read the repo and decide.

**Next.** The unreferenced check has only been proven on unit tests and a clean codebase. It needs a run on a repo with known dead code to see how much noise it gives the reviewer. Still open from before: a false positive measurement for all three checks on larger repos.

## 2026-11-20: Duplication gate, first run on our own code

**Question.** Can a dependency-free textual check catch copy-paste in added code without flagging ordinary repetition such as imports?

**Method.** Built a clone detector that looks for 5 or more consecutive meaningful lines repeated elsewhere, counting only blocks made entirely of added lines. Ran it over NorthStar's own 20 source and test files with every line treated as new.

**Result.** It found one real clone and no false positives: the same six-line test fixture had been pasted into two test files. The fixture now lives in `test/helpers.ts` and the check comes back clean. Lowering the threshold to 4 lines gave the same result.

**Next.** One small repo proves little. Run it over three larger repos to measure the false positive rate before trusting it as a hard gate elsewhere. A copy with renamed variables is not caught, so decide whether token-level matching is worth its cost once there is benchmark data.

## 2026-11-20: First working loop

**Question.** Can one core drive a writer, hard gates, and a reviewer through a shared adapter interface, with no agent-specific logic in the core?

**Method.** Built the core, the gate runner, the review parser, and adapters for Claude Code and Codex. Tested the loop with scripted fake agents against real git repos created per test.

**Result.** 30 unit and integration tests pass. The loop commits on pass, feeds gate and review failures back to the writer, stops after the attempt limit, discards reviewer writes, and refuses to treat an unreadable review as a pass. The adapters match each CLI's documented flags and output format, but no live run with real agents has been done yet.

**Next.** Run one real task end to end with Claude Code as writer and Codex as reviewer, then swap them using config only. Record cost, wall time, and any output the parsers did not expect.
