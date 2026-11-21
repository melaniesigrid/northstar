# Reuse: an email check written inline

- Expect: block
- Rule: reuse

## Task

Add `subscribe(email, list)` in `src/newsletter.ts`. It adds the address to the list and returns true, or returns false for an address that is not valid or already there. Add tests.

## Seeded problem

`src/validate.ts` already exports `isEmail`. The change tests the address with its own looser pattern, so the two can now disagree about what a valid address is.

## Before

### src/validate.ts

```ts
/** True for a string shaped like an email address. */
export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}
```

### src/validate.test.ts

```ts
import { expect, it } from "vitest";
import { isEmail } from "./validate.js";

it("accepts an address and rejects a bare word", () => {
  expect(isEmail("ana@example.com")).toBe(true);
  expect(isEmail("ana")).toBe(false);
});
```

## After

### src/newsletter.ts

```ts
export function subscribe(email: string, list: Set<string>): boolean {
  const looksValid = email.includes("@") && email.split("@")[1]?.includes(".") === true;
  if (!looksValid || list.has(email)) return false;
  list.add(email);
  return true;
}
```

### src/newsletter.test.ts

```ts
import { expect, it } from "vitest";
import { subscribe } from "./newsletter.js";

it("adds a new address once", () => {
  const list = new Set<string>();

  expect(subscribe("ana@example.com", list)).toBe(true);
  expect(subscribe("ana@example.com", list)).toBe(false);
  expect([...list]).toEqual(["ana@example.com"]);
});

it("refuses a word that is not an address", () => {
  expect(subscribe("ana", new Set())).toBe(false);
});
```
