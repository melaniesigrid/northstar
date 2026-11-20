# Experiment log

A dated record of what was tried, what was expected, and what happened. Newest entry first.

Each entry answers four questions:

- **Question.** What were we trying to find out?
- **Method.** What was run, on which repo and task, with which agents and config?
- **Result.** What happened, with numbers where there are any?
- **Next.** What does this change about the plan?

Record failures and dead ends too. They are the most useful entries later.

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

**Next.** This run exposed a false positive class but says little about precision on application code, because neither repo has any. The measurement still needs two or three TypeScript or Python repos with real history. The inline script duplication above is now invisible to the gate, which is a known gap.

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
