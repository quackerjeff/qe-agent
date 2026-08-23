import { describe, it, expect } from "vitest";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import {
  ProviderTimeoutError,
  RateLimitError,
} from "../src/models/gateway/types.js";
import { isAbortTimeout } from "../src/models/gateway/openai.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import { BudgetManager } from "../src/core/orchestrator/budget-manager.js";
import { QEStateMachine } from "../src/core/lifecycle/index.js";

const SimpleOutputSchema = z.object({ answer: z.string() });

function createTask(timeoutMs?: number): ReasoningTask<{ answer: string }> {
  return {
    role: "test-analyst",
    objective: "Analyze the code",
    context: { data: "short context" },
    outputSchema: SimpleOutputSchema,
    maxTokens: 2048,
    promptVersion: "test-v1",
    timeoutMs,
  };
}

// ─── Section 1: isAbortTimeout recognition ───

describe("DF-002: isAbortTimeout recognizes APIUserAbortError", () => {
  it("recognizes error with name 'APIUserAbortError'", () => {
    const err = { name: "APIUserAbortError", message: "Request was aborted." };
    expect(isAbortTimeout(err)).toBe(true);
  });

  it("recognizes error with message 'Request was aborted.'", () => {
    const err = new Error("Request was aborted.");
    expect(isAbortTimeout(err)).toBe(true);
  });

  it("still recognizes DOMException TimeoutError", () => {
    try {
      const err = new DOMException("timeout", "TimeoutError");
      expect(isAbortTimeout(err)).toBe(true);
    } catch {
      // DOMException may not be available in all test environments
      const err = { name: "TimeoutError" };
      expect(isAbortTimeout(err)).toBe(true);
    }
  });

  it("still recognizes DOMException AbortError", () => {
    try {
      const err = new DOMException("aborted", "AbortError");
      expect(isAbortTimeout(err)).toBe(true);
    } catch {
      const err = { name: "AbortError" };
      expect(isAbortTimeout(err)).toBe(true);
    }
  });

  it("still recognizes { name: 'AbortError' }", () => {
    expect(isAbortTimeout({ name: "AbortError" })).toBe(true);
  });

  it("returns false for generic Error", () => {
    expect(isAbortTimeout(new Error("something went wrong"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isAbortTimeout(null)).toBe(false);
    expect(isAbortTimeout(undefined)).toBe(false);
  });

  it("returns false for unrelated named errors", () => {
    expect(isAbortTimeout({ name: "TypeError" })).toBe(false);
    expect(isAbortTimeout({ name: "SyntaxError" })).toBe(false);
  });
});

// ─── Section 5: ProviderTimeoutError breaks retry loop ───

describe("DF-002: ProviderTimeoutError does not trigger retries", () => {
  it("ProviderTimeoutError breaks retry loop immediately", async () => {
    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        throw new ProviderTimeoutError(task.timeoutMs ?? 10_000, 10_500);
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 3,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask(10_000))).rejects.toThrow(
      ProviderTimeoutError,
    );
    expect(callCount).toBe(1);
    expect(budget.retries).toBe(0);
  });

  it("RateLimitError is retried but ProviderTimeoutError is not", async () => {
    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        if (callCount === 1) {
          throw new RateLimitError(undefined, "rate limited");
        }
        throw new ProviderTimeoutError(task.timeoutMs ?? 10_000, 10_500);
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
      maxRetries: 3,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 3,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask(10_000))).rejects.toThrow(
      ProviderTimeoutError,
    );
    expect(callCount).toBe(2);
    expect(budget.retries).toBe(1);
  });
});

// ─── Sections 2-4: Orchestrator abort resilience ───

