# Tests: a test that passes whether or not the code works

- Expect: block
- Rule: tests

## Task

Add `applyDiscount(totalInCents, percent)` to `src/cart.ts`. It takes the percentage off and rounds to whole cents. Add a test.

## Seeded problem

The only new test uses a discount of zero. It would still pass if `applyDiscount` returned its input untouched, so the discount itself is not tested.

## Before

### src/cart.ts

```ts
export function total(pricesInCents: number[]): number {
  return pricesInCents.reduce((sum, price) => sum + price, 0);
}
```

### src/cart.test.ts

```ts
import { expect, it } from "vitest";
import { total } from "./cart.js";

it("adds up the prices", () => {
  expect(total([250, 1000])).toBe(1250);
});
```

## After

### src/cart.ts

```ts
export function total(pricesInCents: number[]): number {
  return pricesInCents.reduce((sum, price) => sum + price, 0);
}

export function applyDiscount(totalInCents: number, percent: number): number {
  return Math.round(totalInCents * (1 - percent / 100));
}
```

### src/cart.test.ts

```ts
import { expect, it } from "vitest";
import { applyDiscount, total } from "./cart.js";

it("adds up the prices", () => {
  expect(total([250, 1000])).toBe(1250);
});

it("applies a discount", () => {
  expect(applyDiscount(1250, 0)).toBe(1250);
});
```
