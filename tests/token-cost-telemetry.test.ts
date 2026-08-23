import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FakeModelGateway,
  type FakeUsageConfig,
} from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import {
  BudgetAwareGateway,
  OversizedRequestError,
  estimateTokens,
  estimateTaskTokens,
  reduceTaskContext,
  DEFAULT_MAX_RESPONSE_TOKENS,
} from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
} from "../src/core/orchestrator/budget-manager.js";
import { formatQEReport } from "../src/core/orchestrator/report-formatter.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import {
  AIUsageTelemetrySchema,
  QEResultSchema,
  AnalysisResultSchema,
} from "../src/types/index.js";
import type {
  QEResult,
  QERequest,
  AIUsageTelemetry,
  RepositoryProfile,
} from "../src/types/index.js";
import { ZERO_AI_USAGE } from "../src/cli/analyze.js";
import { resolveModelTokenLimit } from "../src/cli/gateway-factory.js";
import { QEConfigSchema } from "../src/config/schema.js";

const SimpleOutputSchema = z.object({ answer: z.string() });

function createTask(
  contextSize?: number,
  maxTokens?: number,
): ReasoningTask<{ answer: string }> {
  const contextValue = contextSize ? "x".repeat(contextSize) : "short context";
  return {
    role: "test-analyst",
    objective: "Analyze the code",
    context: { data: contextValue },
    outputSchema: SimpleOutputSchema,
    maxTokens,
    promptVersion: "test-v1",
  };
}

function createFakeWithUsage(usage: FakeUsageConfig): FakeModelGateway {
  return new FakeModelGateway(() => ({ answer: "ok" }), usage);
}

function createMockProfile(): RepositoryProfile {
  return {
    root: "/tmp/repo",
    git: { detected: true, root: "/tmp/repo", branch: "main" },
    languages: [],
    frameworks: [],
    packageManagers: [],
    buildSystems: [],
    testFrameworks: [],
    ciSystems: [],
    applications: [],
    documentation: [],
    commands: [],
    capabilities: [],
    confidence: 0.5,
  };
}

function createMinimalQEResult(aiUsage?: AIUsageTelemetry): QEResult {
  return {
    executionId: "test-exec-001",
    repository: { path: "/tmp/repo", name: "test-repo" },
    target: "HEAD",
    profile: "quick",
    repositoryProfile: createMockProfile(),
    riskAssessment: {
      level: "LOW",
      factors: [],
      confidence: 0.8,
      summary: "Low risk",
    },
    validationPlan: {
      objectives: [],
      plannedActions: [],
      identifiedRisks: [],
      expectedCapabilities: [],
    },
    evidence: [],
    findings: [],
    requirements: [],
    remainingGaps: [],
    verdict: "PASS",
    confidence: "HIGH",
    summary: "All clear",
    recommendedNextActions: [],
    metrics: {
      startTime: new Date().toISOString(),
      modelCalls: aiUsage?.modelCalls ?? 0,
      commandsExecuted: 0,
      testsExecuted: 0,
      testsGenerated: 0,
      retries: 0,
      stateTransitions: 0,
    },
    aiUsage,
  };
}

