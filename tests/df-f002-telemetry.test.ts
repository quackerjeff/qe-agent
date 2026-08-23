import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SchemaValidationError } from "../src/models/gateway/types.js";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
} from "../src/core/orchestrator/budget-manager.js";
import { AIUsageTelemetrySchema } from "../src/types/index.js";

const SimpleOutputSchema = z.object({ answer: z.string() });

function createTask(): ReasoningTask<{ answer: string }> {
  return {
    role: "test-analyst",
    objective: "Analyze",
    context: { data: "test" },
    outputSchema: SimpleOutputSchema,
    maxTokens: 1024,
    promptVersion: "test-v1",
  };
}

class SchemaFailingGateway implements ModelGateway {
  public calls: ReasoningTask<unknown>[] = [];
  private callCount = 0;

  constructor(
    private failCount: number,
    private usage?: {
      promptTokens: number;
      completionTokens: number;
      cachedTokens?: number;
      totalTokens: number;
    },
  ) {}

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    this.calls.push(task as ReasoningTask<unknown>);
    this.callCount++;

    if (this.callCount <= this.failCount) {
      throw new SchemaValidationError(
        '{"wrong": "shape"}',
        "answer: Required",
        this.usage,
      );
    }

    const data = task.outputSchema.parse({ answer: "ok" });
    const prompt = this.usage?.promptTokens ?? 0;
    const completion = this.usage?.completionTokens ?? 0;

    return {
      data,
      usage: {
        promptTokens: prompt,
        completionTokens: completion,
        cachedTokens: this.usage?.cachedTokens,
        totalTokens: prompt + completion,
      },
      model: "fake",
      provider: "fake",
      durationMs: 10,
      startedAt: new Date().toISOString(),
      retryCount: 0,
      promptVersion: task.promptVersion ?? "unknown",
    };
  }
}

class NoUsageFailingGateway implements ModelGateway {
  public calls: ReasoningTask<unknown>[] = [];

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    this.calls.push(task as ReasoningTask<unknown>);
    throw new SchemaValidationError(
      '{"bad": true}',
      "answer: Required",
      undefined,
    );
  }
}

