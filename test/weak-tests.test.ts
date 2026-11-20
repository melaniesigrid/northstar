import { describe, expect, it } from "vitest";
import { findWeakTests } from "../src/weak-tests.js";
import { snapshotWithAdded } from "./helpers.js";

function weakTestNames(file: string, ...lines: string[]): string[] {
  return findWeakTests(snapshotWithAdded({ [file]: lines.join("\n") }, file)).map((test) => test.name);
}

describe("findWeakTests", () => {
  it("flags a test that runs code and checks nothing", () => {
    const snapshot = snapshotWithAdded(
      { "src/cart.test.ts": ['describe("cart", () => {', '  it("adds an item", () => {', "    addItem(cart, item);", "  });", "});"].join("\n") },
      "src/cart.test.ts",
    );

    expect(findWeakTests(snapshot)).toEqual([
      { file: "src/cart.test.ts", line: 2, name: "adds an item", weakness: "no assertion" },
    ]);
  });

  it.each([
    ["an expect call", ['it("works", () => {', "  expect(total(cart)).toBe(3);", "});"]],
    ["a one-line test", ['test("works", () => expect(total(cart)).toBe(3));']],
    ["an assert call", ['it("works", () => {', "  assert.equal(total(cart), 3);", "});"]],
    ["a helper named like an assertion", ['it("works", () => {', "  expectCleanCart(cart);", "});"]],
    ["a table test", ['it.each([1, 2])("handles %s", (count) => {', "  expect(double(count)).toBeGreaterThan(count);", "});"]],
  ])("accepts a test with %s", (_label, lines) => {
    expect(weakTestNames("src/cart.test.ts", ...lines)).toEqual([]);
  });

  it.each([
    ["only that a value is defined", ['it("builds a cart", () => {', "  expect(buildCart()).toBeDefined();", "});"]],
    ["only that nothing threw", ['it("renders", () => {', "  expect(() => render(cart)).not.toThrow();", "});"]],
    ["only truthiness in Python", ["def test_builds_cart():", "    cart = build_cart()", "    assert cart"]],
  ])("flags a test that checks %s", (_label, lines) => {
    const file = lines[0]?.startsWith("def") ? "tests/test_cart.py" : "src/cart.test.ts";
    const [weakTest] = findWeakTests(snapshotWithAdded({ [file]: lines.join("\n") }, file));

    expect(weakTest?.weakness).toBe("only checks that a value exists");
  });

  it("accepts a test that checks existence and then a real value", () => {
    const names = weakTestNames(
      "src/cart.test.ts",
      'it("builds a cart", () => {',
      "  expect(cart).toBeDefined();",
      "  expect(cart.items).toEqual([]);",
      "});",
    );

    expect(names).toEqual([]);
  });

  it("does not let an assertion in the next test cover for an empty one", () => {
    const names = weakTestNames(
      "src/cart.test.ts",
      'it("first", () => {',
      "  addItem(cart, item);",
      "});",
      'it("second", () => {',
      "  expect(total(cart)).toBe(3);",
      "});",
    );

    expect(names).toEqual(["first"]);
  });

  it("skips tests that are marked as not run", () => {
    expect(weakTestNames("src/cart.test.ts", 'it.todo("handles refunds");', 'it.skip("old flow", () => {', "  run();", "});")).toEqual([]);
  });

  it("handles Python tests", () => {
    const names = weakTestNames(
      "tests/test_cart.py",
      "def test_adds_item():",
      "    add_item(cart, item)",
      "",
      "def test_total():",
      "    assert total(cart) == 3",
    );

    expect(names).toEqual(["test_adds_item"]);
  });

  it("only looks at test files, and only at tests the change added", () => {
    const files = { "src/cart.ts": 'test("not a test file", () => {});', "src/old.test.ts": 'it("old and empty", () => {});' };

    expect(findWeakTests(snapshotWithAdded(files, "src/cart.ts"))).toEqual([]);
  });
});
