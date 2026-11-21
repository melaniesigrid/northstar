# Review cases

Small hand-built changes with a known right answer, for measuring a reviewer.

```bash
northstar calibrate --seeded
northstar calibrate --cases path/to/your/cases
```

Each case is built as a real repo with the change staged and reviewed exactly as a run would review it. The report says which seeded problems the reviewer caught, which it blocked for some other reason, which it missed, and which clean changes it wrongly blocked.

## Writing a case

One Markdown file per case. The file name is the case's id.

- A title on the first line.
- `- Expect: block` or `- Expect: approve`.
- For a block, `- Rule:` with the rule a reviewer should cite: reuse, simplicity, naming, comments, tests, scope, or performance.
- `## Task`: what the writer was asked to do. The reviewer sees this.
- `## Seeded problem`: what is wrong, for a block. The reviewer never sees this.
- `## Before` and `## After`: each file as a `###` heading with its path, followed by a fenced code block with the whole file. Files under "After" are written over the ones from "Before".

Three rules for a good case:

1. One problem per case. Two problems make a block impossible to read.
2. The plain checks must let it through. A change with five copied lines or an `any` cast is stopped before review in a real run, and the command skips such a case and says so.
3. Pair it with a clean version of the same task where you can. A reviewer that blocks both has learned nothing about the problem.

The best cases come from review comments your team has really made.
