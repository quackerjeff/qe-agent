import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import {
  SchemaValidationError,
  OutputTruncationError,
  ProviderTimeoutError,
  RateLimitError,
} from "../src/models/gateway/types.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
  VERDICT_TIME_RESERVE_MS,
} from "../src/core/orchestrator/budget-manager.js";
import {
  analyzeGapsChunked,
  MAX_REQUIREMENTS_PER_GAP_CHUNK,
} from "../src/core/reasoning/gap-analyzer.js";
import type {
  Evidence,
  Requirement,
  RiskAssessment,
} from "../src/types/index.js";
import { persistDiagnostics } from "../src/core/orchestrator/diagnostics.js";
import type { RunDiagnostics } from "../src/core/orchestrator/diagnostics.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

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
  cached?: number,
): ModelResult<{ answer: string }> {
  return {
    data: { answer: "ok" },
    usage: {
      promptTokens,
      completionTokens,
      cachedTokens: cached,
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

function makeRequirements(count: number): Requirement[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `FR-${String(i + 1).padStart(3, "0")}`,
    description: `Requirement ${i + 1}`,
  }));
}

function makeRiskAssessment(): RiskAssessment {
  return {
    level: "MEDIUM",
    factors: [
      { factor: "change_scope", reason: "Moderate changes", weight: "medium" },
    ],
    confidence: 0.7,
    summary: "Medium risk",
  };
}

function makeGapModelResult(reqIds: string[]) {
  return {
    data: {
      gaps: [],
      requirementAssessments: reqIds.map((id) => ({
        requirementId: id,
        status: "NOT_VERIFIED" as const,
        evidenceIds: [],
        explanation: "No evidence",
      })),
    },
    usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    model: "test",
    provider: "fake",
    durationMs: 100,
    startedAt: new Date().toISOString(),
    retryCount: 0,
    promptVersion: "v1",
  };
}

// ─── Section 1: Diagnostic capture does not alter model-call accounting ───

describe("DF-002 Diagnostics: Model-call accounting unchanged", () => {
  it("successful call produces identical callMetadata with diagnostics", async () => {
    const gateway = new ConfigurableGateway(() => makeResult(500, 300));
    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask(2048));

    expect(budgetGateway.callMetadata).toHaveLength(1);
    expect(budgetGateway.callMetadata[0].success).toBe(true);
    expect(budgetGateway.callMetadata[0].role).toBe("test-analyst");

    expect(budgetGateway.diagnosticAttempts).toHaveLength(1);
    expect(budgetGateway.diagnosticAttempts[0].success).toBe(true);
    expect(budgetGateway.diagnosticAttempts[0].role).toBe("test-analyst");
    expect(budgetGateway.diagnosticAttempts[0].finishReason).toBe("stop");
  });

  it("callMetadata count equals diagnosticAttempts count for success+retry scenario", async () => {
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

    expect(budgetGateway.callMetadata).toHaveLength(2);
    expect(budgetGateway.diagnosticAttempts).toHaveLength(2);

    expect(budgetGateway.callMetadata[0].success).toBe(false);
    expect(budgetGateway.callMetadata[1].success).toBe(true);
    expect(budgetGateway.diagnosticAttempts[0].success).toBe(false);
    expect(budgetGateway.diagnosticAttempts[1].success).toBe(true);
  });

  it("aggregateUsage unchanged by diagnostic capture", async () => {
    const gateway = new ConfigurableGateway(() => makeResult(500, 300));
    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask(2048));

    const usage = budgetGateway.aggregateUsage();
    expect(usage.modelCalls).toBe(1);
    expect(usage.successfulModelCalls).toBe(1);
    expect(usage.failedModelCalls).toBe(0);
    expect(usage.inputTokens).toBe(500);
    expect(usage.outputTokens).toBe(300);
  });
});

// ─── Section 2: Diagnostic capture does not alter retry accounting ───

