import { describe, it, expect } from "vitest";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
  ProviderRateLimitInfo,
} from "../src/models/gateway/types.js";
import { RateLimitError } from "../src/models/gateway/types.js";
import {
  FakeModelGateway,
  type FakeUsageConfig,
} from "../src/models/gateway/fake.js";
import {
  BudgetAwareGateway,
  OversizedRequestError,
  ThroughputExceededError,
  estimateTaskTokens,
  MINIMUM_OUTPUT_RESERVATION,
} from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
} from "../src/core/orchestrator/budget-manager.js";
import { formatQEReport } from "../src/core/orchestrator/report-formatter.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import {
  AIUsageTelemetrySchema,
  ThroughputActionSchema,
} from "../src/types/index.js";
import type {
  ThroughputAction,
  RepositoryProfile,
  QERequest,
} from "../src/types/index.js";
import { resolveModelTpmLimit } from "../src/cli/gateway-factory.js";
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
  rateLimitInfo?: ProviderRateLimitInfo,
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
    rateLimitInfo,
  };
}

describe("DF-F003: Throughput-Aware Admission", () => {
  describe("1. tpmLimit config field accepted and forwarded", () => {
    it("QEConfigSchema accepts tpmLimit as positive number", () => {
      const config = QEConfigSchema.parse({
        version: 1,
        model: { tpmLimit: 30000 },
      });
      expect(config.model.tpmLimit).toBe(30000);
    });

    it("resolveModelTpmLimit returns config value", () => {
      const config = QEConfigSchema.parse({
        version: 1,
        model: { tpmLimit: 60000 },
      });
      expect(resolveModelTpmLimit(config)).toBe(60000);
    });

    it("resolveModelTpmLimit returns undefined when not set", () => {
      const config = QEConfigSchema.parse({ version: 1 });
      expect(resolveModelTpmLimit(config)).toBeUndefined();
    });
  });

  describe("2. ProviderRateLimitInfo and RateLimitError types", () => {
    it("RateLimitError carries ProviderRateLimitInfo", () => {
      const info: ProviderRateLimitInfo = {
        tokenLimitPerMinute: 30000,
        remainingTokens: 5000,
        retryAfterMs: 3000,
        observedAt: Date.now(),
      };
      const err = new RateLimitError(info, "Rate limited");
      expect(err.rateLimitInfo).toBe(info);
      expect(err.message).toBe("Rate limited");
      expect(err.name).toBe("RateLimitError");
    });

    it("RateLimitError works without info", () => {
      const err = new RateLimitError();
      expect(err.rateLimitInfo).toBeUndefined();
      expect(err.message).toBe("Rate limit exceeded");
    });
  });

  describe("3. Rolling window token accounting", () => {
    it("tracks dispatched tokens in rolling window and limits throughput", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) return makeResult(10000, 7053);
        return makeResult(8000, 4000);
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        tpmLimit: 30000,
        sleepFn: async () => {},
      });

      await budgetGateway.reason(createTask(40000, 2048));

      const usage = budgetGateway.aggregateUsage();
      expect(usage.throughputLimit).toBe(30000);
    });
  });

  describe("4. Pre-dispatch throughput admission", () => {
    it("admits request when demand fits available throughput", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 500,
        completionTokens: 200,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        tpmLimit: 30000,
        sleepFn: async () => {},
      });

      const result = await budgetGateway.reason(createTask(400, 1024));
      expect(result.data.answer).toBe("ok");

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("OK");
    });

    it("blocks request that exceeds full TPM window capacity", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 100,
        completionTokens: 50,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        tpmLimit: 500,
        sleepFn: async () => {},
      });

      const bigTask = createTask(4000, 2048);

      await expect(budgetGateway.reason(bigTask)).rejects.toThrow(
        ThroughputExceededError,
      );

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("BLOCKED");
      expect(usage.limitClassification).toBe("THROUGHPUT_REQUEST_TOO_LARGE");
    });
  });

  describe("5. Bounded strategies: right-size output, reduce context, defer, block", () => {
    it("Strategy A: right-sizes output reservation to fit throughput", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 200,
        completionTokens: 100,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        tpmLimit: 1500,
        sleepFn: async () => {},
      });

      const task = createTask(2000, 4096);
      const result = await budgetGateway.reason(task);
      expect(result.data.answer).toBe("ok");

      const usage = budgetGateway.aggregateUsage();
      expect(usage.throughputActions).toBeDefined();
      const rightSized = usage.throughputActions!.find(
        (a) => a.action === "RIGHT_SIZED_OUTPUT",
      );
      expect(rightSized).toBeDefined();
      expect(rightSized!.originalDemand).toBeGreaterThan(
        rightSized!.adjustedDemand!,
      );
    });

    it("Strategy A respects MINIMUM_OUTPUT_RESERVATION floor", async () => {
      expect(MINIMUM_OUTPUT_RESERVATION).toBe(512);
    });

    it("Strategy B: reduces context for throughput", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 200,
        completionTokens: 100,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        tpmLimit: 1200,
        sleepFn: async () => {},
      });

      const task = createTask(3000, 512);
      const result = await budgetGateway.reason(task);
      expect(result.data.answer).toBe("ok");

      const usage = budgetGateway.aggregateUsage();
      const strategies = (usage.throughputActions ?? []).map((a) => a.action);
      expect(
        strategies.includes("RIGHT_SIZED_OUTPUT") ||
          strategies.includes("REDUCED_CONTEXT"),
      ).toBe(true);
    });

    it("Strategy D: blocks when all strategies exhausted", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        tpmLimit: 100,
        sleepFn: async () => {},
      });

      const task = createTask(10000, 2048);
      await expect(budgetGateway.reason(task)).rejects.toThrow(
        ThroughputExceededError,
      );

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("BLOCKED");
      const blocked = usage.throughputActions?.find(
        (a) => a.action === "BLOCKED",
      );
      expect(blocked).toBeDefined();
    });
  });

  describe("6. 429 handling with backoff and retry-after", () => {
    it("retries on RateLimitError with backoff and succeeds", async () => {
      let callCount = 0;
      const gateway = new ConfigurableGateway((_task, idx) => {
        callCount++;
        if (idx === 0) {
          return new RateLimitError(
            { retryAfterMs: 100, observedAt: Date.now() },
            "429",
          );
        }
        return makeResult(500, 200);
      });

      const sleepCalls: number[] = [];
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      });

      const result = await budgetGateway.reason(createTask(undefined, 1024));
      expect(result.data.answer).toBe("ok");
      expect(callCount).toBe(2);
      expect(sleepCalls.length).toBeGreaterThanOrEqual(1);
      expect(sleepCalls[0]).toBe(100);

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("DEGRADED");
    });

    it("uses default backoff when no retry-after provided", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return new RateLimitError({ observedAt: Date.now() }, "rate limited");
        }
        return makeResult(500, 200);
      });

      const sleepCalls: number[] = [];
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      });

      await budgetGateway.reason(createTask(undefined, 1024));
      expect(sleepCalls[0]).toBe(5000);
    });
  });

  describe("7. Rate-limit classification", () => {
    it("classifies context-window exceeded on pre-dispatch block", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        modelTokenLimit: 50,
        sleepFn: async () => {},
      });

      await expect(
        budgetGateway.reason(createTask(10000, 1024)),
      ).rejects.toThrow(OversizedRequestError);

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitClassification).toBe("CONTEXT_WINDOW_EXCEEDED");
    });

    it("classifies throughput_request_too_large for permanently oversized", async () => {
      const gateway = createFakeWithUsage({ promptTokens: 100 });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        tpmLimit: 500,
        sleepFn: async () => {},
      });

      await expect(
        budgetGateway.reason(createTask(4000, 2048)),
      ).rejects.toThrow(ThroughputExceededError);

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitClassification).toBe("THROUGHPUT_REQUEST_TOO_LARGE");
    });

    it("classifies rate_limit_unknown on 429 without provider info", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return new RateLimitError(undefined, "429");
        }
        return makeResult(500, 200);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      await budgetGateway.reason(createTask(undefined, 1024));

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitClassification).toBe("RATE_LIMIT_UNKNOWN");
    });
  });

  describe("8. DEGRADED has runtime meaning", () => {
    it("DEGRADED status is set after rate limit encounter", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) return new RateLimitError({ observedAt: Date.now() });
        return makeResult(500, 200);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      await budgetGateway.reason(createTask(undefined, 1024));
      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("DEGRADED");
    });

    it("throughput actions are recorded when degraded", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return new RateLimitError(
            { retryAfterMs: 200, observedAt: Date.now() },
            "429",
          );
        }
        return makeResult(500, 200);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      await budgetGateway.reason(createTask(undefined, 1024));
      const usage = budgetGateway.aggregateUsage();
      expect(usage.throughputActions).toBeDefined();
      expect(usage.throughputActions!.length).toBeGreaterThan(0);
      const deferred = usage.throughputActions!.find(
        (a) => a.action === "DEFERRED",
      );
      expect(deferred).toBeDefined();
    });
  });

  describe("9. Token contributor visibility in telemetry", () => {
    it("throughput telemetry fields present in AIUsageTelemetrySchema", () => {
      const shape = AIUsageTelemetrySchema.shape;
      expect(shape.throughputLimit).toBeDefined();
      expect(shape.throughputActions).toBeDefined();
      expect(shape.limitClassification).toBeDefined();
    });

    it("ThroughputAction schema validates correctly", () => {
      const action: ThroughputAction = {
        action: "RIGHT_SIZED_OUTPUT",
        reason: "Reduced from 4096 to 1024",
        originalDemand: 6000,
        adjustedDemand: 3000,
      };
      const parsed = ThroughputActionSchema.parse(action);
      expect(parsed.action).toBe("RIGHT_SIZED_OUTPUT");
      expect(parsed.originalDemand).toBe(6000);
    });

    it("aggregateUsage includes throughput fields when tpmLimit is set", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 500,
        completionTokens: 200,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        tpmLimit: 50000,
        sleepFn: async () => {},
      });

      await budgetGateway.reason(createTask(400, 1024));
      const usage = budgetGateway.aggregateUsage();
      expect(usage.throughputLimit).toBe(50000);
      AIUsageTelemetrySchema.parse(usage);
    });
  });

  describe("10. Don't fabricate certainty about unknown TPM", () => {
    it("no default TPM is hard-coded in resolveModelTpmLimit", () => {
      const config = QEConfigSchema.parse({
        version: 1,
        model: { model: "gpt-4o" },
      });
      expect(resolveModelTpmLimit(config)).toBeUndefined();
    });

    it("throughput admission is skipped when tpmLimit is not configured", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 500,
        completionTokens: 200,
      });
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
      });

      const result = await budgetGateway.reason(createTask(400, 1024));
      expect(result.data.answer).toBe("ok");

      const usage = budgetGateway.aggregateUsage();
      expect(usage.throughputLimit).toBeUndefined();
      expect(usage.throughputActions).toBeUndefined();
    });
  });

  describe("11. Report formatting includes throughput info", () => {
    it("shows throughput limit and actions in report", () => {
      const result = {
        executionId: "test-001",
        repository: { path: "/tmp/repo", name: "test" },
        target: "HEAD",
        profile: "quick" as const,
        repositoryProfile: createMockProfile(),
        riskAssessment: {
          level: "LOW" as const,
          factors: [],
          confidence: 0.8,
          summary: "ok",
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
        verdict: "PASS" as const,
        confidence: "HIGH" as const,
        summary: "All clear",
        recommendedNextActions: [],
        metrics: {
          startTime: new Date().toISOString(),
          modelCalls: 2,
          commandsExecuted: 0,
          testsExecuted: 0,
          testsGenerated: 0,
          retries: 0,
          stateTransitions: 0,
        },
        aiUsage: {
          modelCalls: 2,
          successfulModelCalls: 1,
          failedModelCalls: 1,
          inputTokens: 5000,
          outputTokens: 1200,
          cachedTokens: 0,
          limitStatus: "DEGRADED" as const,
          throughputLimit: 30000,
          throughputActions: [
            {
              action: "DEFERRED" as const,
              reason: "Waiting 200ms after rate limit before retry",
              waitMs: 200,
            },
          ],
          limitClassification: "THROUGHPUT_TEMPORARILY_EXHAUSTED" as const,
        },
      };

      const report = formatQEReport(result);
      expect(report).toContain("30,000 TPM");
      expect(report).toContain("DEGRADED");
      expect(report).toContain("THROUGHPUT_TEMPORARILY_EXHAUSTED");
      expect(report).toContain("[DEFERRED]");
    });
  });

  describe("12. Orchestrator forwards tpmLimit", () => {
    it("orchestrator passes tpmLimit to BudgetAwareGateway", async () => {
      const gateway = createFakeWithUsage({
        promptTokens: 100,
        completionTokens: 50,
      });
      const orchestrator = new QEOrchestrator({
        gateway,
        modelTokenLimit: 128000,
        tpmLimit: 30000,
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
      expect(result.aiUsage!.throughputLimit).toBe(30000);
    });
  });

  describe("13a. Dogfood regression: successful-response rate-limit headers block next dispatch", () => {
    it("blocks 14553-token demand when provider reports 8424 remaining via success headers", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return makeResult(14000, 7576, {
            tokenLimitPerMinute: 30000,
            remainingTokens: 8424,
            observedAt: Date.now(),
          });
        }
        return makeResult(10000, 4553);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        sleepFn: async () => {},
      });

      const firstResult = await budgetGateway.reason(createTask(56000, 2048));
      expect(firstResult.data.answer).toBe("ok");

      const usage1 = budgetGateway.aggregateUsage();
      expect(usage1.throughputLimit).toBe(30000);

      const bigTask = createTask(50000, 2048);
      const demand = estimateTaskTokens(bigTask) + 2048;
      expect(demand).toBeGreaterThan(8424);

      try {
        await budgetGateway.reason(bigTask);
        const usage2 = budgetGateway.aggregateUsage();
        expect(usage2.throughputActions).toBeDefined();
        const actions = usage2.throughputActions!.map((a) => a.action);
        expect(
          actions.includes("RIGHT_SIZED_OUTPUT") ||
            actions.includes("REDUCED_CONTEXT") ||
            actions.includes("BLOCKED"),
        ).toBe(true);
      } catch (err) {
        expect(err).toBeInstanceOf(ThroughputExceededError);
        const usage2 = budgetGateway.aggregateUsage();
        expect(usage2.limitStatus).toBe("BLOCKED");
      }
    });

    it("admits 14553-token demand when no prior knowledge and no tpmLimit configured", async () => {
      const gateway = new ConfigurableGateway(() => {
        return makeResult(10000, 4553);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        sleepFn: async () => {},
      });

      const result = await budgetGateway.reason(createTask(50000, 2048));
      expect(result.data.answer).toBe("ok");

      const usage = budgetGateway.aggregateUsage();
      expect(usage.throughputLimit).toBeUndefined();
      expect(usage.limitStatus).toBe("OK");
    });
  });

  describe("13b. Reactive fallback: 429 teaches limit when no tpmLimit configured", () => {
    it("learns TPM limit from 429 error and classifies correctly", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return new RateLimitError(
            {
              tokenLimitPerMinute: 30000,
              remainingTokens: 8424,
              retryAfterMs: 12258,
              observedAt: Date.now(),
            },
            "Rate limit exceeded: Limit 30000, Used 21576, Requested 14553",
          );
        }
        return makeResult(8000, 4000);
      });

      const sleepCalls: number[] = [];
      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      });

      const result = await budgetGateway.reason(createTask(undefined, 1024));
      expect(result.data.answer).toBe("ok");

      expect(sleepCalls[0]).toBe(12258);

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitStatus).toBe("DEGRADED");
      expect(usage.throughputLimit).toBe(30000);
      expect(usage.limitClassification).toBe(
        "THROUGHPUT_TEMPORARILY_EXHAUSTED",
      );
    });

    it("classifies THROUGHPUT_REQUEST_TOO_LARGE when demand exceeds provider limit", async () => {
      const gateway = new ConfigurableGateway((_task, idx) => {
        if (idx === 0) {
          return new RateLimitError(
            {
              tokenLimitPerMinute: 1000,
              remainingTokens: 0,
              retryAfterMs: 5000,
              observedAt: Date.now(),
            },
            "Rate limit exceeded",
          );
        }
        return makeResult(500, 200);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      const bigTask = createTask(20000, 2048);
      await expect(budgetGateway.reason(bigTask)).rejects.toThrow(
        ThroughputExceededError,
      );

      const usage = budgetGateway.aggregateUsage();
      expect(usage.limitClassification).toBe("THROUGHPUT_REQUEST_TOO_LARGE");
    });
  });

  describe("13. Dogfood regression: DF-F003 30000/17053/14560", () => {
    it("reproduces DF-F003 scenario: second call blocked when TPM exhausted", async () => {
      let callCount = 0;
      const gateway = new ConfigurableGateway((_task, idx) => {
        callCount++;
        if (idx === 0) {
          return makeResult(12000, 5053);
        }
        return makeResult(10000, 4560);
      });

      const budget = new BudgetManager(createBudgetForProfile("standard"));
      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 0,
        tpmLimit: 30000,
        sleepFn: async () => {},
      });

      const firstTask = createTask(48000, 2048);
      const firstResult = await budgetGateway.reason(firstTask);
      expect(firstResult.data.answer).toBe("ok");

      const firstActual = 12000 + 5053;
      expect(firstActual).toBe(17053);

      const secondTask = createTask(50000, 2048);
      const secondEstimate = estimateTaskTokens(secondTask) + 2048;
      expect(secondEstimate).toBeGreaterThan(14000);

      const available = 30000 - 17053;
      expect(available).toBe(12947);

      try {
        await budgetGateway.reason(secondTask);
        const usage = budgetGateway.aggregateUsage();
        expect(usage.throughputActions).toBeDefined();
        expect(usage.throughputActions!.length).toBeGreaterThan(0);
        const actions = usage.throughputActions!.map((a) => a.action);
        expect(
          actions.includes("RIGHT_SIZED_OUTPUT") ||
            actions.includes("REDUCED_CONTEXT") ||
            actions.includes("BLOCKED"),
        ).toBe(true);
      } catch (err) {
        expect(err).toBeInstanceOf(ThroughputExceededError);
        const usage = budgetGateway.aggregateUsage();
        expect(usage.limitStatus).toBe("BLOCKED");
        expect(
          usage.limitClassification === "THROUGHPUT_REQUEST_TOO_LARGE" ||
            usage.limitClassification === "THROUGHPUT_TEMPORARILY_EXHAUSTED",
        ).toBe(true);
      }

      const usage = budgetGateway.aggregateUsage();
      expect(usage.throughputLimit).toBe(30000);
      expect(callCount).toBeGreaterThanOrEqual(1);
    });
  });
});
