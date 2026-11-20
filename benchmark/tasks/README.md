# Benchmark tasks

Each task is run twice from the same commit: once with the writer on its own and once through the pipeline. Both results are scored by the same gates and slop checks.

```bash
northstar bench                     # runs every task in this folder
northstar bench --tasks other/dir   # runs tasks kept somewhere else
```

The report prints to the terminal and is saved with the full results under `.northstar/bench/<id>/`. A run uses your agents for every task, twice, so it costs real usage and takes a while. Before the first task it asks each configured agent for a one-word answer and stops if one is signed out or rejects its model name.

## Format

One folder per task, run in name order:

```
benchmark/tasks/<task-id>/
  task.md        The prompt, exactly as the writer receives it
  meta.json      The commit to start from, and notes for people
```

`meta.json`:

```json
{
  "baseCommit": "<sha the agent starts from>",
  "notes": "What a good solution reuses or avoids. Never shown to an agent."
}
```

Pin `baseCommit` to a real sha. Without it the task starts from `HEAD`, and results stop being comparable as the repo moves.

An agent can read anything in the commit it starts from. Pin tasks to a commit made before the tasks were added to the repo, as the seed tasks are, or keep the task folder outside the repo. Otherwise the notes are in plain sight.

## What makes a good task

- It has one clear outcome that tests can verify.
- It sits near existing code the change should reuse. That is where slop shows up.
- It is small enough for a person to review the result in a few minutes.
- It was not written to flatter the pipeline. Include tasks a raw agent probably does well.

## The seed tasks

The five tasks here run against NorthStar's own code at a fixed commit. They are a starting set for checking that the runner works and for a first look at the numbers. Five tasks on one repo are not evidence of anything general. The real benchmark needs 20 to 30 tasks across several repos, with a human solution for each.
