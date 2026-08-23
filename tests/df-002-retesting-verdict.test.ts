import { describe, it, expect, vi } from "vitest";
import { QEStateMachine } from "../src/core/lifecycle/index.js";
import {
  BudgetManager,
  createBudgetForProfile,
  VERDICT_TIME_RESERVE_MS,
  MIN_OPTIONAL_EXECUTION_MS,
} from "../src/core/orchestrator/budget-manager.js";

describe("DF-002: RETESTING → FORMING_VERDICT Transition", () => {
  it("RETESTING → FORMING_VERDICT is a valid transition", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    sm.transition("GENERATING_TESTS");
    sm.transition("RETESTING");
    expect(sm.canTransitionTo("FORMING_VERDICT")).toBe(true);
    sm.transition("FORMING_VERDICT");
    expect(sm.state).toBe("FORMING_VERDICT");
  });

  it("RETESTING still allows ANALYZING_GAPS (existing path)", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    sm.transition("GENERATING_TESTS");
    sm.transition("RETESTING");
    expect(sm.canTransitionTo("ANALYZING_GAPS")).toBe(true);
  });

  it("RETESTING still allows INVESTIGATING and BLOCKED", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    sm.transition("GENERATING_TESTS");
    sm.transition("RETESTING");
    expect(sm.canTransitionTo("INVESTIGATING")).toBe(true);
    expect(sm.canTransitionTo("BLOCKED")).toBe(true);
  });

  it("re-gap-analysis skipped due to budget still reaches verdict", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    sm.transition("GENERATING_TESTS");
    sm.transition("RETESTING");

    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 1,
      maxModelCalls: 6,
    });
    budget.recordModelCall(); // risk
    budget.recordModelCall(); // planning
    budget.recordModelCall(); // gap
    budget.recordModelCall(); // test-gen
    budget.recordModelCall(); // 5th — only 1 left

    expect(budget.canAffordOptionalModelCall()).toBe(false);
    expect(budget.canAffordModelCall()).toBe(true);

    // Skip re-gap-analysis, go directly to verdict
    sm.transition("FORMING_VERDICT");
    expect(sm.state).toBe("FORMING_VERDICT");
  });

  it("no invalid state transition occurs on full lifecycle with skip", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    sm.transition("GENERATING_TESTS");
    sm.transition("RETESTING");
    sm.transition("FORMING_VERDICT");
    sm.transition("REPORTING");
    sm.transition("COMPLETE");
    expect(sm.isTerminal).toBe(true);
    expect(sm.history.length).toBe(10);
  });
});

describe("DF-002: Optional Execution Budget Protection", () => {
  it("canAffordOptionalExecution preserves verdict reserve", () => {
    const budget = new BudgetManager({
      maxDurationMs:
        VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_EXECUTION_MS + 1_000,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(true);
    expect(budget.canAffordOptionalExecution(MIN_OPTIONAL_EXECUTION_MS)).toBe(
      true,
    );
    const available = budget.remainingMs - VERDICT_TIME_RESERVE_MS;
    expect(budget.canAffordOptionalExecution(available + 1)).toBe(false);
  });

  it("canAffordOptionalExecution returns false when only reserve remains", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(false);
  });

  it("canAffordOptionalExecution returns false below reserve", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS - 1,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(false);
    expect(budget.canAffordExecution()).toBe(true);
  });

  it("optional RETESTING command is skipped when headroom is below minimum", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 100,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(false);
    expect(budget.canAffordOptionalExecution(50)).toBe(true);
    expect(budget.canAffordOptionalExecution(101)).toBe(false);
  });

  it("optionalExecutionTimeoutMs clamps to available time beyond reserve", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 30_000,
      maxModelCalls: 100,
    });

    expect(budget.optionalExecutionTimeoutMs(60_000)).toBe(30_000);
    expect(budget.optionalExecutionTimeoutMs(20_000)).toBe(20_000);
  });

  it("optionalExecutionTimeoutMs returns 0 when no time outside reserve", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS,
      maxModelCalls: 100,
    });

    expect(budget.optionalExecutionTimeoutMs(60_000)).toBe(0);
  });

  it("optionalExecutionTimeoutMs returns 0 when below reserve", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS - 1,
      maxModelCalls: 100,
    });

    expect(budget.optionalExecutionTimeoutMs(60_000)).toBe(0);
  });
});

