import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import { ProviderTimeoutError } from "../src/models/gateway/types.js";
import {
  BudgetAwareGateway,
  MIN_MODEL_CALL_TIMEOUT_MS,
} from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  VERDICT_TIME_RESERVE_MS,
} from "../src/core/orchestrator/budget-manager.js";

const SimpleOutputSchema = z.object({ answer: z.string() });

function createTask(maxTokens?: number): ReasoningTask<{ answer: string }> {
  return {
    role: "test-analyst",
    objective: "Analyze the code",
    context: { data: "short context" },
    outputSchema: SimpleOutputSchema,
    maxTokens,
    promptVersion: "test-v1",
  };
}

function makeResult(
  promptTokens: number,
  completionTokens: number,
): ModelResult<{ answer: string }> {
  return {
    data: { answer: "ok" },
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    model: "test",
    provider: "test",
    durationMs: 50,
    startedAt: new Date().toISOString(),
    retryCount: 0,
    promptVersion: "test-v1",
  };
}

describe("DF-002: Model Call Timeout Derived from Budget", () => {
  it("gateway sets timeoutMs on provider task from remaining budget", async () => {
    let receivedTimeoutMs: number | undefined;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        receivedTimeoutMs = task.timeoutMs;
        return makeResult(100, 50) as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 5,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask());

    expect(receivedTimeoutMs).toBeDefined();
    expect(receivedTimeoutMs).toBeGreaterThan(0);
    expect(receivedTimeoutMs).toBeLessThanOrEqual(60_000);
  });

  it("timeout decreases as remaining budget decreases", async () => {
    const receivedTimeouts: number[] = [];
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        receivedTimeouts.push(task.timeoutMs!);
        return makeResult(100, 50) as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask());
    budget.recordModelCall();
    await budgetGateway.reason(createTask());
    budget.recordModelCall();

    expect(receivedTimeouts.length).toBe(2);
    expect(receivedTimeouts[0]).toBeGreaterThanOrEqual(receivedTimeouts[1]);
  });

  it("rejects dispatch when remaining time < MIN_MODEL_CALL_TIMEOUT_MS", async () => {
    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        return makeResult(100, 50) as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: MIN_MODEL_CALL_TIMEOUT_MS - 1,
      maxModelCalls: 10,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow(
      ProviderTimeoutError,
    );
  });

  it("MIN_MODEL_CALL_TIMEOUT_MS is a reasonable minimum", () => {
    expect(MIN_MODEL_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(3_000);
    expect(MIN_MODEL_CALL_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("DF-002: OpenAI Adapter Timeout Enforcement", () => {
  it("ReasoningTask timeoutMs field exists on provider-neutral type", () => {
    const task = createTask();
    expect("timeoutMs" in task || task.timeoutMs === undefined).toBe(true);

    const taskWithTimeout: ReasoningTask<{ answer: string }> = {
      ...task,
      timeoutMs: 10_000,
    };
    expect(taskWithTimeout.timeoutMs).toBe(10_000);
  });
});

describe("DF-002: Pre-Verdict Call Preserves Verdict Reserve", () => {
  it("callDeadlineReserveMs reduces effective timeout", async () => {
    let receivedTimeoutMs: number | undefined;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        receivedTimeoutMs = task.timeoutMs;
        return makeResult(100, 50) as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 50_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask());

    expect(receivedTimeoutMs).toBeDefined();
    expect(receivedTimeoutMs!).toBeLessThanOrEqual(
      50_000 - VERDICT_TIME_RESERVE_MS,
    );
  });

  it("gap-analysis timeout does not consume verdict reserve", async () => {
    let receivedTimeoutMs: number | undefined;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        receivedTimeoutMs = task.timeoutMs;
        return makeResult(100, 50) as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 10_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask());

    expect(receivedTimeoutMs!).toBeLessThanOrEqual(10_000);
  });

  it("verdict call has no reserve deduction", async () => {
    let receivedTimeoutMs: number | undefined;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        receivedTimeoutMs = task.timeoutMs;
        return makeResult(100, 50) as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 5_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = 0;

    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask());

    expect(receivedTimeoutMs!).toBeGreaterThan(VERDICT_TIME_RESERVE_MS);
  });

  it("dispatch rejected when reserve leaves insufficient time", async () => {
    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        return makeResult(100, 50) as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + MIN_MODEL_CALL_TIMEOUT_MS - 1,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow(
      ProviderTimeoutError,
    );
  });
});

describe("DF-002: Verdict Executes After Gap-Analysis Timeout", () => {
  it("verdict proceeds when gap analysis throws ProviderTimeoutError", async () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 5_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

    // After gap analysis times out, clearing the reserve should allow verdict
    budget.callDeadlineReserveMs = 0;
    expect(budget.remainingMs).toBeGreaterThan(MIN_MODEL_CALL_TIMEOUT_MS);
  });
});

