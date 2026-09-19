import { describe, it, expect } from "vitest";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import { BudgetManager } from "../src/core/orchestrator/budget-manager.js";
import { createBudgetForProfile } from "../src/core/orchestrator/budget-manager.js";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";

/** Test-only in-memory gateway capturing the maxTokens it receives. */
class CapturingGateway implements ModelGateway {
  public seenMaxTokens: (number | undefined)[] = [];

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    this.seenMaxTokens.push(task.maxTokens);
    return {
      data: task.outputSchema.parse({}),
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
      model: "test-model",
      provider: "test",
      durationMs: 1,
      startedAt: new Date().toISOString(),
      retryCount: 0,
      promptVersion: task.promptVersion ?? "test",
    };
  }
}

function makeGateway(floor?: number) {
  const inner = new CapturingGateway();
  const budget = new BudgetManager(createBudgetForProfile("standard"));
  const gateway = new BudgetAwareGateway(inner, budget, {
    minResponseTokens: floor,
  });
  return { inner, gateway };
}

describe("BudgetAwareGateway minResponseTokens floor", () => {
  const schema = z.object({}).passthrough();

  it("raises prompt maxTokens to the configured floor", async () => {
    const { inner, gateway } = makeGateway(6144);
    await gateway.reason({
      role: "test",
      objective: "test",
      context: {},
      outputSchema: schema,
      maxTokens: 2048,
      promptVersion: "v1",
    });
    expect(inner.seenMaxTokens[0]).toBe(6144);
  });

  it("never lowers a larger prompt maxTokens", async () => {
    const { inner, gateway } = makeGateway(2048);
    await gateway.reason({
      role: "test",
      objective: "test",
      context: {},
      outputSchema: schema,
      maxTokens: 8192,
      promptVersion: "v1",
    });
    expect(inner.seenMaxTokens[0]).toBe(8192);
  });

  it("applies the floor when the prompt omits maxTokens", async () => {
    const { inner, gateway } = makeGateway(6144);
    await gateway.reason({
      role: "test",
      objective: "test",
      context: {},
      outputSchema: schema,
      promptVersion: "v1",
    });
    expect(inner.seenMaxTokens[0]).toBe(6144);
  });

  it("leaves defaults untouched when no floor is configured", async () => {
    const { inner, gateway } = makeGateway(undefined);
    await gateway.reason({
      role: "test",
      objective: "test",
      context: {},
      outputSchema: schema,
      maxTokens: 2048,
      promptVersion: "v1",
    });
    expect(inner.seenMaxTokens[0]).toBe(2048);
  });
});
