import { describe, it, expect } from "vitest";
import { createExecutionId } from "../src/logging/execution-id.js";

describe("execution ID generation", () => {
  it("returns a string", () => {
    const id = createExecutionId();
    expect(typeof id).toBe("string");
  });

  it("returns a valid UUID format", () => {
    const id = createExecutionId();
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(id).toMatch(uuidRegex);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createExecutionId()));
    expect(ids.size).toBe(100);
  });

  it("is non-empty", () => {
    const id = createExecutionId();
    expect(id.length).toBeGreaterThan(0);
  });
});
