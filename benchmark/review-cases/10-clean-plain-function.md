# Clean: the same task as one plain function

- Expect: approve

## Task

Add `isAdult(user)` in `src/age.ts`: true when the user is 18 or older. Add a test.

## Before

### src/user.ts

```ts
export interface User {
  name: string;
  age: number;
}
```

## After

### src/age.ts

```ts
import type { User } from "./user.js";

const ADULT_AGE = 18;

export function isAdult(user: User): boolean {
  return user.age >= ADULT_AGE;
}
```

### src/age.test.ts

```ts
import { expect, it } from "vitest";
import { isAdult } from "./age.js";

it("draws the line at 18", () => {
  expect(isAdult({ name: "Ana", age: 17 })).toBe(false);
  expect(isAdult({ name: "Ana", age: 18 })).toBe(true);
});
```