describe("DF-F002 — AI usage telemetry for failed/schema-invalid calls", () => {
  describe("failed provider attempts increment AI Usage modelCalls", () => {
    it("schema-invalid call is counted in modelCalls", async () => {
      const gateway = new SchemaFailingGateway(10, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await expect(budgetGateway.reason(createTask())).rejects.toThrow();

      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelCalls).toBe(1);
      expect(usage.modelCalls).toBeGreaterThan(0);
    });

    it("multiple failed attempts all counted", async () => {
      const gateway = new SchemaFailingGateway(10, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      await expect(budgetGateway.reason(createTask())).rejects.toThrow();

      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelCalls).toBe(3);
    });
  });

  describe("successfulModelCalls and failedModelCalls accuracy", () => {
    it("all successful calls: failedModelCalls is 0", async () => {
      const gateway = new FakeModelGateway(() => ({ answer: "ok" }), {
        promptTokens: 100,
        completionTokens: 50,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      await budgetGateway.reason(createTask());
      budget.recordModelCall();
      await budgetGateway.reason(createTask());

      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelCalls).toBe(2);
      expect(usage.successfulModelCalls).toBe(2);
      expect(usage.failedModelCalls).toBe(0);
    });

    it("all failed calls: successfulModelCalls is 0", async () => {
      const gateway = new SchemaFailingGateway(10, {
        promptTokens: 300,
        completionTokens: 100,
        totalTokens: 400,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 1,
      });

      await expect(budgetGateway.reason(createTask())).rejects.toThrow();

      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelCalls).toBe(2);
      expect(usage.successfulModelCalls).toBe(0);
      expect(usage.failedModelCalls).toBe(2);
    });

    it("mixed: one failure then repair success", async () => {
      const gateway = new SchemaFailingGateway(1, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      const result = await budgetGateway.reason(createTask());
      expect(result.data.answer).toBe("ok");

      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelCalls).toBe(2);
      expect(usage.successfulModelCalls).toBe(1);
      expect(usage.failedModelCalls).toBe(1);
    });
  });

  describe("provider usage from schema-invalid response is retained", () => {
    it("token counts from failed calls included in totals", async () => {
      const gateway = new SchemaFailingGateway(1, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      await budgetGateway.reason(createTask());

      const usage = budgetGateway.aggregateUsage();
      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(400);
    });

    it("cached tokens from failed calls are aggregated", async () => {
      const gateway = new SchemaFailingGateway(1, {
        promptTokens: 500,
        completionTokens: 200,
        cachedTokens: 300,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      await budgetGateway.reason(createTask());

      const usage = budgetGateway.aggregateUsage();
      expect(usage.cachedTokens).toBe(600);
    });

    it("failed call metadata records available usage", async () => {
      const gateway = new SchemaFailingGateway(1, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      await budgetGateway.reason(createTask());

      const failedMeta = budgetGateway.callMetadata.find((c) => !c.success);
      expect(failedMeta).toBeDefined();
      expect(failedMeta!.inputTokens).toBe(500);
      expect(failedMeta!.outputTokens).toBe(200);
      expect(failedMeta!.totalTokens).toBe(700);
    });
  });

  describe("missing provider usage is represented honestly", () => {
    it("failed call without usage does not fabricate token counts", async () => {
      const gateway = new NoUsageFailingGateway();
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await expect(budgetGateway.reason(createTask())).rejects.toThrow();

      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelCalls).toBe(1);
      expect(usage.failedModelCalls).toBe(1);
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);

      const meta = budgetGateway.callMetadata[0];
      expect(meta.success).toBe(false);
      expect(meta.inputTokens).toBeUndefined();
      expect(meta.outputTokens).toBeUndefined();
      expect(meta.totalTokens).toBeUndefined();
    });
  });

  describe("budget accounting consistency", () => {
    it("budget model calls are consistent with retry behavior", async () => {
      const gateway = new SchemaFailingGateway(1, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      await budgetGateway.reason(createTask());

      const snap = budget.snapshot();
      // Retries do not consume logical model-call budget
      expect(snap.modelCalls).toBe(0);
      expect(snap.retries).toBe(1);

      // Provider-level telemetry still counts all attempts
      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelCalls).toBe(2);
    });

    it("budget retries are tracked from schema repair attempts", async () => {
      const gateway = new SchemaFailingGateway(10, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      await expect(budgetGateway.reason(createTask())).rejects.toThrow();

      const snap = budget.snapshot();
      expect(snap.retries).toBeGreaterThanOrEqual(2);
    });
  });

  describe("telemetry schema validates new fields", () => {
    it("AIUsageTelemetrySchema requires successfulModelCalls and failedModelCalls", () => {
      const valid = {
        modelCalls: 5,
        successfulModelCalls: 4,
        failedModelCalls: 1,
        inputTokens: 2000,
        outputTokens: 500,
        cachedTokens: 0,
        limitStatus: "OK" as const,
      };

      const parsed = AIUsageTelemetrySchema.parse(valid);
      expect(parsed.successfulModelCalls).toBe(4);
      expect(parsed.failedModelCalls).toBe(1);
    });

    it("rejects telemetry missing successfulModelCalls", () => {
      const invalid = {
        modelCalls: 5,
        failedModelCalls: 1,
        inputTokens: 2000,
        outputTokens: 500,
        cachedTokens: 0,
        limitStatus: "OK" as const,
      };

      expect(() => AIUsageTelemetrySchema.parse(invalid)).toThrow();
    });

    it("rejects telemetry missing failedModelCalls", () => {
      const invalid = {
        modelCalls: 5,
        successfulModelCalls: 5,
        inputTokens: 2000,
        outputTokens: 500,
        cachedTokens: 0,
        limitStatus: "OK" as const,
      };

      expect(() => AIUsageTelemetrySchema.parse(invalid)).toThrow();
    });
  });

  describe("existing token-budget visibility preserved", () => {
    it("estimatedTpmDemand still tracked on failed calls", async () => {
      const gateway = new SchemaFailingGateway(10, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await expect(budgetGateway.reason(createTask())).rejects.toThrow();

      const usage = budgetGateway.aggregateUsage();
      expect(usage.estimatedTpmDemand).toBeGreaterThan(0);
    });

    it("contextBreakdown still populated on failed calls", async () => {
      const gateway = new SchemaFailingGateway(10, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await expect(budgetGateway.reason(createTask())).rejects.toThrow();

      const usage = budgetGateway.aggregateUsage();
      expect(usage.contextBreakdown).toBeDefined();
      expect(usage.contextBreakdown!.length).toBeGreaterThan(0);
    });

    it("maxResponseTokens still tracked", async () => {
      const gateway = new SchemaFailingGateway(10, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await expect(budgetGateway.reason(createTask())).rejects.toThrow();

      const usage = budgetGateway.aggregateUsage();
      expect(usage.maxResponseTokens).toBe(1024);
    });
  });
});