describe("DF-002 Diagnostics: Retry accounting unchanged", () => {
  it("retry budget consumption identical with diagnostics", async () => {
    const gateway = new ConfigurableGateway(() => {
      return new SchemaValidationError('{"wrong": true}', "answer: Required", {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
    });

    const budgetConfig = createBudgetForProfile("quick");
    const budget = new BudgetManager(budgetConfig);
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 3,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow();

    expect(budget.retries).toBe(1);
    expect(budget.modelCalls).toBe(0);
  });

  it("retry denied diagnostic recorded without altering budget state", async () => {
    const gateway = new ConfigurableGateway(() => {
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

    const denied = budgetGateway.diagnosticAttempts.filter(
      (d) => d.retryAdmitted === false,
    );
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(denied[0].errorClass).toBe("RetryBudgetExhausted");
    expect(budget.retries).toBe(1);
  });
});

// ─── Section 3: Diagnostic capture does not alter timeout behavior ───

describe("DF-002 Diagnostics: Timeout behavior unchanged", () => {
  it("ProviderTimeoutError diagnostic captures timeout and remaining budget", async () => {
    const gateway = new ConfigurableGateway(() => {
      return new ProviderTimeoutError(30000, 30000);
    });

    const budget = new BudgetManager(createBudgetForProfile("standard"));
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow(
      ProviderTimeoutError,
    );

    expect(budgetGateway.diagnosticAttempts).toHaveLength(1);
    const diag = budgetGateway.diagnosticAttempts[0];
    expect(diag.success).toBe(false);
    expect(diag.errorClass).toBe("ProviderTimeoutError");
    expect(diag.remainingMs).toBeGreaterThan(0);
    expect(diag.callDeadlineReserveMs).toBe(VERDICT_TIME_RESERVE_MS);
    expect(diag.timeoutMs).toBe(diag.remainingMs - diag.callDeadlineReserveMs);
  });

  it("insufficient timeout diagnostic does not make a provider call", async () => {
    let callCount = 0;
    const gateway = new ConfigurableGateway(() => {
      callCount++;
      return makeResult(500, 300);
    });

    vi.useFakeTimers();
    try {
      const budget = new BudgetManager({
        maxDurationMs: VERDICT_TIME_RESERVE_MS + 1000,
        maxModelCalls: 20,
      });
      budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

      vi.advanceTimersByTime(VERDICT_TIME_RESERVE_MS - 3000);

      const budgetGateway = new BudgetAwareGateway(gateway, budget, {
        maxRetriesPerCall: 2,
        sleepFn: async () => {},
      });

      await expect(budgetGateway.reason(createTask())).rejects.toThrow();

      expect(callCount).toBe(0);
      const insufficientDiags = budgetGateway.diagnosticAttempts.filter(
        (d) => d.errorClass === "InsufficientTimeout",
      );
      expect(insufficientDiags).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Section 4: Diagnostic capture records error classes correctly ───

describe("DF-002 Diagnostics: Error class capture", () => {
  it("captures OutputTruncationError with finishReason length", async () => {
    const gateway = new ConfigurableGateway(() => {
      return new OutputTruncationError('{"partial": true}', 2048, {
        promptTokens: 500,
        completionTokens: 2048,
        totalTokens: 2548,
      });
    });

    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow();

    const diag = budgetGateway.diagnosticAttempts[0];
    expect(diag.errorClass).toBe("OutputTruncationError");
    expect(diag.finishReason).toBe("length");
    expect(diag.outputTokens).toBe(2048);
  });

  it("captures SchemaValidationError without finishReason", async () => {
    const gateway = new ConfigurableGateway(() => {
      return new SchemaValidationError('{"wrong": true}', "answer: Required", {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      });
    });

    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow();

    const diag = budgetGateway.diagnosticAttempts[0];
    expect(diag.errorClass).toBe("SchemaValidationError");
    expect(diag.finishReason).toBeUndefined();
    expect(diag.inputTokens).toBe(500);
  });

  it("captures RateLimitError", async () => {
    const gateway = new ConfigurableGateway(() => {
      return new RateLimitError(undefined, "Too many requests");
    });

    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    await expect(budgetGateway.reason(createTask())).rejects.toThrow();

    const diag = budgetGateway.diagnosticAttempts[0];
    expect(diag.errorClass).toBe("RateLimitError");
  });

  it("successful call has finishReason stop", async () => {
    const gateway = new ConfigurableGateway(() => makeResult(500, 300, 100));
    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask(2048));

    const diag = budgetGateway.diagnosticAttempts[0];
    expect(diag.finishReason).toBe("stop");
    expect(diag.cachedTokens).toBe(100);
  });
});

// ─── Section 5: Diagnostic capture records budget state at dispatch ───

describe("DF-002 Diagnostics: Budget state capture", () => {
  it("records remainingMs and callDeadlineReserveMs at dispatch time", async () => {
    const gateway = new ConfigurableGateway(() => makeResult(500, 300));
    const budget = new BudgetManager(createBudgetForProfile("standard"));
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    await budgetGateway.reason(createTask(2048));

    const diag = budgetGateway.diagnosticAttempts[0];
    expect(diag.remainingMs).toBeGreaterThan(0);
    expect(diag.callDeadlineReserveMs).toBe(VERDICT_TIME_RESERVE_MS);
    expect(diag.timeoutMs).toBe(diag.remainingMs - VERDICT_TIME_RESERVE_MS);
  });

  it("records attemptIndex for retries", async () => {
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

    expect(budgetGateway.diagnosticAttempts[0].attemptIndex).toBe(0);
    expect(budgetGateway.diagnosticAttempts[0].retryAttempted).toBe(false);
    expect(budgetGateway.diagnosticAttempts[1].attemptIndex).toBe(1);
    expect(budgetGateway.diagnosticAttempts[1].retryAttempted).toBe(true);
    expect(budgetGateway.diagnosticAttempts[1].retryAdmitted).toBe(true);
  });
});

// ─── Section 6: Gap chunk diagnostics capture raw model output ───

describe("DF-002 Diagnostics: Gap chunk raw assessments", () => {
  it("captures raw assessments for successful chunks before validation", async () => {
    const requirements = makeRequirements(25);
    const evidence: Evidence[] = [
      {
        id: "ev-test",
        type: "TEST_RESULT",
        provenance: "executed",
        timestamp: new Date().toISOString(),
        source: "test",
        status: "PASS",
        summary: "Tests passed",
      },
    ];

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r: { id: string }) => r.id);
        const result = makeGapModelResult(reqIds);
        return result as unknown as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      requirements,
      evidence,
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    expect(result.chunkDiagnostics).toBeDefined();
    expect(result.chunkDiagnostics!.length).toBe(2);

    const chunk0 = result.chunkDiagnostics![0];
    expect(chunk0.chunkIndex).toBe(0);
    expect(chunk0.success).toBe(true);
    expect(chunk0.requestedRequirementIds).toHaveLength(
      MAX_REQUIREMENTS_PER_GAP_CHUNK,
    );
    expect(chunk0.rawAssessments).toBeDefined();
    expect(chunk0.rawAssessments!.length).toBeGreaterThan(0);

    for (const assessment of chunk0.rawAssessments!) {
      expect(assessment).toHaveProperty("requirementId");
      expect(assessment).toHaveProperty("status");
      expect(assessment).toHaveProperty("evidenceIds");
      expect(assessment).toHaveProperty("explanation");
    }
  });

  it("captures error class for failed chunks", async () => {
    const requirements = makeRequirements(25);
    const evidence: Evidence[] = [];

    let callIndex = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callIndex++;
        if (callIndex > 1) {
          throw new ProviderTimeoutError(30000, 30000);
        }
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r: { id: string }) => r.id);
        return makeGapModelResult(reqIds) as unknown as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      requirements,
      evidence,
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    expect(result.chunkDiagnostics).toBeDefined();
    expect(result.chunkDiagnostics!.length).toBe(2);

    const successChunk = result.chunkDiagnostics!.find((d) => d.success);
    const failedChunk = result.chunkDiagnostics!.find((d) => !d.success);

    expect(successChunk).toBeDefined();
    expect(successChunk!.rawAssessments).toBeDefined();

    expect(failedChunk).toBeDefined();
    expect(failedChunk!.errorClass).toBe("ProviderTimeoutError");
    expect(failedChunk!.errorMessage).toBeDefined();
    expect(failedChunk!.rawAssessments).toBeUndefined();
  });

  it("chunk diagnostics do not alter assessment results", async () => {
    const requirements = makeRequirements(25);
    const evidence: Evidence[] = [];

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r: { id: string }) => r.id);
        return makeGapModelResult(reqIds) as unknown as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      requirements,
      evidence,
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    expect(result.requirementAssessments).toHaveLength(25);
    expect(result.chunksAttempted).toBe(2);
    expect(result.chunksSucceeded).toBe(2);
    expect(result.partial).toBe(false);

    for (const assessment of result.requirementAssessments) {
      expect(assessment.status).toBe("NOT_VERIFIED");
    }
  });

  it("raw assessments include evidence IDs from model output", async () => {
    const requirements = makeRequirements(5);
    const evidence: Evidence[] = [
      {
        id: "ev-disco",
        type: "DISCOVERY_RESULT",
        provenance: "observed",
        timestamp: new Date().toISOString(),
        source: "discovery",
        status: "OBSERVED",
        summary: "Repository discovered",
      },
    ];

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r: { id: string }) => r.id);
        const result = {
          data: {
            gaps: [],
            requirementAssessments: reqIds.map((id, i) => ({
              requirementId: id,
              status: i === 0 ? "VERIFIED" : "NOT_VERIFIED",
              evidenceIds: i === 0 ? ["ev-disco"] : [],
              explanation:
                i === 0 ? "Supported by ev-disco" : "No evidence available",
            })),
          },
          usage: {
            promptTokens: 500,
            completionTokens: 200,
            totalTokens: 700,
          },
          model: "test",
          provider: "fake",
          durationMs: 100,
          startedAt: new Date().toISOString(),
          retryCount: 0,
          promptVersion: "v1",
        };
        return result as unknown as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      requirements,
      evidence,
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.chunkDiagnostics).toBeDefined();
    const chunk = result.chunkDiagnostics![0];
    const verifiedAssessment = chunk.rawAssessments!.find(
      (a) => a.status === "VERIFIED",
    );
    expect(verifiedAssessment).toBeDefined();
    expect(verifiedAssessment!.evidenceIds).toContain("ev-disco");
  });
});

