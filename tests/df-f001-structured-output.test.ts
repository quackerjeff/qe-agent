import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "../src/models/gateway/schema-converter.js";
import { SchemaValidationError } from "../src/models/gateway/types.js";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import { supportsJsonSchemaMode } from "../src/models/gateway/openai.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
} from "../src/core/orchestrator/budget-manager.js";
import { FakeModelGateway } from "../src/models/gateway/fake.js";

import { RiskAnalysisOutputSchema } from "../src/prompts/risk-analysis/v1.js";
import { ChangeAnalysisOutputSchema } from "../src/prompts/change-analysis/v1.js";
import { ValidationPlanOutputSchema } from "../src/prompts/validation-plan/v1.js";
import { FailureAnalysisOutputSchema } from "../src/prompts/failure-analysis/v1.js";
import { GapAnalysisOutputSchema } from "../src/prompts/gap-analysis/v1.js";
import { VerdictRecommendationOutputSchema } from "../src/prompts/verdict/v1.js";
import { TestGenerationDecisionSchema } from "../src/prompts/test-generation/v1.js";
import { MemoryDistillationOutputSchema } from "../src/prompts/memory-distillation/v1.js";

const SimpleOutputSchema = z.object({
  answer: z.string(),
  count: z.number(),
});

function createTask(
  overrides?: Partial<ReasoningTask<{ answer: string; count: number }>>,
): ReasoningTask<{ answer: string; count: number }> {
  return {
    role: "test-analyst",
    objective: "Analyze the code",
    context: { data: "test context" },
    outputSchema: SimpleOutputSchema,
    maxTokens: 1024,
    promptVersion: "test-v1",
    ...overrides,
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
      totalTokens: number;
    },
  ) {}

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    this.calls.push(task as ReasoningTask<unknown>);
    this.callCount++;

    if (this.callCount <= this.failCount) {
      throw new SchemaValidationError(
        '{"wrong": "shape", "factors": {}}',
        "level: Required; factors: Expected array, received object; confidence: Required; summary: Required",
        this.usage,
      );
    }

    const data = task.outputSchema.parse({ answer: "repaired", count: 42 });
    const prompt = this.usage?.promptTokens ?? 0;
    const completion = this.usage?.completionTokens ?? 0;

    return {
      data,
      usage: {
        promptTokens: prompt,
        completionTokens: completion,
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

describe("DF-F001 — Structured output robustness", () => {
  describe("zodToJsonSchema converter", () => {
    it("converts a simple object schema", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
      });

      const json = zodToJsonSchema(schema);
      expect(json.type).toBe("object");
      expect(json.required).toEqual(["name", "age", "active"]);

      const props = json.properties as Record<string, { type: string }>;
      expect(props.name.type).toBe("string");
      expect(props.age.type).toBe("number");
      expect(props.active.type).toBe("boolean");
    });

    it("converts enum fields", () => {
      const schema = z.object({
        level: z.enum(["LOW", "MEDIUM", "HIGH"]),
      });

      const json = zodToJsonSchema(schema);
      const props = json.properties as Record<
        string,
        { type: string; enum: string[] }
      >;
      expect(props.level.type).toBe("string");
      expect(props.level.enum).toEqual(["LOW", "MEDIUM", "HIGH"]);
    });

    it("converts array fields", () => {
      const schema = z.object({
        items: z.array(z.string()),
        nested: z.array(z.object({ id: z.string() })),
      });

      const json = zodToJsonSchema(schema);
      const props = json.properties as Record<string, Record<string, unknown>>;
      expect(props.items.type).toBe("array");
      expect((props.items.items as { type: string }).type).toBe("string");
      expect(props.nested.type).toBe("array");
      const nestedItems = props.nested.items as {
        type: string;
        properties: Record<string, unknown>;
      };
      expect(nestedItems.type).toBe("object");
    });

    it("handles optional fields by excluding them from required", () => {
      const schema = z.object({
        name: z.string(),
        nickname: z.string().optional(),
      });

      const json = zodToJsonSchema(schema);
      expect(json.required).toEqual(["name"]);
      const props = json.properties as Record<string, { type: string }>;
      expect(props.nickname.type).toBe("string");
    });

    it("handles z.record as generic object", () => {
      const schema = z.object({
        metadata: z.record(z.unknown()),
      });

      const json = zodToJsonSchema(schema);
      const props = json.properties as Record<string, { type: string }>;
      expect(props.metadata.type).toBe("object");
    });
  });

  describe("all reasoning task schemas produce valid JSON Schema", () => {
    const schemas = [
      { name: "RiskAnalysis", schema: RiskAnalysisOutputSchema },
      { name: "ChangeAnalysis", schema: ChangeAnalysisOutputSchema },
      { name: "ValidationPlan", schema: ValidationPlanOutputSchema },
      { name: "FailureAnalysis", schema: FailureAnalysisOutputSchema },
      { name: "GapAnalysis", schema: GapAnalysisOutputSchema },
      { name: "Verdict", schema: VerdictRecommendationOutputSchema },
      { name: "TestGeneration", schema: TestGenerationDecisionSchema },
      { name: "MemoryDistillation", schema: MemoryDistillationOutputSchema },
    ];

    for (const { name, schema } of schemas) {
      it(`${name} schema converts to JSON Schema with type=object`, () => {
        const json = zodToJsonSchema(schema);
        expect(json.type).toBe("object");
        expect(json.properties).toBeDefined();
        expect(
          Object.keys(json.properties as Record<string, unknown>).length,
        ).toBeGreaterThan(0);
      });
    }

    it("RiskAnalysis JSON Schema includes all required fields from the Zod schema", () => {
      const json = zodToJsonSchema(RiskAnalysisOutputSchema);
      const required = json.required as string[];
      expect(required).toContain("level");
      expect(required).toContain("factors");
      expect(required).toContain("confidence");
      expect(required).toContain("summary");

      const props = json.properties as Record<string, Record<string, unknown>>;
      expect(props.level.enum).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
      expect(props.factors.type).toBe("array");
      expect(props.confidence.type).toBe("number");
      expect(props.summary.type).toBe("string");
    });
  });

  describe("OpenAI structured output mode selection", () => {
    it("gpt-4o models support json_schema mode", () => {
      expect(supportsJsonSchemaMode("gpt-4o")).toBe(true);
      expect(supportsJsonSchemaMode("gpt-4o-mini")).toBe(true);
      expect(supportsJsonSchemaMode("gpt-4o-2024-08-06")).toBe(true);
    });

    it("older models do not support json_schema mode", () => {
      expect(supportsJsonSchemaMode("gpt-4-turbo")).toBe(false);
      expect(supportsJsonSchemaMode("gpt-4")).toBe(false);
      expect(supportsJsonSchemaMode("gpt-3.5-turbo")).toBe(false);
    });

    it("o-series models support json_schema mode", () => {
      expect(supportsJsonSchemaMode("o1")).toBe(true);
      expect(supportsJsonSchemaMode("o3-mini")).toBe(true);
    });
  });

  describe("client-side Zod validation remains authoritative", () => {
    it("FakeModelGateway still validates output against Zod schema", async () => {
      const gateway = new FakeModelGateway(() => ({
        answer: 123,
        count: "not a number",
      }));

      const task = createTask();
      await expect(gateway.reason(task)).rejects.toThrow();
    });

    it("valid data passes both Zod validation", async () => {
      const gateway = new FakeModelGateway(() => ({
        answer: "hello",
        count: 42,
      }));

      const task = createTask();
      const result = await gateway.reason(task);
      expect(result.data.answer).toBe("hello");
      expect(result.data.count).toBe(42);
    });
  });

  describe("schema-invalid repair within bounded retry budget", () => {
    it("repair attempt includes validation errors in task context", async () => {
      const innerGateway = new SchemaFailingGateway(1, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(innerGateway, budget, {
        maxRetriesPerCall: 2,
      });

      const task = createTask();
      const result = await budgetGateway.reason(task);
      expect(result.data.answer).toBe("repaired");

      expect(innerGateway.calls.length).toBe(2);
      const repairCall = innerGateway.calls[1] as ReasoningTask<unknown>;
      const repairCtx = repairCall.context._schemaRepair as Record<
        string,
        unknown
      >;
      expect(repairCtx).toBeDefined();
      expect(repairCtx.validationErrors).toContain("level: Required");
      expect(repairCtx.previousResponse).toContain('"wrong"');
      expect(repairCtx.expectedSchema).toBeDefined();
      expect(repairCtx.instruction).toBeDefined();
    });

    it("repair includes expected JSON Schema derived from Zod", async () => {
      const innerGateway = new SchemaFailingGateway(1, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(innerGateway, budget, {
        maxRetriesPerCall: 2,
      });

      const task = createTask();
      await budgetGateway.reason(task);

      const repairCall = innerGateway.calls[1] as ReasoningTask<unknown>;
      const repairCtx = repairCall.context._schemaRepair as Record<
        string,
        unknown
      >;
      const expectedSchema = repairCtx.expectedSchema as Record<
        string,
        unknown
      >;
      expect(expectedSchema.type).toBe("object");
      expect(expectedSchema.properties).toBeDefined();
      const props = expectedSchema.properties as Record<string, unknown>;
      expect(props.answer).toBeDefined();
      expect(props.count).toBeDefined();
    });

    it("does not blindly repeat the identical request on schema failure", async () => {
      const innerGateway = new SchemaFailingGateway(1, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(innerGateway, budget, {
        maxRetriesPerCall: 2,
      });

      const task = createTask();
      await budgetGateway.reason(task);

      const firstCall = innerGateway.calls[0] as ReasoningTask<unknown>;
      const repairCall = innerGateway.calls[1] as ReasoningTask<unknown>;

      expect(firstCall.context._schemaRepair).toBeUndefined();
      expect(repairCall.context._schemaRepair).toBeDefined();
    });

    it("retry exhaustion after schema failures produces BLOCKED behavior", async () => {
      const innerGateway = new SchemaFailingGateway(10, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(innerGateway, budget, {
        maxRetriesPerCall: 2,
      });

      const task = createTask();
      await expect(budgetGateway.reason(task)).rejects.toThrow(
        SchemaValidationError,
      );
    });

    it("repair is bounded by maxRetriesPerCall", async () => {
      const innerGateway = new SchemaFailingGateway(10);
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(innerGateway, budget, {
        maxRetriesPerCall: 1,
      });

      const task = createTask();
      await expect(budgetGateway.reason(task)).rejects.toThrow(
        SchemaValidationError,
      );

      expect(innerGateway.calls.length).toBe(2);
    });
  });

  describe("SchemaValidationError", () => {
    it("preserves raw response and validation errors", () => {
      const err = new SchemaValidationError(
        '{"bad": "data"}',
        "level: Required; factors: Expected array",
        { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      );

      expect(err.name).toBe("SchemaValidationError");
      expect(err.rawResponse).toBe('{"bad": "data"}');
      expect(err.validationErrors).toContain("level: Required");
      expect(err.usage?.promptTokens).toBe(100);
    });

    it("works without usage information", () => {
      const err = new SchemaValidationError(
        '{"bad": "data"}',
        "level: Required",
      );

      expect(err.usage).toBeUndefined();
    });
  });
});
