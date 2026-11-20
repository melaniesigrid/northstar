# Experiment log

A dated record of what was tried, what was expected, and what happened. Newest entry first.

Each entry answers four questions:

- **Question.** What were we trying to find out?
- **Method.** What was run, on which repo and task, with which agents and config?
- **Result.** What happened, with numbers where there are any?
- **Next.** What does this change about the plan?

Record failures and dead ends too. They are the most useful entries later.

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
