# The checks, in detail

These checks run on every change before any configured gate. They need no setup and no extra dependencies, and they only ever look at lines the change added. Code that was already in the repo is never held against a change.

| Check | Catches | Outcome |
| --- | --- | --- |
| Duplication | Copy-pasted code | Blocks the change |
| Suppressions | New `as any`, `@ts-ignore`, `eslint-disable` and similar | Blocks past `maxNewSuppressions` |
| AI credits | Lines crediting an AI tool, in code or docs | Blocks the change |
| Repeated data | Copied lists of literals and field mappings | Passed to the reviewer to verify |
| Weak tests | New tests with no assertion, or that only check a value exists | Passed to the reviewer to verify |
| Unreferenced symbols | New top-level names nothing else uses | Passed to the reviewer to verify |
| Complexity | Functions the change pushed past a cognitive complexity of 15 | Passed to the reviewer to verify |

The split is deliberate. A check blocks only where replaying real commit history showed its findings were deserved. Signals that are often fine in practice go to the reviewer, who can read the repo and decide.

## Duplication

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

## Suppressions

Silencing a check is the cheapest way for an agent to make a gate pass. This check counts the escape hatches a change adds and blocks it when the count is over `maxNewSuppressions` (default 0):

- Comment directives: `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `# type: ignore`, `# noqa`, `nolint`, `rubocop:disable`
- TypeScript escapes: `as any`, `: any`, and `any` as a type argument

Text inside string literals and prose inside comments is ignored, so an error message that says "Expected: any of..." does not count.

## Weak tests

A test with no assertion runs the code and passes whatever the code does. A test that only checks a value is defined, or that nothing threw, is barely better. This check finds both in the tests a change adds, in JavaScript, TypeScript, and Python, and sends them to the reviewer with the reason.

It does not block on its own, because a test can delegate its checks to a helper the check does not recognize. Skipped tests and `todo` placeholders are ignored.

## Complexity

NorthStar estimates the cognitive complexity of each function a change touches in JavaScript and TypeScript files. Cognitive complexity counts what a reader has to hold in their head: every branch or loop costs one plus its nesting depth, an `else` costs one, and each run of `&&` or `||` costs one. Most linters ship this rule with a limit of 15.

A function is pointed out to the reviewer when it scores over 15 and the change is the reason: the change took it over the limit, or added 5 or more of the points. A two-line fix inside a function that was already complex is left alone.

Named inner functions, such as an event handler declared inside a React component, are scored on their own. Anonymous callbacks count toward the function around them, one nesting level deeper. Test files are skipped.

This is a signal and never blocks by itself. The score is an estimate read from braces and keywords, not from a parser, and a long but flat component can be perfectly readable. On 74 replayed commits it pointed at functions in 10.

## Unreferenced symbols

For each new top-level function, constant, class, or type, the check looks for the name anywhere else in the repo. A name that appears only at its own declaration is likely dead code, but it could also be a public API or something a framework finds by convention. So this check never blocks on its own. It gives the reviewer the list and asks for a blocking finding only where the symbol is truly unused.

Default exports, `main`, and test functions are skipped.
