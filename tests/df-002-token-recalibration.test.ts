import { describe, it, expect } from "vitest";
import {
  calculateGapAnalysisMaxTokens,
  GAP_ANALYSIS_BASE_TOKENS,
  GAP_ANALYSIS_PER_REQUIREMENT_TOKENS,
  GAP_ANALYSIS_MAX_TOKENS,
  buildGapAnalysisTask,
} from "../src/prompts/gap-analysis/v1.js";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import {
  BudgetAwareGateway,
  estimateTaskTokens,
} from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
  VERDICT_TIME_RESERVE_MS,
} from "../src/core/orchestrator/budget-manager.js";
import { OutputTruncationError } from "../src/models/gateway/types.js";
import type { ModelGateway, ModelResult } from "../src/models/gateway/types.js";
import { GapAnalysisOutputSchema } from "../src/prompts/gap-analysis/v1.js";
import {
  analyzeGapsChunked,
  chunkRequirements,
  MAX_REQUIREMENTS_PER_GAP_CHUNK,
} from "../src/core/reasoning/gap-analyzer.js";
import { buildCandidateEvidenceMap } from "../src/core/reasoning/evidence-candidates.js";

describe("DF-002: Gap analysis output token recalibration", () => {
  it("Case 1: calculateGapAnalysisMaxTokens(19) is no longer 2032", () => {
    const maxTokens = calculateGapAnalysisMaxTokens(19);
    expect(maxTokens).not.toBe(2032);
    expect(maxTokens).toBe(
      GAP_ANALYSIS_BASE_TOKENS + 19 * GAP_ANALYSIS_PER_REQUIREMENT_TOKENS,
    );
  });

  it("Case 2: 19-requirement ceiling exceeds the largest observed complete response (2349 tokens)", () => {
    const maxTokens = calculateGapAnalysisMaxTokens(19);
    expect(maxTokens).toBeGreaterThan(2349);
  });

  it("Case 3: 19-requirement initial calls use recalibrated ceiling", () => {
    const requirements = Array.from({ length: 19 }, (_, i) => ({
      id: `FR-${String(i + 1).padStart(3, "0")}`,
      description: `Requirement ${i + 1}`,
    }));

    const task = buildGapAnalysisTask(
      requirements,
      [{ id: "e1", type: "TEST_RESULT", status: "PASS", summary: "passed" }],
      [],
      { level: "LOW", factors: [] },
    );

    expect(task.maxTokens).toBe(calculateGapAnalysisMaxTokens(19));
    expect(task.maxTokens).toBe(2602);
  });

  it("Case 4: smaller requirement sets scale with the existing formula", () => {
    expect(calculateGapAnalysisMaxTokens(1)).toBe(
      GAP_ANALYSIS_BASE_TOKENS + GAP_ANALYSIS_PER_REQUIREMENT_TOKENS,
    );
    expect(calculateGapAnalysisMaxTokens(5)).toBe(
      GAP_ANALYSIS_BASE_TOKENS + 5 * GAP_ANALYSIS_PER_REQUIREMENT_TOKENS,
    );
    expect(calculateGapAnalysisMaxTokens(10)).toBe(
      GAP_ANALYSIS_BASE_TOKENS + 10 * GAP_ANALYSIS_PER_REQUIREMENT_TOKENS,
    );
  });

  it("Case 5: OutputTruncationError behavior is unchanged", async () => {
    const gateway = new FakeModelGateway(() => {
      throw new OutputTruncationError("truncated", 2602, {
        promptTokens: 500,
        completionTokens: 2602,
        totalTokens: 3102,
      });
    });
    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
    });

    const task = buildGapAnalysisTask(
      [{ id: "FR-001", description: "test" }],
      [],
      [],
      { level: "LOW", factors: [] },
    );

    await expect(budgetGateway.reason(task)).rejects.toThrow(
      OutputTruncationError,
    );
  });

  it("Case 6: schema-repair token expansion doubles the recalibrated value", async () => {
    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: { maxTokens?: number }): Promise<ModelResult<T>> {
        callCount++;
        if (callCount === 1) {
          throw new OutputTruncationError("truncated", task.maxTokens ?? 2048, {
            promptTokens: 500,
            completionTokens: task.maxTokens ?? 2048,
            totalTokens: 500 + (task.maxTokens ?? 2048),
          });
        }
        expect(task.maxTokens).toBe(Math.min(2602 * 2, 16384));
        return {
          data: GapAnalysisOutputSchema.parse({
            gaps: [],
            requirementAssessments: [
              {
                requirementId: "FR-001",
                status: "NOT_VERIFIED",
                evidenceIds: [],
                explanation: "test",
              },
            ],
          }) as T,
          usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
          model: "test",
          provider: "fake",
          durationMs: 10,
          startedAt: new Date().toISOString(),
          retryCount: 0,
          promptVersion: "v1",
        };
      },
    };

    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
    });

    const task = buildGapAnalysisTask(
      [{ id: "FR-001", description: "test" }],
      [],
      [],
      { level: "LOW", factors: [] },
    );
    task.maxTokens = 2602;

    const result = await budgetGateway.reason(task);
    expect(callCount).toBe(2);
    expect(result.data).toBeDefined();
  });

  it("Case 7: retry-budget behavior is unchanged", async () => {
    const gateway = new FakeModelGateway(() => {
      throw new OutputTruncationError("truncated", 2602, {
        promptTokens: 500,
        completionTokens: 2602,
        totalTokens: 3102,
      });
    });
    const budget = new BudgetManager(createBudgetForProfile("quick"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
    });

    const task = buildGapAnalysisTask(
      [{ id: "FR-001", description: "test" }],
      [],
      [],
      { level: "LOW", factors: [] },
    );

    await expect(budgetGateway.reason(task)).rejects.toThrow();
    expect(budget.retries).toBe(1);
  });

  it("Case 8: parallel gap chunks share global quick-profile retry budget", async () => {
    let callIndex = 0;
    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        callIndex++;
        if (callIndex <= 2) {
          throw new OutputTruncationError("truncated", 2602, {
            promptTokens: 500,
            completionTokens: 2602,
            totalTokens: 3102,
          });
        }
        return {
          data: GapAnalysisOutputSchema.parse({
            gaps: [],
            requirementAssessments: [
              {
                requirementId: "FR-001",
                status: "NOT_VERIFIED",
                evidenceIds: [],
                explanation: "test",
              },
            ],
          }) as T,
          usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
          model: "test",
          provider: "fake",
          durationMs: 10,
          startedAt: new Date().toISOString(),
          retryCount: 0,
          promptVersion: "v1",
        };
      },
    };

    const budget = new BudgetManager(createBudgetForProfile("quick"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
    });

    const p1 = budgetGateway.reason(
      buildGapAnalysisTask([{ id: "FR-001", description: "test" }], [], [], {
        level: "LOW",
        factors: [],
      }),
    );
    const p2 = budgetGateway.reason(
      buildGapAnalysisTask([{ id: "FR-002", description: "test" }], [], [], {
        level: "LOW",
        factors: [],
      }),
    );

    const results = await Promise.allSettled([p1, p2]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    expect(succeeded + failed).toBe(2);
    expect(budget.retries).toBeLessThanOrEqual(1);
  });

  it("Case 9: gap chunk concurrency remains unchanged", () => {
    expect(MAX_REQUIREMENTS_PER_GAP_CHUNK).toBe(19);
    const reqs = Array.from({ length: 38 }, (_, i) => ({
      id: `FR-${i + 1}`,
      description: `req ${i + 1}`,
      acceptanceCriteria: [],
    }));
    const chunks = chunkRequirements(reqs);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(19);
    expect(chunks[1]).toHaveLength(19);
  });

  it("Case 10: verdict wall-clock reserve remains 20,000ms", () => {
    expect(VERDICT_TIME_RESERVE_MS).toBe(20_000);
    const budget = new BudgetManager(createBudgetForProfile("quick"));
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    expect(budget.callDeadlineReserveMs).toBe(20_000);
  });

  it("Case 11: throughput admission accounts for the larger estimated response demand", () => {
    const task = buildGapAnalysisTask(
      Array.from({ length: 19 }, (_, i) => ({
        id: `FR-${i + 1}`,
        description: `Requirement ${i + 1}`,
      })),
      [{ id: "e1", type: "TEST_RESULT", status: "PASS", summary: "passed" }],
      [],
      { level: "LOW", factors: [] },
    );

    const contextEstimate = estimateTaskTokens(task);
    const totalDemand = contextEstimate + task.maxTokens!;
    const oldDemand = contextEstimate + 2032;
    expect(totalDemand).toBeGreaterThan(oldDemand);
    expect(totalDemand - oldDemand).toBe(2602 - 2032);
  });

  it("Case 12: telemetry reports the recalibrated max response reservation", async () => {
    const gateway = new FakeModelGateway(() => ({
      gaps: [],
      requirementAssessments: [
        {
          requirementId: "FR-001",
          status: "NOT_VERIFIED",
          evidenceIds: [],
          explanation: "test",
        },
      ],
    }));
    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
    });

    const task = buildGapAnalysisTask(
      [{ id: "FR-001", description: "test" }],
      [],
      [],
      { level: "LOW", factors: [] },
    );

    await budgetGateway.reason(task);
    const usage = budgetGateway.aggregateUsage();
    expect(usage.maxResponseTokens).toBe(task.maxTokens);
    expect(usage.maxResponseTokens).toBe(
      GAP_ANALYSIS_BASE_TOKENS + GAP_ANALYSIS_PER_REQUIREMENT_TOKENS,
    );
  });

  it("Case 13: canonical completeness fallback unchanged when chunk fails", async () => {
    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        callCount++;
        throw new OutputTruncationError("truncated", 2602, {
          promptTokens: 500,
          completionTokens: 2602,
          totalTokens: 3102,
        });
      },
    };

    const reqs = Array.from({ length: 5 }, (_, i) => ({
      id: `FR-${i + 1}`,
      description: `Requirement ${i + 1}`,
      acceptanceCriteria: [],
    }));

    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
    });

    budget.recordModelCall();

    const result = await analyzeGapsChunked(
      budgetGateway,
      reqs,
      [],
      [],
      { level: "LOW", factors: [], confidence: 0.5, summary: "Low" },
      undefined,
      1,
      () => budget.recordModelCall(),
      () => {},
    );

    expect(result.requirementAssessments).toHaveLength(5);
    for (const a of result.requirementAssessments) {
      expect(a.status).toBe("NOT_VERIFIED");
    }
    expect(result.partial).toBe(true);
  });

  it("Case 14: candidate evidence mapping behavior is unchanged", () => {
    const candidates = buildCandidateEvidenceMap(
      [
        {
          id: "FR-009",
          description: "Existing Test Execution",
          acceptanceCriteria: [
            {
              id: "AC-1",
              description:
                "The system SHALL execute appropriate existing tests",
            },
          ],
        },
      ],
      [
        {
          id: "ev-test-1",
          type: "TEST_RESULT",
          summary: "Command npm run test succeeded",
        },
        {
          id: "ev-lifecycle",
          type: "LIFECYCLE_OBSERVATION",
          summary: "Run invoked via cli",
        },
      ],
    );

    const fr009Candidates = candidates.get("FR-009")!;
    expect(fr009Candidates).toContain("ev-test-1");
  });
});

describe("DF-002: Token recalibration — formula constants", () => {
  it("per-requirement tokens is 110", () => {
    expect(GAP_ANALYSIS_PER_REQUIREMENT_TOKENS).toBe(110);
  });

  it("base tokens unchanged at 512", () => {
    expect(GAP_ANALYSIS_BASE_TOKENS).toBe(512);
  });

  it("max cap unchanged at 16384", () => {
    expect(GAP_ANALYSIS_MAX_TOKENS).toBe(16384);
  });

  it("repair doubling stays within model limits", () => {
    const maxTokens19 = calculateGapAnalysisMaxTokens(19);
    const doubled = Math.min(maxTokens19 * 2, 16384);
    expect(doubled).toBe(5204);
    expect(doubled).toBeLessThanOrEqual(16384);
  });
});
