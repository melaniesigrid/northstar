# Clean: the same task done with the existing helper

- Expect: approve

## Task

Add `invoiceHeader(invoice)` in `src/invoice.ts`. It returns one line with the invoice number, the day it was issued as YYYY-MM-DD, and the total. Add a test.

## Before

### src/format.ts

```ts
/** Formats a date as YYYY-MM-DD in UTC. */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
```

### src/format.test.ts

```ts
import { expect, it } from "vitest";
import { formatDate, formatMoney } from "./format.js";

it("formats a date as year, month and day", () => {
  expect(formatDate(new Date("2026-03-07T15:00:00Z"))).toBe("2026-03-07");
});

it("formats cents as dollars", () => {
  expect(formatMoney(1250)).toBe("$12.50");
});
```

## After

### src/invoice.ts

```ts
import { formatDate, formatMoney } from "./format.js";

export interface Invoice {
  number: string;
  issuedAt: Date;
  totalCents: number;
}

export function invoiceHeader(invoice: Invoice): string {
  return `Invoice ${invoice.number}, ${formatDate(invoice.issuedAt)}, ${formatMoney(invoice.totalCents)}`;
}
```

### src/invoice.test.ts

```ts
import { expect, it } from "vitest";
import { invoiceHeader } from "./invoice.js";

it("shows the number, the day and the total", () => {
  const invoice = { number: "A-17", issuedAt: new Date("2026-03-07T15:00:00Z"), totalCents: 1250 };

  expect(invoiceHeader(invoice)).toBe("Invoice A-17, 2026-03-07, $12.50");
});
```
