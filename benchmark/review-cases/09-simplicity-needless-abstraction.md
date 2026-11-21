# Simplicity: a rule registry for one comparison

- Expect: block
- Rule: simplicity

## Task

Add `isAdult(user)` in `src/age.ts`: true when the user is 18 or older. Add a test.

## Seeded problem

One comparison is wrapped in an interface, a rule class, a registry and a factory. None of it has a second use, and a reader has to walk four types to find `age >= 18`.

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

interface AgeRule {
  readonly key: string;
  isSatisfiedBy(user: User): boolean;
}

class MinimumAgeRule implements AgeRule {
  constructor(
    readonly key: string,
    private readonly minimumAge: number,
  ) {}

  isSatisfiedBy(user: User): boolean {
    return user.age >= this.minimumAge;
  }
}

class AgeRuleRegistry {
  private readonly rules = new Map<string, AgeRule>();

  register(rule: AgeRule): this {
    this.rules.set(rule.key, rule);
    return this;
  }

  resolve(key: string): AgeRule {
    const rule = this.rules.get(key);
    if (!rule) throw new Error(`No age rule named ${key}`);
    return rule;
  }
}

function createDefaultRegistry(): AgeRuleRegistry {
  return new AgeRuleRegistry().register(new MinimumAgeRule("adult", 18));
}

export function isAdult(user: User): boolean {
  return createDefaultRegistry().resolve("adult").isSatisfiedBy(user);
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