// ─── Section 7: Diagnostics persistence ───

describe("DF-002 Diagnostics: Persistence", () => {
  it("persists diagnostics.json to run directory", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "qe-diag-test-"));
    try {
      const diagnostics: RunDiagnostics = {
        executionId: "test-diag-001",
        timestamp: new Date().toISOString(),
        providerAttempts: [
          {
            role: "gap_analyst",
            attemptIndex: 0,
            timeoutMs: 35000,
            remainingMs: 55000,
            callDeadlineReserveMs: 20000,
            startedAt: new Date().toISOString(),
            durationMs: 100,
            success: true,
            finishReason: "stop",
            inputTokens: 500,
            outputTokens: 300,
            retryAttempted: false,
          },
        ],
        gapChunks: [
          {
            chunkIndex: 0,
            requestedRequirementIds: ["FR-001", "FR-002"],
            success: true,
            rawAssessments: [
              {
                requirementId: "FR-001",
                status: "VERIFIED",
                evidenceIds: ["ev-1"],
                explanation: "Supported",
              },
            ],
          },
        ],
      };

      const path = await persistDiagnostics(diagnostics, tmpDir, []);

      const content = await readFile(path, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.executionId).toBe("test-diag-001");
      expect(parsed.providerAttempts).toHaveLength(1);
      expect(parsed.gapChunks).toHaveLength(1);
      expect(parsed.gapChunks[0].rawAssessments).toHaveLength(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("redacts known secrets from persisted diagnostics", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "qe-diag-test-"));
    try {
      const secret = "sk-test-secret-key-12345";
      const diagnostics: RunDiagnostics = {
        executionId: "test-diag-002",
        timestamp: new Date().toISOString(),
        providerAttempts: [
          {
            role: "gap_analyst",
            attemptIndex: 0,
            timeoutMs: 35000,
            remainingMs: 55000,
            callDeadlineReserveMs: 20000,
            startedAt: new Date().toISOString(),
            durationMs: 100,
            success: false,
            errorClass: "ProviderTimeoutError",
            errorMessage: `Call failed with key ${secret}`,
            retryAttempted: false,
          },
        ],
        gapChunks: [],
      };

      const path = await persistDiagnostics(diagnostics, tmpDir, [secret]);

      const content = await readFile(path, "utf-8");
      expect(content).not.toContain(secret);
      expect(content).toContain("***");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── Section 8: Final result not affected by diagnostics ───

describe("DF-002 Diagnostics: Evidence semantics unchanged", () => {
  it("gap analysis result shape unchanged with diagnostics", async () => {
    const requirements = makeRequirements(10);
    const evidence: Evidence[] = [];

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r: { id: string }) => r.id);
        return makeGapModelResult(reqIds) as unknown as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      requirements,
      evidence,
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result).toHaveProperty("gaps");
    expect(result).toHaveProperty("requirementAssessments");
    expect(result).toHaveProperty("chunksAttempted");
    expect(result).toHaveProperty("chunksSucceeded");
    expect(result).toHaveProperty("partial");
    expect(result).toHaveProperty("chunkDiagnostics");

    expect(result.requirementAssessments).toHaveLength(10);
    expect(result.chunksSucceeded).toBe(1);
    expect(result.partial).toBe(false);
  });
});
