# Benchmark tasks

Seed tasks for measuring NorthStar against raw agents. Start with five hand-written tasks from real repos, each with a known good human solution.

One folder per task:

```
benchmark/tasks/<task-id>/
  task.md        The prompt, exactly as an agent receives it
  meta.json      Repo URL, base commit, and the commit of the human solution
```

`meta.json`:

```json
{
  "repo": "https://github.com/owner/repo",
  "baseCommit": "<sha the agent starts from>",
  "solutionCommit": "<sha of the human solution>",
  "notes": "What a good solution reuses or avoids"
}
```

A good benchmark task:

- Has one clear outcome that existing tests, or tests in the solution commit, can verify.
- Sits in a repo with existing helpers the change should reuse. This is where slop shows up.
- Is small enough for a human to review the result in a few minutes.
- Was not written to flatter the pipeline. Include tasks where a raw agent probably does fine.