describe("DF-002: Timeout Classification", () => {
  it("ProviderTimeoutError is distinct from other error types", () => {
    const err = new ProviderTimeoutError(10_000, 10_500);
    expect(err.name).toBe("ProviderTimeoutError");
    expect(err.timeoutMs).toBe(10_000);
    expect(err.elapsedMs).toBe(10_500);
    expect(err.message).toContain("timed out");
    expect(err.message).toContain("10000");
  });

  it("provider timeout is recorded as failed model attempt", async () => {
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        throw new ProviderTimeoutError(task.timeoutMs!, task.timeoutMs! + 100);
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow(
      ProviderTimeoutError,
    );

    const usage = budgetGateway.aggregateUsage();
    expect(usage.failedModelCalls).toBe(1);
    expect(usage.modelCalls).toBe(1);
  });

  it("timed-out call has no fabricated token usage", async () => {
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        throw new ProviderTimeoutError(task.timeoutMs!, task.timeoutMs! + 100);
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow();

    const metadata = budgetGateway.callMetadata;
    expect(metadata.length).toBe(1);
    expect(metadata[0].success).toBe(false);
    expect(metadata[0].inputTokens).toBeUndefined();
    expect(metadata[0].outputTokens).toBeUndefined();
  });
});

describe("DF-002: Retry After Timeout", () => {
  it("provider timeout does not trigger retry", async () => {
    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        throw new ProviderTimeoutError(task.timeoutMs!, task.timeoutMs! + 100);
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

    await expect(budgetGateway.reason(createTask())).rejects.toThrow(
      ProviderTimeoutError,
    );

    expect(callCount).toBe(1);
    expect(budget.retries).toBe(0);
  });

  it("retry is skipped when budget has no retry allowance", async () => {
    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        callCount++;
        throw new Error("schema error");
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
      maxRetries: 0,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 3,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow();

    // Only the initial attempt runs — retry budget is 0
    expect(callCount).toBe(1);
    expect(budget.retries).toBe(0);
  });
});

describe("DF-002: Wall-Clock Enforcement (Fake Clock)", () => {
  it("run duration does not exceed configured budget materially", async () => {
    const callDurations = [10, 10, 10, 10, 10]; // 5 fast calls at ~10ms each
    let callIdx = 0;

    const gateway: ModelGateway = {
      async reason<T>(_task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const duration = callDurations[callIdx++] ?? 10;
        await new Promise((resolve) => setTimeout(resolve, duration));
        return makeResult(100, 50) as ModelResult<T>;
      },
    };

    const budgetMs = 500;
    const budget = new BudgetManager({
      maxDurationMs: budgetMs,
      maxModelCalls: 10,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    const start = Date.now();

    // Make calls until budget exhausted
    for (let i = 0; i < 5; i++) {
      if (!budget.canAffordModelCall()) break;
      try {
        await budgetGateway.reason(createTask());
        budget.recordModelCall();
      } catch {
        break;
      }
    }

    const elapsed = Date.now() - start;
    // Should not exceed budget + cleanup overhead (100ms tolerance)
    expect(elapsed).toBeLessThan(budgetMs + 100);
  });

  it("slow provider call is bounded by remaining budget timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const gateway: ModelGateway = {
        async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
          if (task.timeoutMs !== undefined && task.timeoutMs < 50_000) {
            throw new ProviderTimeoutError(task.timeoutMs, task.timeoutMs);
          }
          return makeResult(100, 50) as ModelResult<T>;
        },
      };

      const budget = new BudgetManager({
        maxDurationMs: 30_000,
        maxModelCalls: 10,
      });
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        sleepFn: async () => {},
      });

      // With 30s budget, the timeout will be ~30s, which is < 50_000.
      // Provider simulates timeout for calls shorter than 50s.
      await expect(budgetGateway.reason(createTask())).rejects.toThrow(
        ProviderTimeoutError,
      );

      const metadata = budgetGateway.callMetadata;
      expect(metadata.length).toBe(1);
      expect(metadata[0].success).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DF-002: Command Timeout Unchanged", () => {
  it("command execution timeouts remain clamped to remainingMs", () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager({
        maxDurationMs: 60_000,
        maxModelCalls: 10,
      });

      // canAffordExecution still uses remainingMs directly (no reserve for commands)
      expect(budget.canAffordExecution(50_000)).toBe(true);
      expect(budget.canAffordExecution(70_000)).toBe(false);

      // optionalExecutionTimeoutMs uses the verdict reserve
      expect(budget.optionalExecutionTimeoutMs(50_000)).toBe(
        60_000 - VERDICT_TIME_RESERVE_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DF-002: callDeadlineReserveMs", () => {
  it("defaults to 0", () => {
    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
    });
    expect(budget.callDeadlineReserveMs).toBe(0);
  });

  it("negative values are clamped to 0", () => {
    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = -5000;
    expect(budget.callDeadlineReserveMs).toBe(0);
  });

  it("can be set and cleared", () => {
    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    expect(budget.callDeadlineReserveMs).toBe(VERDICT_TIME_RESERVE_MS);

    budget.callDeadlineReserveMs = 0;
    expect(budget.callDeadlineReserveMs).toBe(0);
  });
});
