import { describe, it, expect } from "vitest";
import {
  QELifecycleState,
  TERMINAL_STATES,
} from "../src/core/lifecycle/states.js";

describe("QE lifecycle states", () => {
  const expectedStates = [
    "INITIALIZING",
    "DISCOVERING",
    "UNDERSTANDING_CHANGE",
    "ASSESSING_RISK",
    "PLANNING",
    "EXECUTING",
    "INVESTIGATING",
    "GENERATING_TESTS",
    "RETESTING",
    "ANALYZING_GAPS",
    "BROWSER_VALIDATING",
    "FORMING_VERDICT",
    "REPORTING",
    "COMPLETE",
    "BLOCKED",
  ] as const;

  it("defines all required states", () => {
    for (const state of expectedStates) {
      const result = QELifecycleState.safeParse(state);
      expect(result.success).toBe(true);
    }
  });

  it("has exactly the specified number of states", () => {
    expect(QELifecycleState.options).toHaveLength(expectedStates.length);
  });

  it("rejects invalid states", () => {
    const result = QELifecycleState.safeParse("RUNNING");
    expect(result.success).toBe(false);
  });

  it("identifies COMPLETE as terminal", () => {
    expect(TERMINAL_STATES.has("COMPLETE")).toBe(true);
  });

  it("identifies BLOCKED as terminal", () => {
    expect(TERMINAL_STATES.has("BLOCKED")).toBe(true);
  });

  it("does not mark active states as terminal", () => {
    expect(TERMINAL_STATES.has("EXECUTING")).toBe(false);
    expect(TERMINAL_STATES.has("PLANNING")).toBe(false);
  });
});
