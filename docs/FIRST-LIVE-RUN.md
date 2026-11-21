# First live run

Everything in this repo has been tested with scripted agents and against the real CLIs up to the sign-in step. No model has done real work through NorthStar yet. This page is the order to do that in, what each step costs, and what to send back.

## Before you start

```bash
git pull
npm install
npm run build
npm link
```

Add `.northstar/` to `.gitignore` in any repo you run this in.

## Step 1: check the agents (about a minute, a few cents)

```bash
northstar doctor --live
```

Every configured agent should say `ready`. If one says `NOT READY`, the line carries the vendor's own message. The usual causes are a CLI that is signed out or a model name the account cannot use.

## Step 2: measure the reviewer (needs Claude Code only)

This step does not use Codex, so it can run first.

```bash
northstar calibrate
```

It replays the last 10 commits through the reviewer, one review each. Expect a few minutes and well under a dollar per commit.

What to look at:

- The share of commits blocked. All of them were accepted by a person.
- Each block's findings. Mark every one as deserved or not deserved.
- Which rules the wrong blocks come from. One rule causing most of them means that rule's wording needs work.

## Step 3: run the benchmark (needs Codex and Claude Code)

```bash
northstar bench
```

Seven tasks, each run twice: Codex alone, then Codex inside the pipeline. This is the long step. A task through the pipeline can take a planner call, up to three writer attempts, and up to three reviews, so allow well over an hour and watch the first task before walking away.

What to look at:

- The two "clean" counts at the top. This is the claim the project rests on.
- Attempts per task. Passes on attempt three, and runs that ended on a repeated change, say whether the loop is worth its cost.
- Tokens, cost, and seconds for the pipeline arm next to the writer alone.
- The "What stopped a run" list at the bottom.

## What to send back

- `.northstar/calibrate/<id>/report.md` and `results.json`
- `.northstar/bench/<id>/report.md` and `results.json`
- For any pipeline run that looks wrong, its folder under `.northstar/runs/`

## What the results decide

| If we see | Then |
| --- | --- |
| The reviewer blocks more than about 1 accepted commit in 5 for reasons you reject | Change the review brief before anything else. See `docs/RESEARCH.md`, decision 10. |
| The pipeline is not cleaner than Codex alone on these tasks | The tasks are too easy or the checks are not catching what Codex gets wrong. Read the raw diffs before building more. |
| The pipeline is cleaner but costs many times more | Look at which role spends it. The planner is the first thing to switch off and compare. |
| Runs often end on attempt three or on a repeated change | Lower `maxIterations` to 2 and improve the feedback text instead. |
| The weak test, unreferenced symbol, and complexity signals never fire on Codex output | They stay advisory or go. |

Seven tasks on one repo cannot prove anything general. They can show whether the machine works and where to look next.
