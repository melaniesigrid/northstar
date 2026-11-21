# Conventions and reuse

Before the writer starts, NorthStar finds out how the repo is written and which existing code looks relevant. The planner and the reviewer get the full conventions, so plans, naming, and reuse are judged against the repo and not against a model's habits.

The writer gets less on purpose: your hand-written rules and the relevant helpers, not the scanned overview. A 2026 study found that broad context files lowered task success and raised cost by more than 20%, while short, specific, human-written instructions helped. Set `"writerConventions": "all"` to give the writer everything.

## Convention profile

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

## Reuse search

NorthStar indexes every top-level declaration outside test files and gives the writer up to 12 whose names share words with the task:

```
Existing helpers that look relevant. Reuse them instead of writing new ones:
- formatDueDate (src/dates.ts:10)
- mean (src/features/causal.ts:55, not exported yet)
```

A helper private to its file is listed too, marked as not exported, because exporting it beats copying it. The match is on keywords, so it finds `slugify` for "slugify the title" and misses `sd` for "standard deviation". The duplication gate is the backstop for what it misses.

## No AI credits

Work that goes through NorthStar reads as written by your team. The writer is told to leave no tool signatures, and the AI credit gate blocks any added line that credits an AI tool, in code, comments, or documentation. The commit NorthStar makes carries the task as its message and nothing else.