describe("Token Cost Telemetry", () => {
  describe("qe analyze --json includes telemetry", () => {
    let dir: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "qe-telemetry-"));
      execFileSync("git", ["init"], { cwd: dir });
      execFileSync("git", ["checkout", "-b", "main"], { cwd: dir });
    });

    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("JSON output includes aiUsage with zero-usage state", () => {
      const output = execFileSync(
        "node",
        [join(process.cwd(), "dist", "cli", "main.js"), "analyze", "--json"],
        { cwd: dir, encoding: "utf-8", timeout: 15_000 },
      );

      const parsed = JSON.parse(output);
      expect(parsed.repositoryProfile).toBeDefined();
      expect(parsed.aiUsage).toBeDefined();
      expect(parsed.aiUsage.modelCalls).toBe(0);
      expect(parsed.aiUsage.inputTokens).toBe(0);
      expect(parsed.aiUsage.outputTokens).toBe(0);
      expect(parsed.aiUsage.cachedTokens).toBe(0);
      expect(parsed.aiUsage.limitStatus).toBe("OK");
    });

    it("JSON stdout is parseable and diagnostics go to stderr", () => {
      const result = execFileSync(
        "node",
        [join(process.cwd(), "dist", "cli", "main.js"), "analyze", "--json"],
        { cwd: dir, encoding: "utf-8", timeout: 15_000 },
      );

      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      AnalysisResultSchema.parse(parsed);
    });

    it("human-readable output includes AI usage no-model-call state", () => {
      const output = execFileSync(
        "node",
        [join(process.cwd(), "dist", "cli", "main.js"), "analyze"],
        { cwd: dir, encoding: "utf-8", timeout: 15_000 },
      );

      expect(output).toContain("AI Usage");
      expect(output).toContain("No model calls");
    });
  });

  describe("AIUsageTelemetry schema validation", () => {
    it("validates a complete telemetry object", () => {
      const telemetry = {
        modelCalls: 7,
        successfulModelCalls: 6,
        failedModelCalls: 1,
        inputTokens: 41822,
        outputTokens: 6103,
        cachedTokens: 18450,
        maxResponseTokens: 2048,
        estimatedTpmDemand: 47925,
        modelLimit: 128000,
        estimatedCost: 0.14,
        currency: "USD",
        contextBreakdown: [
          { category: "metadata", estimatedTokens: 200 },
          { category: "data", estimatedTokens: 10000 },
        ],
        limitStatus: "OK" as const,
      };

      const parsed = AIUsageTelemetrySchema.parse(telemetry);
      expect(parsed.modelCalls).toBe(7);
      expect(parsed.successfulModelCalls).toBe(6);
      expect(parsed.failedModelCalls).toBe(1);
      expect(parsed.inputTokens).toBe(41822);
      expect(parsed.cachedTokens).toBe(18450);
      expect(parsed.limitStatus).toBe("OK");
    });

    it("validates zero-usage telemetry for no-model-call runs", () => {
      const parsed = AIUsageTelemetrySchema.parse(ZERO_AI_USAGE);
      expect(parsed.modelCalls).toBe(0);
      expect(parsed.inputTokens).toBe(0);
      expect(parsed.outputTokens).toBe(0);
      expect(parsed.limitStatus).toBe("OK");
    });

    it("includes telemetry in QEResult schema", () => {
      const result = createMinimalQEResult({
        modelCalls: 3,
        successfulModelCalls: 3,
        failedModelCalls: 0,
        inputTokens: 5000,
        outputTokens: 1200,
        cachedTokens: 0,
        limitStatus: "OK",
      });

      const parsed = QEResultSchema.parse(result);
      expect(parsed.aiUsage).toBeDefined();
      expect(parsed.aiUsage!.modelCalls).toBe(3);
    });

    it("QEResult without aiUsage is valid", () => {
      const result = createMinimalQEResult();
      const parsed = QEResultSchema.parse(result);
      expect(parsed.aiUsage).toBeUndefined();
    });
  });

  describe("FakeModelGateway configurable usage", () => {
    it("returns configured usage stats", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 500,
        completionTokens: 200,
        cachedTokens: 100,
      });

      const result = await gateway.reason(createTask(undefined, 1024));
      expect(result.usage.promptTokens).toBe(500);
      expect(result.usage.completionTokens).toBe(200);
      expect(result.usage.cachedTokens).toBe(100);
      expect(result.usage.totalTokens).toBe(700);
    });

    it("returns zero usage when not configured", async () => {
      const gateway = new FakeModelGateway(() => ({ answer: "ok" }));
      const result = await gateway.reason(createTask(undefined, 1024));
      expect(result.usage.promptTokens).toBe(0);
      expect(result.usage.completionTokens).toBe(0);
      expect(result.usage.cachedTokens).toBeUndefined();
      expect(result.usage.totalTokens).toBe(0);
    });
  });

  describe("BudgetAwareGateway telemetry aggregation", () => {
    it("aggregates usage across multiple calls", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 1000,
        completionTokens: 300,
        cachedTokens: 400,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      await budgetGateway.reason(createTask(undefined, 1024));
      budget.recordModelCall();
      await budgetGateway.reason(createTask(undefined, 1024));
      budget.recordModelCall();
      await budgetGateway.reason(createTask(undefined, 1024));

      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelCalls).toBe(3);
      expect(usage.inputTokens).toBe(3000);
      expect(usage.outputTokens).toBe(900);
      expect(usage.cachedTokens).toBe(1200);
      expect(usage.limitStatus).toBe("OK");
    });

    it("reports zero usage when no calls made", () => {
      const gateway = createFakeWithUsage({});
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
      });

      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelCalls).toBe(0);
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.cachedTokens).toBe(0);
      expect(usage.limitStatus).toBe("OK");
    });

    it("tracks maxResponseTokens from task.maxTokens", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await budgetGateway.reason(createTask(100, 2048));
      budget.recordModelCall();
      await budgetGateway.reason(createTask(100, 4096));

      const usage = budgetGateway.aggregateUsage();
      expect(usage.maxResponseTokens).toBe(4096);
    });

    it("includes modelLimit when configured", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        modelTokenLimit: 128000,
      });

      await budgetGateway.reason(createTask(undefined, 1024));

      const usage = budgetGateway.aggregateUsage();
      expect(usage.modelLimit).toBe(128000);
    });

    it("cached tokens are represented when provider reports them", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 800,
        completionTokens: 200,
        cachedTokens: 500,
      });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await budgetGateway.reason(createTask(undefined, 1024));

      const usage = budgetGateway.aggregateUsage();
      expect(usage.cachedTokens).toBe(500);

      const meta = budgetGateway.callMetadata[0];
      expect(meta.cachedTokens).toBe(500);
    });
  });

  describe("context estimation and pre-dispatch TPM demand", () => {
    it("estimateTokens uses ~4 chars per token heuristic", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("abcd")).toBe(1);
      expect(estimateTokens("abcde")).toBe(2);
      expect(estimateTokens("a".repeat(100))).toBe(25);
    });

    it("estimateTaskTokens accounts for role, objective, constraints, and context", () => {
      const task = createTask(400, 1024);
      const estimate = estimateTaskTokens(task);
      expect(estimate).toBeGreaterThan(100);

      const contextTokens = estimateTokens("x".repeat(400));
      const metaTokens =
        estimateTokens("test-analyst") + estimateTokens("Analyze the code");
      expect(estimate).toBe(contextTokens + metaTokens);
    });

    it("estimateTaskTokens includes constraints", () => {
      const task = createTask(100, 1024);
      const withoutConstraints = estimateTaskTokens(task);

      const taskWithConstraints = {
        ...task,
        constraints: ["Be thorough", "Check edge cases"],
      };
      const withConstraints = estimateTaskTokens(taskWithConstraints);
      expect(withConstraints).toBeGreaterThan(withoutConstraints);
    });

    it("pre-dispatch estimatedTpmDemand includes context estimate + max response reservation", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 500,
        completionTokens: 200,
      });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      const task = createTask(400, 2048);
      await budgetGateway.reason(task);

      const usage = budgetGateway.aggregateUsage();
      const expectedContextEstimate = estimateTaskTokens(task);
      expect(usage.estimatedTpmDemand).toBe(expectedContextEstimate + 2048);
      expect(usage.estimatedTpmDemand).toBeGreaterThan(
        usage.inputTokens + usage.outputTokens,
      );
    });

    it("output token reservation affects TPM demand and uses right-sized default", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      const taskNoExplicit = createTask(400);
      await budgetGateway.reason(taskNoExplicit);

      const usage = budgetGateway.aggregateUsage();
      const contextEstimate = estimateTaskTokens(taskNoExplicit);
      expect(usage.estimatedTpmDemand).toBe(
        contextEstimate + DEFAULT_MAX_RESPONSE_TOKENS,
      );
      expect(DEFAULT_MAX_RESPONSE_TOKENS).toBe(2048);
    });

    it("explicit task maxTokens overrides the default for TPM demand", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      const task = createTask(400, 1536);
      await budgetGateway.reason(task);

      const usage = budgetGateway.aggregateUsage();
      const contextEstimate = estimateTaskTokens(task);
      expect(usage.estimatedTpmDemand).toBe(contextEstimate + 1536);
    });
  });

  describe("oversized request detection and handling", () => {
    it("detects oversized requests before dispatch when limits are known", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        modelTokenLimit: 100,
      });

      const largeTask = createTask(2000, 1024);

      await expect(budgetGateway.reason(largeTask)).rejects.toThrow(
        OversizedRequestError,
      );
      await expect(budgetGateway.reason(largeTask)).rejects.toThrow(
        /Context exceeds available model throughput/,
      );

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("BLOCKED");
    });

    it("reduces context when request is moderately oversized", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 200,
        completionTokens: 50,
      });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        modelTokenLimit: 600,
      });

      const task = createTask(2000, 256);
      const result = await budgetGateway.reason(task);

      expect(result.data.answer).toBe("ok");
      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("REDUCED");
    });

    it("blocks when context cannot be reduced enough", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        modelTokenLimit: 50,
      });

      const task = createTask(10000, 1024);

      await expect(budgetGateway.reason(task)).rejects.toThrow(
        OversizedRequestError,
      );
    });

    it("does not block when context fits within limits", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        modelTokenLimit: 100000,
      });

      const task = createTask(400, 1024);
      const result = await budgetGateway.reason(task);
      expect(result.data.answer).toBe("ok");

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("OK");
    });

    it("intrinsically oversized requests do not rely on exponential backoff", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 3,
        modelTokenLimit: 100,
      });

      const task = createTask(5000, 1024);

      await expect(budgetGateway.reason(task)).rejects.toThrow(
        OversizedRequestError,
      );

      expect(gateway.calls.length).toBe(0);
    });
  });

  describe("production orchestrator path enforces configured model limit", () => {
    it("orchestrator passes modelTokenLimit to BudgetAwareGateway", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const orchestrator = new QEOrchestrator({
        gateway,
        modelTokenLimit: 50000,
        repositoryProfile: createMockProfile(),
        memoryConfig: { enabled: false },
      });

      const request: QERequest = {
        repositoryPath: "/tmp/repo",
        requirements: [{ id: "REQ-1", description: "works" }],
        profile: "quick",
        mode: "repository",
      };

      const result = await orchestrator.run(request);
      expect(result.aiUsage).toBeDefined();
      expect(result.aiUsage!.modelLimit).toBe(50000);
    });

    it("oversized request through orchestrator produces BLOCKED or REDUCED status", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const orchestrator = new QEOrchestrator({
        gateway,
        modelTokenLimit: 50,
        repositoryProfile: createMockProfile(),
        memoryConfig: { enabled: false },
      });

      const request: QERequest = {
        repositoryPath: "/tmp/repo",
        requirements: [{ id: "REQ-1", description: "works" }],
        profile: "quick",
        mode: "repository",
      };

      const result = await orchestrator.run(request);
      expect(result.aiUsage).toBeDefined();
      expect(["BLOCKED", "REDUCED"]).toContain(result.aiUsage!.limitStatus);
    });
  });

  describe("reduceTaskContext", () => {
    it("returns task unchanged when it fits", () => {
      const task = createTask(100, 1024);
      const reduced = reduceTaskContext(task, 10000);
      expect(reduced).toBe(task);
    });

    it("truncates context proportionally when moderately oversized", () => {
      const task = createTask(4000, 1024);
      const reduced = reduceTaskContext(task, 600);
      expect(reduced).not.toBeNull();
      const dataStr = reduced!.context.data as string;
      expect(dataStr.length).toBeLessThan(4000);
      expect(dataStr.length).toBeGreaterThan(0);
    });

    it("returns null when ratio is below 0.3 (too much reduction)", () => {
      const task = createTask(10000, 1024);
      const reduced = reduceTaskContext(task, 100);
      expect(reduced).toBeNull();
    });

    it("returns null when available tokens is zero or negative", () => {
      const task = createTask(100, 1024);
      expect(reduceTaskContext(task, 0)).toBeNull();
      expect(reduceTaskContext(task, -10)).toBeNull();
    });
  });

  describe("report formatting", () => {
    it("includes AI Usage section when telemetry is present", () => {
      const result = createMinimalQEResult({
        modelCalls: 7,
        successfulModelCalls: 7,
        failedModelCalls: 0,
        inputTokens: 41822,
        outputTokens: 6103,
        cachedTokens: 18450,
        estimatedCost: 0.14,
        limitStatus: "OK",
      });

      const report = formatQEReport(result);
      expect(report).toContain("## AI Usage");
      expect(report).toContain("Model calls:");
      expect(report).toContain("7");
      expect(report).toContain("41,822");
      expect(report).toContain("6,103");
      expect(report).toContain("18,450");
      expect(report).toContain("$0.14");
    });

    it("omits AI Usage section when telemetry is absent", () => {
      const result = createMinimalQEResult();
      const report = formatQEReport(result);
      expect(report).not.toContain("## AI Usage");
    });

    it("omits cached tokens line when zero", () => {
      const result = createMinimalQEResult({
        modelCalls: 3,
        successfulModelCalls: 3,
        failedModelCalls: 0,
        inputTokens: 5000,
        outputTokens: 1200,
        cachedTokens: 0,
        limitStatus: "OK",
      });

      const report = formatQEReport(result);
      expect(report).toContain("## AI Usage");
      expect(report).not.toContain("Cached tokens:");
    });

    it("shows limit status when degraded or blocked", () => {
      const result = createMinimalQEResult({
        modelCalls: 1,
        successfulModelCalls: 1,
        failedModelCalls: 0,
        inputTokens: 1000,
        outputTokens: 200,
        cachedTokens: 0,
        limitStatus: "DEGRADED",
      });

      const report = formatQEReport(result);
      expect(report).toContain("Limit status:");
      expect(report).toContain("DEGRADED");
    });

    it("omits limit status for OK and UNKNOWN", () => {
      for (const status of ["OK", "UNKNOWN"] as const) {
        const result = createMinimalQEResult({
          modelCalls: 1,
          successfulModelCalls: 1,
          failedModelCalls: 0,
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 0,
          limitStatus: status,
        });
        const report = formatQEReport(result);
        expect(report).not.toContain("Limit status:");
      }
    });

    it("omits estimated cost line when not available", () => {
      const result = createMinimalQEResult({
        modelCalls: 2,
        successfulModelCalls: 2,
        failedModelCalls: 0,
        inputTokens: 3000,
        outputTokens: 800,
        cachedTokens: 0,
        limitStatus: "OK",
      });

      const report = formatQEReport(result);
      expect(report).toContain("## AI Usage");
      expect(report).not.toContain("Estimated cost:");
    });
  });

  describe("missing pricing data does not fail analysis", () => {
    it("telemetry without estimatedCost is valid", () => {
      const telemetry = {
        modelCalls: 5,
        successfulModelCalls: 5,
        failedModelCalls: 0,
        inputTokens: 20000,
        outputTokens: 4000,
        cachedTokens: 0,
        limitStatus: "OK" as const,
      };

      const parsed = AIUsageTelemetrySchema.parse(telemetry);
      expect(parsed.estimatedCost).toBeUndefined();
    });

    it("gateway aggregation works without cost data", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 500 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await budgetGateway.reason(createTask(undefined, 1024));
      const usage = budgetGateway.aggregateUsage();
      expect(usage.estimatedCost).toBeUndefined();
      expect(usage.modelCalls).toBe(1);
    });
  });

  describe("provider-specific details do not leak into core types", () => {
    it("AIUsageTelemetry contains no provider-specific fields", () => {
      const shape = AIUsageTelemetrySchema.shape;
      const fieldNames = Object.keys(shape);

      const providerSpecificFields = [
        "openai",
        "anthropic",
        "gpt",
        "claude",
        "prompt_tokens",
        "completion_tokens",
        "cached_tokens",
        "prompt_tokens_details",
      ];

      for (const field of providerSpecificFields) {
        expect(fieldNames).not.toContain(field);
      }
    });

    it("ModelCallMetadata contains no provider SDK types", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 500,
        completionTokens: 200,
        cachedTokens: 100,
      });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await budgetGateway.reason(createTask(undefined, 1024));
      const meta = budgetGateway.callMetadata[0];
      const keys = Object.keys(meta);
      expect(keys).not.toContain("prompt_tokens");
      expect(keys).not.toContain("completion_tokens");
      expect(keys).not.toContain("prompt_tokens_details");
    });
  });

  describe("telemetry does not include secrets", () => {
    it("aggregated usage contains no API keys or credentials", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 500,
        completionTokens: 200,
      });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      await budgetGateway.reason(createTask(undefined, 1024));
      const usage = budgetGateway.aggregateUsage();
      const serialized = JSON.stringify(usage);

      expect(serialized).not.toContain("sk-");
      expect(serialized).not.toContain("api_key");
      expect(serialized).not.toContain("apiKey");
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("password");

      const keys = Object.keys(usage);
      for (const key of keys) {
        expect(key).not.toMatch(/key|secret|password|credential/i);
      }
    });
  });

  describe("rate limit vs intrinsic oversize distinction", () => {
    it("marks limitStatus as DEGRADED on 429-like errors (transient)", async () => {
      let callCount = 0;
      const gateway: FakeModelGateway = new FakeModelGateway(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error("429 Too Many Requests");
        }
        return { answer: "ok" };
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      const result = await budgetGateway.reason(createTask(undefined, 1024));
      expect(result.data.answer).toBe("ok");

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("DEGRADED");
    });

    it("intrinsically oversized requests throw OversizedRequestError, not 429", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 3,
        modelTokenLimit: 100,
      });

      const task = createTask(5000, 1024);

      try {
        await budgetGateway.reason(task);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OversizedRequestError);
        expect((err as OversizedRequestError).estimatedDemand).toBeGreaterThan(
          100,
        );
        expect((err as OversizedRequestError).modelLimit).toBe(100);
      }

      expect(gateway.calls.length).toBe(0);
    });
  });

  describe("context breakdown", () => {
    it("provides per-category token estimates", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 300 });
      const budget = new BudgetManager(createBudgetForProfile("quick"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      const task: ReasoningTask<{ answer: string }> = {
        role: "analyst",
        objective: "Review code",
        context: {
          sourceCode: "function hello() { return 'world'; }",
          testOutput: "All 5 tests passed",
        },
        outputSchema: SimpleOutputSchema,
        maxTokens: 1024,
      };

      await budgetGateway.reason(task);
      const usage = budgetGateway.aggregateUsage();

      expect(usage.contextBreakdown).toBeDefined();
      expect(usage.contextBreakdown!.length).toBeGreaterThanOrEqual(2);

      const categories = usage.contextBreakdown!.map((b) => b.category);
      expect(categories).toContain("metadata");
      expect(categories).toContain("sourceCode");
      expect(categories).toContain("testOutput");

      for (const entry of usage.contextBreakdown!) {
        expect(entry.estimatedTokens).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("model token limit configuration", () => {
    it("resolveModelTokenLimit returns config value when set", () => {
      const config = QEConfigSchema.parse({
        version: 1,
        model: { tokenLimit: 64000 },
      });
      expect(resolveModelTokenLimit(config)).toBe(64000);
    });

    it("resolveModelTokenLimit derives limit from known model names", () => {
      const config = QEConfigSchema.parse({
        version: 1,
        model: { model: "gpt-4o" },
      });
      expect(resolveModelTokenLimit(config)).toBe(128000);
    });

    it("resolveModelTokenLimit returns undefined for unknown models without config", () => {
      const config = QEConfigSchema.parse({
        version: 1,
        model: { model: "custom-model-v1" },
      });
      expect(resolveModelTokenLimit(config)).toBeUndefined();
    });

    it("config tokenLimit overrides known model default", () => {
      const config = QEConfigSchema.parse({
        version: 1,
        model: { model: "gpt-4o", tokenLimit: 50000 },
      });
      expect(resolveModelTokenLimit(config)).toBe(50000);
    });
  });
});
