# Performance: one query per row

- Expect: block
- Rule: performance

## Task

Add `orderReport()` in `src/report.ts`. It returns one line per order with the order id and the name of the user who placed it, or "unknown" when the user is gone. Add a test.

## Seeded problem

The loop awaits `findUser` once per order, so a thousand orders cost a thousand queries. `src/db.ts` exports `findUsers`, which loads them in one.

## Before

### src/db.ts

```ts
export interface User {
  id: string;
  name: string;
}

export interface Order {
  id: string;
  userId: string;
}

export declare function listOrders(): Promise<Order[]>;

export declare function findUser(id: string): Promise<User | undefined>;

/** Loads many users with one query. */
export declare function findUsers(ids: string[]): Promise<User[]>;
```

## After

### src/report.ts

```ts
import { findUser, listOrders } from "./db.js";

export async function orderReport(): Promise<string[]> {
  const lines: string[] = [];
  for (const order of await listOrders()) {
    const user = await findUser(order.userId);
    lines.push(`${order.id}: ${user?.name ?? "unknown"}`);
  }
  return lines;
}
```

### src/report.test.ts

```ts
import { expect, it, vi } from "vitest";
import { orderReport } from "./report.js";

vi.mock("./db.js", () => ({
  listOrders: async () => [
    { id: "o1", userId: "u1" },
    { id: "o2", userId: "gone" },
  ],
  findUser: async (id: string) => (id === "u1" ? { id, name: "Ana" } : undefined),
}));

it("names the user of each order and says so when the user is gone", async () => {
  expect(await orderReport()).toEqual(["o1: Ana", "o2: unknown"]);
});
```
