import { describe, it, expect } from "vitest";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import {
  SchemaValidationError,
  OutputTruncationError,
} from "../src/models/gateway/types.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
} from "../src/core/orchestrator/budget-manager.js";
import {
  calculateGapAnalysisMaxTokens,
  GAP_ANALYSIS_BASE_TOKENS,
  GAP_ANALYSIS_PER_REQUIREMENT_TOKENS,
  GAP_ANALYSIS_MAX_TOKENS,
  buildGapAnalysisTask,
} from "../src/prompts/gap-analysis/v1.js";

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

describe("DF-002: Output Truncation Detection", () => {
  describe("OutputTruncationError type", () => {
    it("is a subclass of SchemaValidationError", () => {
      const err = new OutputTruncationError('{"partial":', 2048, {
        promptTokens: 1000,
        completionTokens: 2048,
        totalTokens: 3048,
      });
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect(err).toBeInstanceOf(OutputTruncationError);
      expect(err.name).toBe("OutputTruncationError");
      expect(err.maxTokens).toBe(2048);
      expect(err.usage).toBeDefined();
      expect(err.rawResponse).toBe('{"partial":');
    });

    it("finish_reason=length is distinguishable from malformed complete JSON", () => {
      const truncation = new OutputTruncationError('{"partial":', 2048);
      const malformed = new SchemaValidationError(
        '{"answer": 123}',
        "answer: Expected string, received number",
      );

      expect(truncation).toBeInstanceOf(OutputTruncationError);
      expect(malformed).not.toBeInstanceOf(OutputTruncationError);
      expect(truncation.name).toBe("OutputTruncationError");
      expect(malformed.name).toBe("SchemaValidationError");

      expect(truncation.message).toContain("truncated");
      expect(truncation.message).toContain("2048");
      expect(malformed.message).not.toContain("truncated");
    });
  });

  describe("Truncation retry doubles maxTokens", () => {
    it("retry after OutputTruncationError increases maxTokens", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return new OutputTruncationError('{"partial":', 2048, {
            promptTokens: 1000,
            completionTokens: 2048,
            totalTokens: 3048,
          });
        }
        return makeResult(1000, 3000);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      const result = await budgetGateway.reason(createTask(2048));
      expect(result.data.answer).toBe("ok");

      expect(gateway.calls).toHaveLength(2);
      expect(gateway.calls[0].maxTokens).toBe(2048);
      expect(gateway.calls[1].maxTokens).toBe(4096);
    });

    it("truncation retry does not repeat the same insufficient reservation", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return new OutputTruncationError('{"p":', 1024, {
            promptTokens: 500,
            completionTokens: 1024,
            totalTokens: 1524,
          });
        }
        return makeResult(500, 1500);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      await budgetGateway.reason(createTask(1024));

      expect(gateway.calls[1].maxTokens).toBe(2048);
      expect(gateway.calls[1].maxTokens).toBeGreaterThan(
        gateway.calls[0].maxTokens!,
      );
    });

    it("maxTokens increase is capped at 16384", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return new OutputTruncationError('{"p":', 16384, {
            promptTokens: 500,
            completionTokens: 16384,
            totalTokens: 16884,
          });
        }
        return makeResult(500, 1500);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      await budgetGateway.reason(createTask(16384));

      expect(gateway.calls[1].maxTokens).toBe(16384);
    });

    it("SchemaValidationError still triggers repair task (not maxTokens increase)", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return new SchemaValidationError(
            '{"wrong": true}',
            "answer: Required",
            {
              promptTokens: 500,
              completionTokens: 200,
              totalTokens: 700,
            },
          );
        }
        return makeResult(800, 300);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      await budgetGateway.reason(createTask(2048));

      expect(gateway.calls[1].maxTokens).toBe(2048);
      expect(gateway.calls[1].context).toHaveProperty("_schemaRepair");
    });
  });
});

describe("DF-002: Gap Analysis Dynamic Sizing", () => {
  it("1 requirement gets a small bounded reservation", () => {
    const maxTokens = calculateGapAnalysisMaxTokens(1);
    expect(maxTokens).toBe(
      GAP_ANALYSIS_BASE_TOKENS + GAP_ANALYSIS_PER_REQUIREMENT_TOKENS,
    );
    expect(maxTokens).toBeLessThanOrEqual(1024);
  });

  it("38 requirements get a sufficient reservation", () => {
    const maxTokens = calculateGapAnalysisMaxTokens(38);
    const expected =
      GAP_ANALYSIS_BASE_TOKENS + 38 * GAP_ANALYSIS_PER_REQUIREMENT_TOKENS;
    expect(maxTokens).toBe(expected);
    expect(maxTokens).toBeGreaterThan(2048);
    expect(maxTokens).toBeLessThanOrEqual(GAP_ANALYSIS_MAX_TOKENS);
  });

  it("reservation is capped at GAP_ANALYSIS_MAX_TOKENS", () => {
    const maxTokens = calculateGapAnalysisMaxTokens(1000);
    expect(maxTokens).toBe(GAP_ANALYSIS_MAX_TOKENS);
  });

  it("buildGapAnalysisTask uses dynamic maxTokens", () => {
    const requirements = Array.from({ length: 38 }, (_, i) => ({
      id: `FR-${String(i + 1).padStart(3, "0")}`,
      description: `Requirement ${i + 1}`,
    }));

    const task = buildGapAnalysisTask(
      requirements,
      [
        {
          id: "e1",
          type: "COMMAND_RESULT",
          status: "PASS",
          summary: "tests passed",
        },
      ],
      [],
      { level: "LOW", factors: [] },
    );

    const expected = calculateGapAnalysisMaxTokens(38);
    expect(task.maxTokens).toBe(expected);
    expect(task.maxTokens).toBeGreaterThan(2048);
  });

  it("single requirement task uses base + per-requirement tokens", () => {
    const task = buildGapAnalysisTask(
      [{ id: "FR-001", description: "Repository Detection" }],
      [],
      [],
      { level: "LOW", factors: [] },
    );

    expect(task.maxTokens).toBe(
      GAP_ANALYSIS_BASE_TOKENS + GAP_ANALYSIS_PER_REQUIREMENT_TOKENS,
    );
  });

  it("formula components are reasonable", () => {
    expect(GAP_ANALYSIS_BASE_TOKENS).toBeGreaterThanOrEqual(256);
    expect(GAP_ANALYSIS_BASE_TOKENS).toBeLessThanOrEqual(1024);
    expect(GAP_ANALYSIS_PER_REQUIREMENT_TOKENS).toBeGreaterThanOrEqual(40);
    expect(GAP_ANALYSIS_PER_REQUIREMENT_TOKENS).toBeLessThanOrEqual(150);
    expect(GAP_ANALYSIS_MAX_TOKENS).toBeGreaterThanOrEqual(8192);
    expect(GAP_ANALYSIS_MAX_TOKENS).toBeLessThanOrEqual(32768);
  });

  it("prompt includes conciseness constraint", () => {
    const task = buildGapAnalysisTask(
      [{ id: "FR-001", description: "Test" }],
      [],
      [],
      { level: "LOW", factors: [] },
    );

    const conciseness = task.constraints?.find((c) =>
      c.toLowerCase().includes("concise"),
    );
    expect(conciseness).toBeDefined();
  });
});
