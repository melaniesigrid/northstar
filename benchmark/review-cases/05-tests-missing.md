# Tests: new branching logic with no test

- Expect: block
- Rule: tests

## Task

Add `shippingCost(totalInCents, express)` in `src/shipping.ts`: express is always $15, standard is free from $50 and $5 below that. Add tests.

## Seeded problem

The task asks for tests and the repo tests its other functions. The change adds three branches and no test.

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

### src/shipping.ts

```ts
const EXPRESS_CENTS = 1500;
const STANDARD_CENTS = 500;
const FREE_FROM_CENTS = 5000;

export function shippingCost(totalInCents: number, express: boolean): number {
  if (express) return EXPRESS_CENTS;
  return totalInCents >= FREE_FROM_CENTS ? 0 : STANDARD_CENTS;
}
```