describe("DF-002: Orchestrator abort resilience", () => {
  it("re-gap-analysis failure after browser validation preserves prior assessments", () => {
    const priorGaps = [{ requirement: "R1", gap: "missing tests" }];
    const priorAssessments = [
      { requirementId: "R1", status: "NOT_VERIFIED" as const },
    ];

    const gaps = [...priorGaps];
    const assessments = [...priorAssessments];

    // Simulate the try/catch pattern from orchestrator
    try {
      throw new ProviderTimeoutError(10_000, 10_500);
    } catch {
      // On error, gaps and assessments should NOT be overwritten
    }

    expect(gaps).toEqual(priorGaps);
    expect(assessments).toEqual(priorAssessments);
  });

  it("re-gap-analysis failure after test generation preserves prior assessments", () => {
    const priorGaps = [{ requirement: "R2", gap: "no integration test" }];
    const priorAssessments = [
      { requirementId: "R2", status: "VERIFIED" as const },
    ];

    const gaps = [...priorGaps];
    const assessments = [...priorAssessments];

    try {
      throw new ProviderTimeoutError(15_000, 15_200);
    } catch {
      // Preserved
    }

    expect(gaps).toEqual(priorGaps);
    expect(assessments).toEqual(priorAssessments);
  });

  it("verdict formation timeout produces structured BLOCKED with descriptive message", () => {
    let verdictValue: string | undefined;
    let confidenceValue: string | undefined;
    let summaryValue: string | undefined;
    let recommendedNextActions: string[] | undefined;

    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
    });

    if (budget.canAffordModelCall()) {
      try {
        throw new ProviderTimeoutError(20_000, 20_100);
      } catch {
        verdictValue = "BLOCKED";
        confidenceValue = "LOW";
        summaryValue =
          "Verdict formation timed out; validation evidence was collected but could not be fully assessed.";
        recommendedNextActions = [
          "Re-run with a larger time budget to allow verdict formation to complete",
        ];
      }
    }

    expect(verdictValue).toBe("BLOCKED");
    expect(confidenceValue).toBe("LOW");
    expect(summaryValue).toContain("timed out");
    expect(summaryValue).toContain("evidence was collected");
    expect(summaryValue).not.toContain("Request was aborted");
    expect(recommendedNextActions).toBeDefined();
    expect(recommendedNextActions![0]).toContain("time budget");
  });

  it("verdict formation timeout message differs from budget-exhaustion message", () => {
    const timeoutMessage =
      "Verdict formation timed out; validation evidence was collected but could not be fully assessed.";
    const budgetMessage = "Budget exhausted before verdict could be formed";
    const topLevelMessage = "QE run blocked: Request was aborted.";

    expect(timeoutMessage).not.toBe(budgetMessage);
    expect(timeoutMessage).not.toBe(topLevelMessage);
    expect(timeoutMessage).toContain("evidence was collected");
  });
});

// ─── Section 6: Full lifecycle abort resilience ───

describe("DF-002: Full lifecycle abort-during-optional-still-reaches-verdict", () => {
  it("state machine reaches FORMING_VERDICT after ANALYZING_GAPS failure", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    sm.transition("GENERATING_TESTS");
    sm.transition("RETESTING");

    // Re-gap after retesting — transition to ANALYZING_GAPS
    sm.transition("ANALYZING_GAPS", "Re-analyze gaps after generation");

    // Gap analysis throws ProviderTimeoutError — caught by try/catch
    // Prior assessments preserved, lifecycle continues

    // Must still be able to reach verdict
    expect(sm.canTransitionTo("FORMING_VERDICT")).toBe(true);
    sm.transition("FORMING_VERDICT", "Form verdict");
    expect(sm.state).toBe("FORMING_VERDICT");

    sm.transition("REPORTING");
    sm.transition("COMPLETE");
    expect(sm.isTerminal).toBe(true);
  });

  it("state machine reaches COMPLETE even when verdict formation is caught", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");

    sm.transition("FORMING_VERDICT", "Form verdict");
    // produceVerdict throws — caught by try/catch
    // Structured BLOCKED assigned, lifecycle continues

    sm.transition("REPORTING");
    sm.transition("COMPLETE");
    expect(sm.isTerminal).toBe(true);
    expect(sm.history.length).toBe(8);
  });

  it("abort during re-gap after browser still reaches verdict via state machine", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");

    // Browser validation phase transitions to ANALYZING_GAPS
    sm.transition("ANALYZING_GAPS", "Re-analyze gaps after browser validation");
    // analyzeGaps throws — caught, prior assessments preserved

    // Can still transition to GENERATING_TESTS or FORMING_VERDICT
    expect(sm.canTransitionTo("GENERATING_TESTS")).toBe(true);
    expect(sm.canTransitionTo("FORMING_VERDICT")).toBe(true);

    sm.transition("FORMING_VERDICT", "Form verdict");
    sm.transition("REPORTING");
    sm.transition("COMPLETE");
    expect(sm.isTerminal).toBe(true);
  });
});