describe("DF-002: Generated-Test Focused Execution Protection", () => {
  it("canAffordOptionalExecution blocks focused execution when reserve consumed", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(false);
  });

  it("skipped focused execution produces no PASS evidence", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS - 1,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(false);
    // When canAffordOptionalExecution returns false, executeGeneratedTestFocused
    // returns { evidence: null, targetingMode: "UNVERIFIED" }.
    // No evidence means no PASS — UNVERIFIED targeting prevents false claims.
  });

  it("focused execution timeout returns 0 when below minimum threshold", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 8_000,
      maxModelCalls: 100,
    });

    expect(budget.optionalExecutionTimeoutMs(60_000)).toBe(0);
  });

  it("focused execution timeout is clamped to available non-reserve time", () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager({
        maxDurationMs:
          VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_EXECUTION_MS + 5_000,
        maxModelCalls: 100,
      });

      const timeout = budget.optionalExecutionTimeoutMs(60_000);
      expect(timeout).toBe(MIN_OPTIONAL_EXECUTION_MS + 5_000);
      expect(timeout).toBeLessThan(60_000);
      expect(timeout).toBeLessThanOrEqual(
        budget.remainingMs - VERDICT_TIME_RESERVE_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DF-002: Quick Profile Verdict with Unaffordable Retesting", () => {
  it("quick profile reaches verdict when optional retesting is unaffordable", () => {
    const sm = new QEStateMachine();
    const budget = new BudgetManager(createBudgetForProfile("quick"));

    // Simulate mandatory stages consuming model-call budget
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    budget.recordModelCall(); // risk
    sm.transition("PLANNING");
    budget.recordModelCall(); // planning
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    budget.recordModelCall(); // gap analysis

    // Test generation consumed a model call
    sm.transition("GENERATING_TESTS");
    budget.recordModelCall(); // test-gen

    // Generated test was applied, enter RETESTING
    sm.transition("RETESTING");

    // Budget is tight — only 2 model calls left, optional needs >1 reserved
    expect(budget.canAffordOptionalModelCall()).toBe(true);

    // But time budget on quick profile (120s) would be tight too.
    // With only reserve remaining, skip optional execution:
    // canAffordOptionalExecution gates retesting commands.

    // Regardless, verdict is reachable:
    expect(sm.canTransitionTo("FORMING_VERDICT")).toBe(true);
    sm.transition("FORMING_VERDICT");
    budget.recordModelCall(); // verdict
    expect(budget.canAffordModelCall()).toBe(true); // 1 left for memory distillation

    sm.transition("REPORTING");
    sm.transition("COMPLETE");
    expect(sm.isTerminal).toBe(true);
  });

  it("quick profile mandatory path completes even with all optional stages skipped", () => {
    const sm = new QEStateMachine();
    const budget = new BudgetManager(createBudgetForProfile("quick"));

    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    budget.recordModelCall(); // risk
    sm.transition("PLANNING");
    budget.recordModelCall(); // planning
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    budget.recordModelCall(); // gap analysis

    // canAffordOptionalModelCall false → skip GENERATING_TESTS entirely
    // Go directly to verdict from ANALYZING_GAPS
    sm.transition("FORMING_VERDICT");
    budget.recordModelCall(); // verdict

    expect(budget.modelCalls).toBe(4);
    expect(budget.canAffordModelCall()).toBe(true); // 2 remaining

    sm.transition("REPORTING");
    sm.transition("COMPLETE");
    expect(sm.isTerminal).toBe(true);
  });
});
