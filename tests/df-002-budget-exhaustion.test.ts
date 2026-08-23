import { describe, it, expect } from "vitest";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import { SchemaValidationError } from "../src/models/gateway/types.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
  VERDICT_TIME_RESERVE_MS,
  MIN_OPTIONAL_MODEL_CALL_MS,
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

class ConfigurableGateway implements ModelGateway {
  public calls: ReasoningTask<unknown>[] = [];
  private callIndex = 0;

  constructor(
    private readonly handler: (
      task: ReasoningTask<unknown>,
      callIndex: number,
    ) => ModelResult<unknown> | Error,
  ) {}

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    this.calls.push(task as ReasoningTask<unknown>);
    const idx = this.callIndex++;
    const result = this.handler(task as ReasoningTask<unknown>, idx);
    if (result instanceof Error) throw result;
    return result as ModelResult<T>;
  }
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

describe("DF-002: Logical vs Retry Budget Separation", () => {
  it("retry does not consume an extra logical model-call slot", async () => {
    const gateway = new ConfigurableGateway((_task, idx) => {
      if (idx === 0) {
        return new SchemaValidationError(
          '{"wrong": true}',
          "answer: Required",
          { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
        );
      }
      return makeResult(500, 300);
    });

    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask(2048));

    expect(budget.modelCalls).toBe(0);
    expect(budget.retries).toBe(1);
  });

  it("provider attempt telemetry still counts retry attempts", async () => {
    const gateway = new ConfigurableGateway((_task, idx) => {
      if (idx === 0) {
        return new SchemaValidationError(
          '{"wrong": true}',
          "answer: Required",
          { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
        );
      }
      return makeResult(500, 300);
    });

    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask(2048));

    const usage = budgetGateway.aggregateUsage();
    expect(usage.modelCalls).toBe(2);
    expect(usage.failedModelCalls).toBe(1);
    expect(usage.successfulModelCalls).toBe(1);
  });

  it("retry budget remains enforced independently", async () => {
    let callCount = 0;
    const gateway = new ConfigurableGateway(() => {
      callCount++;
      return new SchemaValidationError('{"wrong": true}', "answer: Required", {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
    });

    const budgetConfig = createBudgetForProfile("quick");
    expect(budgetConfig.maxRetries).toBe(1);

    const budget = new BudgetManager(budgetConfig);
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 3,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow();

    expect(budget.retries).toBe(1);
    expect(budget.modelCalls).toBe(0);
    expect(callCount).toBe(2);
  });

  it("quick profile can reach verdict with one retry", async () => {
    const gateway = new ConfigurableGateway((_task, idx) => {
      if (idx === 2) {
        return new SchemaValidationError(
          '{"wrong": true}',
          "answer: Required",
          { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
        );
      }
      return makeResult(500, 300);
    });

    const budget = new BudgetManager(createBudgetForProfile("quick"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    // risk assessment
    await budgetGateway.reason(createTask());
    budget.recordModelCall();
    // validation planning
    await budgetGateway.reason(createTask());
    budget.recordModelCall();
    // gap analysis (fails once, retried)
    await budgetGateway.reason(createTask());
    budget.recordModelCall();
    // verdict — must still be affordable
    expect(budget.canAffordModelCall()).toBe(true);
    await budgetGateway.reason(createTask());
    budget.recordModelCall();

    expect(budget.modelCalls).toBe(4);
    expect(budget.retries).toBe(1);
    const usage = budgetGateway.aggregateUsage();
    expect(usage.modelCalls).toBe(5);
    expect(usage.failedModelCalls).toBe(1);
  });
});

describe("DF-002: Verdict Budget Reservation", () => {
  it("canAffordOptionalModelCall reserves capacity for verdict", () => {
    const budget = new BudgetManager({
      maxDurationMs: 600_000,
      maxModelCalls: 5,
    });

    budget.recordModelCall();
    budget.recordModelCall();
    budget.recordModelCall();

    expect(budget.canAffordModelCall()).toBe(true);
    expect(budget.canAffordOptionalModelCall()).toBe(true);

    budget.recordModelCall();

    expect(budget.canAffordModelCall()).toBe(true);
    expect(budget.canAffordOptionalModelCall()).toBe(false);
  });

  it("canAffordOptionalModelCall checks time reserve plus optional headroom", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS + 100,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalModelCall()).toBe(true);

    const tightBudget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS - 1,
      maxModelCalls: 100,
    });

    expect(tightBudget.canAffordOptionalModelCall()).toBe(false);
  });

  it("optional stage is skipped when time reserve is insufficient", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS - 1,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalModelCall()).toBe(false);
    expect(budget.canAffordModelCall()).toBe(true);
  });

  it("skipped optional stage does not prevent verdict", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 1,
      maxModelCalls: 5,
    });

    budget.recordModelCall();
    budget.recordModelCall();
    budget.recordModelCall();
    budget.recordModelCall();

    expect(budget.canAffordOptionalModelCall()).toBe(false);
    expect(budget.canAffordModelCall()).toBe(true);
  });

  it("VERDICT_TIME_RESERVE_MS is a conservative value", () => {
    expect(VERDICT_TIME_RESERVE_MS).toBeGreaterThanOrEqual(15_000);
    expect(VERDICT_TIME_RESERVE_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("DF-002: Quick Profile Config Semantics", () => {
  it("quick profile uses its own default when config omits maxModelCalls", () => {
    const budget = createBudgetForProfile("quick");
    expect(budget.maxModelCalls).toBe(6);
  });

  it("quick profile uses explicit config override when provided", () => {
    const budget = createBudgetForProfile("quick", 10);
    expect(budget.maxModelCalls).toBe(10);
  });

  it("standard profile uses its own default when config omits maxModelCalls", () => {
    const budget = createBudgetForProfile("standard");
    expect(budget.maxModelCalls).toBe(12);
  });

  it("standard profile uses explicit config override when provided", () => {
    const budget = createBudgetForProfile("standard", 20);
    expect(budget.maxModelCalls).toBe(20);
  });

  it("undefined config does not override profile default", () => {
    const budget = createBudgetForProfile("quick", undefined);
    expect(budget.maxModelCalls).toBe(6);
  });

  it("quick profile mandatory path fits within default budget", () => {
    const budget = createBudgetForProfile("quick");
    const mandatoryStages = 4; // risk + planning + gap + verdict
    expect(budget.maxModelCalls).toBeGreaterThanOrEqual(mandatoryStages);
  });
});
