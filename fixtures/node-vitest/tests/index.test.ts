import { test, expect } from "vitest";
import { greet } from "../src/index.js";

test("greet returns greeting", () => {
  expect(greet("World")).toBe("Hello, World!");
});
