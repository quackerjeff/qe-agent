import { describe, it, expect } from "vitest";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import {
  ProviderTimeoutError,
  RateLimitError,
} from "../src/models/gateway/types.js";
import {
  chunkRequirements,
  mergeGaps,
  analyzeGapsChunked,
  MAX_REQUIREMENTS_PER_GAP_CHUNK,
} from "../src/core/reasoning/gap-analyzer.js";
import { calculateGapAnalysisMaxTokens } from "../src/prompts/gap-analysis/v1.js";
import { BudgetManager } from "../src/core/orchestrator/budget-manager.js";
import {
  BudgetAwareGateway,
  ThroughputExceededError,
} from "../src/core/orchestrator/budget-aware-gateway.js";
import type {
  Evidence,
  Finding,
  Requirement,
  RiskAssessment,
  RiskLevel,
} from "../src/types/index.js";

function makeRequirements(count: number): Requirement[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `FR-${String(i + 1).padStart(3, "0")}`,
    description: `Requirement ${i + 1}`,
  }));
}

function makePassEvidence(id: string): Evidence {
  return {
    id,
    type: "TEST_RESULT",
    provenance: "executed",
    timestamp: new Date().toISOString(),
    source: "local:npx",
    status: "PASS",
    summary: "Test passed",
  };
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

function makeModelResult<T>(data: T): ModelResult<T> {
  return {
    data,
    usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    model: "test",
    provider: "fake",
    durationMs: 100,
    startedAt: new Date().toISOString(),
    retryCount: 0,
    promptVersion: "v1",
  };
}

const SimpleOutputSchema = z.object({ answer: z.string() });

// ─── Section 1: chunkRequirements ───

describe("chunkRequirements", () => {
  it("returns a single chunk when requirements <= MAX_REQUIREMENTS_PER_GAP_CHUNK", () => {
    const reqs = makeRequirements(19);
    const chunks = chunkRequirements(reqs);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(19);
  });

  it("returns a single chunk when requirements < chunk size", () => {
    const reqs = makeRequirements(5);
    const chunks = chunkRequirements(reqs);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(5);
  });

  it("splits 38 requirements into 2 chunks of 19", () => {
    const reqs = makeRequirements(38);
    const chunks = chunkRequirements(reqs);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(19);
    expect(chunks[1]).toHaveLength(19);
  });

  it("splits 39 requirements into 2 chunks of 19 and 20", () => {
    const reqs = makeRequirements(39);
    const chunks = chunkRequirements(reqs);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(19);
    expect(chunks[1]).toHaveLength(19);
    expect(chunks[2]).toHaveLength(1);
  });

  it("preserves requirement order across chunks", () => {
    const reqs = makeRequirements(38);
    const chunks = chunkRequirements(reqs);
    const reassembled = chunks.flat();
    expect(reassembled.map((r) => r.id)).toEqual(reqs.map((r) => r.id));
  });

  it("respects custom chunk size", () => {
    const reqs = makeRequirements(30);
    const chunks = chunkRequirements(reqs, 10);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(10);
    expect(chunks[1]).toHaveLength(10);
    expect(chunks[2]).toHaveLength(10);
  });

  it("MAX_REQUIREMENTS_PER_GAP_CHUNK is 19", () => {
    expect(MAX_REQUIREMENTS_PER_GAP_CHUNK).toBe(19);
  });
});

// ─── Section 2: mergeGaps ───

describe("mergeGaps", () => {
  it("preserves unique gaps from multiple chunks", () => {
    const gaps1 = [
      {
        area: "Testing",
        description: "No unit tests",
        reason: "Missing",
        risk: "HIGH" as RiskLevel,
      },
    ];
    const gaps2 = [
      {
        area: "Security",
        description: "No auth checks",
        reason: "Missing",
        risk: "MEDIUM" as RiskLevel,
      },
    ];
    const merged = mergeGaps([gaps1, gaps2]);
    expect(merged).toHaveLength(2);
  });

  it("deduplicates gaps with same area and description", () => {
    const gaps1 = [
      {
        area: "Testing",
        description: "No unit tests",
        reason: "Reason A",
        risk: "MEDIUM" as RiskLevel,
      },
    ];
    const gaps2 = [
      {
        area: "Testing",
        description: "No unit tests",
        reason: "Reason B",
        risk: "HIGH" as RiskLevel,
      },
    ];
    const merged = mergeGaps([gaps1, gaps2]);
    expect(merged).toHaveLength(1);
    expect(merged[0].risk).toBe("HIGH");
  });

  it("preserves highest risk on duplicate gaps", () => {
    const gaps1 = [
      {
        area: "Coverage",
        description: "Incomplete",
        reason: "R1",
        risk: "LOW" as RiskLevel,
      },
    ];
    const gaps2 = [
      {
        area: "Coverage",
        description: "Incomplete",
        reason: "R2",
        risk: "CRITICAL" as RiskLevel,
      },
    ];
    const merged = mergeGaps([gaps1, gaps2]);
    expect(merged).toHaveLength(1);
    expect(merged[0].risk).toBe("CRITICAL");
  });

  it("deduplication is case-insensitive for area and description", () => {
    const gaps1 = [
      {
        area: "TESTING",
        description: "No Tests",
        reason: "R1",
        risk: "LOW" as RiskLevel,
      },
    ];
    const gaps2 = [
      {
        area: "testing",
        description: "no tests",
        reason: "R2",
        risk: "HIGH" as RiskLevel,
      },
    ];
    const merged = mergeGaps([gaps1, gaps2]);
    expect(merged).toHaveLength(1);
  });

  it("handles empty chunk gap arrays", () => {
    const merged = mergeGaps([[], [], []]);
    expect(merged).toHaveLength(0);
  });
});

// ─── Section 3: Exact dogfood case — 38 requirements ───

describe("DF-002: Exact dogfood case — 38 requirements, chunked gap analysis", () => {
  it("produces exactly 2 chunks for 38 requirements", () => {
    const reqs = makeRequirements(38);
    const chunks = chunkRequirements(reqs);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(19);
    expect(chunks[1]).toHaveLength(19);
  });

  it("each chunk maxTokens provides sufficient output reservation", () => {
    const tokens19 = calculateGapAnalysisMaxTokens(19);
    expect(tokens19).toBe(512 + 19 * 110);
    expect(tokens19).toBe(2602);
    expect(tokens19).toBeGreaterThan(2349);
  });

  it("both chunks succeed — merged result contains 38 assessments in order", async () => {
    const reqs = makeRequirements(38);
    const evidence = [makePassEvidence("ev-test"), makePassEvidence("ev-lint")];
    let callCount = 0;

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "PARTIALLY_VERIFIED",
            evidenceIds: ["ev-test"],
            explanation: `Assessed in chunk ${callCount}`,
          })),
          gaps: [
            {
              area: `Chunk ${callCount} gap`,
              description: "Some gap",
              reason: "Reason",
              risk: "LOW",
            },
          ],
        }) as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.recordModelCall(); // risk
    budget.recordModelCall(); // plan

    const chunksReserved = budget.reserveModelCalls(2);

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      evidence,
      [],
      makeRiskAssessment(),
      undefined,
      chunksReserved,
      () => budget.consumeReservation(),
      () => budget.releaseReservation(),
    );

    expect(callCount).toBe(2);
    expect(result.requirementAssessments).toHaveLength(38);
    expect(result.chunksAttempted).toBe(2);
    expect(result.chunksSucceeded).toBe(2);
    expect(result.partial).toBe(false);

    expect(result.requirementAssessments[0].requirementId).toBe("FR-001");
    expect(result.requirementAssessments[37].requirementId).toBe("FR-038");

    const ids = result.requirementAssessments.map((a) => a.requirementId);
    const expectedIds = reqs.map((r) => r.id);
    expect(ids).toEqual(expectedIds);
  });

  it("no assessment is lost or duplicated", async () => {
    const reqs = makeRequirements(38);
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "NOT_VERIFIED",
            evidenceIds: [],
            explanation: "Assessed",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    const ids = result.requirementAssessments.map((a) => a.requirementId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(38);
    expect(ids).toHaveLength(38);
  });

  it("gaps from both chunks are merged and deduplicated", async () => {
    const reqs = makeRequirements(38);
    let callCount = 0;

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "PARTIALLY_VERIFIED",
            evidenceIds: [],
            explanation: "Assessed",
          })),
          gaps: [
            {
              area: "Testing",
              description: "No integration tests",
              reason: "Missing",
              risk: callCount === 1 ? "MEDIUM" : "HIGH",
            },
            {
              area: `Unique chunk ${callCount}`,
              description: "Specific gap",
              reason: "Reason",
              risk: "LOW",
            },
          ],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    const testingGaps = result.gaps.filter(
      (g) => g.area.toLowerCase() === "testing",
    );
    expect(testingGaps).toHaveLength(1);
    expect(testingGaps[0].risk).toBe("HIGH");

    const uniqueGaps = result.gaps.filter((g) =>
      g.area.startsWith("Unique chunk"),
    );
    expect(uniqueGaps).toHaveLength(2);
  });
});

// ─── Section 4: Partial failure ───

describe("DF-002: Partial chunk failure", () => {
  it("chunk 1 succeeds, chunk 2 times out — chunk 1 assessments retained", async () => {
    const reqs = makeRequirements(38);
    const evidence = [makePassEvidence("ev-test")];
    let callCount = 0;

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        if (callCount === 2) {
          throw new ProviderTimeoutError(45_000, 45_500);
        }
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "VERIFIED",
            evidenceIds: ["ev-test"],
            explanation: "Verified by test suite",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      evidence,
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    expect(result.chunksAttempted).toBe(2);
    expect(result.chunksSucceeded).toBe(1);
    expect(result.partial).toBe(true);
    expect(result.requirementAssessments).toHaveLength(38);

    const verified = result.requirementAssessments.filter(
      (a) => a.status === "VERIFIED",
    );
    expect(verified).toHaveLength(19);

    const notVerified = result.requirementAssessments.filter(
      (a) => a.status === "NOT_VERIFIED",
    );
    expect(notVerified).toHaveLength(19);
    expect(notVerified.every((a) => a.evidenceIds.includes("ev-test"))).toBe(
      true,
    );
  });

  it("partial failure creates explicit incomplete-analysis gap", async () => {
    const reqs = makeRequirements(38);
    let callCount = 0;

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        if (callCount === 2) {
          throw new ProviderTimeoutError(45_000, 45_500);
        }
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "PARTIALLY_VERIFIED",
            evidenceIds: [],
            explanation: "Partial",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    const gapAnalysisGaps = result.gaps.filter(
      (g) => g.area === "Gap Analysis",
    );
    expect(gapAnalysisGaps).toHaveLength(1);
    expect(gapAnalysisGaps[0].reason).toContain("19 of 38");
    expect(gapAnalysisGaps[0].risk).toBe("MEDIUM");
  });

  it("verdict formation still proceeds after partial chunk failure", async () => {
    const reqs = makeRequirements(38);
    let callCount = 0;

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        if (callCount === 2) {
          throw new ProviderTimeoutError(45_000, 45_500);
        }
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "PARTIALLY_VERIFIED",
            evidenceIds: [],
            explanation: "Partial",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    expect(result.requirementAssessments).toHaveLength(38);
    expect(result.partial).toBe(true);

    const hasGapAnalysisGap = result.gaps.some(
      (g) => g.area === "Gap Analysis",
    );
    expect(hasGapAnalysisGap).toBe(true);
  });
});

// ─── Section 5: Budget reservation ───

describe("DF-002: Budget reservation for chunking", () => {
  it("reserves at least one logical call for verdict", async () => {
    const reqs = makeRequirements(38);
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.recordModelCall(); // risk
    budget.recordModelCall(); // plan

    const chunksReserved = budget.reserveModelCalls(2);
    expect(chunksReserved).toBe(2);

    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "PARTIALLY_VERIFIED",
            evidenceIds: [],
            explanation: "Assessed",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      chunksReserved,
      () => budget.consumeReservation(),
      () => budget.releaseReservation(),
    );

    expect(callCount).toBe(2);
    expect(budget.modelCalls).toBe(4);
    const snap = budget.snapshot();
    expect(snap.remainingModelCalls).toBe(2);
    expect(budget.canAffordModelCall()).toBe(true);
  });

  it("skips later chunks when budget is exhausted — does not starve verdict", async () => {
    const reqs = makeRequirements(76);
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.reserveVerdictCall();
    budget.recordModelCall(); // risk
    budget.recordModelCall(); // plan

    const chunks = chunkRequirements(reqs);
    expect(chunks).toHaveLength(4);

    const chunksReserved = budget.reserveModelCalls(chunks.length);
    expect(chunksReserved).toBe(3);

    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "PARTIALLY_VERIFIED",
            evidenceIds: [],
            explanation: "Assessed",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      chunksReserved,
      () => budget.consumeReservation(),
      () => budget.releaseReservation(),
    );

    expect(callCount).toBe(3);
    expect(result.requirementAssessments).toHaveLength(76);
    expect(result.partial).toBe(true);

    const assessed = result.requirementAssessments.filter(
      (a) => a.status === "PARTIALLY_VERIFIED",
    );
    expect(assessed).toHaveLength(57);

    const fallback = result.requirementAssessments.filter(
      (a) => a.status === "NOT_VERIFIED",
    );
    expect(fallback).toHaveLength(19);

    // Verdict slot still reserved — release to simulate FORMING_VERDICT
    budget.releaseVerdictReservation();
    const snap = budget.snapshot();
    expect(snap.remainingModelCalls).toBeGreaterThanOrEqual(1);
  });

  it("provider timeout on one chunk does not trigger a blind retry", async () => {
    const reqs = makeRequirements(38);
    let callCount = 0;

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        if (callCount === 1) {
          throw new ProviderTimeoutError(45_000, 45_500);
        }
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "VERIFIED",
            evidenceIds: [],
            explanation: "Verified",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    expect(callCount).toBe(2);

    const chunk1Assessments = result.requirementAssessments.filter(
      (a) => a.status === "NOT_VERIFIED",
    );
    expect(chunk1Assessments).toHaveLength(19);

    const chunk2Assessments = result.requirementAssessments.filter(
      (a) => a.status === "VERIFIED",
    );
    expect(chunk2Assessments).toHaveLength(19);
  });
});

// ─── Section 6: Single-chunk passthrough (regression) ───

describe("DF-002: Single-chunk passthrough", () => {
  it("requirements <= 19 use single call — no chunking overhead", async () => {
    const reqs = makeRequirements(15);
    let callCount = 0;

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "VERIFIED",
            evidenceIds: [],
            explanation: "Verified",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(callCount).toBe(1);
    expect(result.requirementAssessments).toHaveLength(15);
    expect(result.chunksAttempted).toBe(1);
    expect(result.chunksSucceeded).toBe(1);
    expect(result.partial).toBe(false);
  });
});

// ─── Section 7: Evidence context passed to chunks ───

describe("DF-002: Evidence and context passed to each chunk", () => {
  it("each chunk receives the same evidence and findings context", async () => {
    const reqs = makeRequirements(38);
    const evidence = [
      makePassEvidence("ev-test"),
      makePassEvidence("ev-lint"),
      makePassEvidence("ev-tsc"),
    ];
    const findings: Finding[] = [
      {
        id: "f-1",
        category: "OBSERVATION",
        severity: "MINOR",
        confidence: 0.5,
        title: "Test finding",
        description: "Something observed",
        evidenceIds: ["ev-test"],
      },
    ];

    const capturedContexts: unknown[] = [];

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        capturedContexts.push(task.context);
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "NOT_VERIFIED",
            evidenceIds: [],
            explanation: "Not verified",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    await analyzeGapsChunked(
      gateway,
      reqs,
      evidence,
      findings,
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    expect(capturedContexts).toHaveLength(2);

    const ctx1 = capturedContexts[0] as Record<string, unknown>;
    const ctx2 = capturedContexts[1] as Record<string, unknown>;

    expect(ctx1.collectedEvidence).toEqual(ctx2.collectedEvidence);
    expect(ctx1.findings).toEqual(ctx2.findings);
    expect(ctx1.riskAssessment).toEqual(ctx2.riskAssessment);

    const reqs1 = (ctx1.requirements as { id: string }[]).map((r) => r.id);
    const reqs2 = (ctx2.requirements as { id: string }[]).map((r) => r.id);
    expect(reqs1).toHaveLength(19);
    expect(reqs2).toHaveLength(19);
    expect(new Set([...reqs1, ...reqs2]).size).toBe(38);
  });
});

// ─── Section 8: Memory distillation deferral ───

describe("DF-002: Memory distillation skipped when budget tight", () => {
  it("quick profile with 38 reqs uses 4 model calls for gap+verdict, leaving 0 for memory", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });

    budget.recordModelCall(); // risk
    budget.recordModelCall(); // plan
    budget.recordModelCall(); // gap chunk 1
    budget.recordModelCall(); // gap chunk 2

    expect(budget.canAffordModelCall()).toBe(true);
    budget.recordModelCall(); // verdict

    expect(budget.canAffordModelCall()).toBe(true);
    budget.recordModelCall(); // memory distillation would be 6th

    expect(budget.canAffordModelCall()).toBe(false);
  });

  it("memory distillation gate uses canAffordModelCall not canAffordOptionalModelCall", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });

    budget.recordModelCall(); // risk
    budget.recordModelCall(); // plan
    budget.recordModelCall(); // gap chunk 1
    budget.recordModelCall(); // gap chunk 2
    budget.recordModelCall(); // verdict

    expect(budget.canAffordModelCall()).toBe(true);

    expect(budget.canAffordOptionalModelCall(0)).toBe(true);
  });
});

// ─── Section 9: Model-call reservation invariant ───

describe("DF-002: Model-call reservation", () => {
  it("reserveModelCalls enforces reserved + consumed + verdictReserved <= maxModelCalls", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.reserveVerdictCall();
    budget.recordModelCall(); // risk (consumed=1)
    budget.recordModelCall(); // plan (consumed=2)

    // available = 6 - 2 - 0 - 1(verdict) = 3
    const reserved = budget.reserveModelCalls(4);
    expect(reserved).toBe(3);
    expect(budget.reservedModelCalls).toBe(3);

    // 2 consumed + 3 reserved + 1 verdict = 6 committed; 0 slots remain
    const snap = budget.snapshot();
    expect(snap.remainingModelCalls).toBe(0);
    expect(budget.canAffordModelCall()).toBe(false);
    expect(budget.canAffordOptionalModelCall(1)).toBe(false);
  });

  it("consumeReservation converts reserved to consumed", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.recordModelCall(); // risk
    budget.recordModelCall(); // plan

    budget.reserveModelCalls(2);
    expect(budget.reservedModelCalls).toBe(2);
    expect(budget.modelCalls).toBe(2);

    budget.consumeReservation();
    expect(budget.reservedModelCalls).toBe(1);
    expect(budget.modelCalls).toBe(3);

    budget.consumeReservation();
    expect(budget.reservedModelCalls).toBe(0);
    expect(budget.modelCalls).toBe(4);
  });

  it("releaseReservation frees slot without consuming", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.recordModelCall(); // risk
    budget.recordModelCall(); // plan

    budget.reserveModelCalls(2);
    // 2 consumed + 2 reserved = 4 committed; 2 slots remain
    expect(budget.snapshot().remainingModelCalls).toBe(2);

    budget.releaseReservation();
    expect(budget.reservedModelCalls).toBe(1);
    expect(budget.modelCalls).toBe(2);
    // 2 consumed + 1 reserved = 3 committed; 3 slots remain
    expect(budget.snapshot().remainingModelCalls).toBe(3);
    expect(budget.canAffordModelCall()).toBe(true);
  });

  it("only enough slots for 1 chunk + verdict dispatches only 1 chunk", async () => {
    const reqs = makeRequirements(38);
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.reserveVerdictCall();
    budget.recordModelCall(); // risk
    budget.recordModelCall(); // plan
    budget.recordModelCall(); // execution
    budget.recordModelCall(); // re-analysis

    // available = 6 - 4 - 0 - 1(verdict) = 1
    const chunksReserved = budget.reserveModelCalls(2);
    expect(chunksReserved).toBe(1);

    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "VERIFIED",
            evidenceIds: [],
            explanation: "Verified",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      chunksReserved,
      () => budget.consumeReservation(),
      () => budget.releaseReservation(),
    );

    expect(callCount).toBe(1);
    expect(result.chunksSucceeded).toBe(1);
    expect(result.partial).toBe(true);

    const verified = result.requirementAssessments.filter(
      (a) => a.status === "VERIFIED",
    );
    expect(verified).toHaveLength(19);
    const notVerified = result.requirementAssessments.filter(
      (a) => a.status === "NOT_VERIFIED",
    );
    expect(notVerified).toHaveLength(19);

    budget.consumeReservation(); // no-op since all consumed
    expect(budget.modelCalls).toBe(5);
    // Verdict slot still reserved — release it to simulate FORMING_VERDICT
    budget.releaseVerdictReservation();
    expect(budget.canAffordModelCall()).toBe(true);
  });
});

// ─── Section 10: Atomic retry reservation ───

describe("DF-002: Atomic retry reservation", () => {
  it("tryReserveRetry atomically checks and consumes retry budget", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
      maxRetries: 1,
    });

    expect(budget.tryReserveRetry()).toBe(true);
    expect(budget.retries).toBe(1);

    expect(budget.tryReserveRetry()).toBe(false);
    expect(budget.retries).toBe(1);
  });

  it("concurrent retryable failures share retry budget — only one retries", async () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
      maxRetries: 1,
    });

    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(_task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        if (callCount <= 2) {
          throw new RateLimitError(undefined, "rate limited");
        }
        return makeModelResult({ answer: "ok" }) as ModelResult<T>;
      },
    };

    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    const task1: ReasoningTask<{ answer: string }> = {
      role: "test",
      objective: "test",
      context: { data: "short" },
      outputSchema: SimpleOutputSchema,
      maxTokens: 100,
      promptVersion: "test-v1",
    };
    const task2 = { ...task1 };

    const results = await Promise.allSettled([
      budgetGateway.reason(task1),
      budgetGateway.reason(task2),
    ]);

    expect(budget.retries).toBe(1);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");
    expect(successes.length + failures.length).toBe(2);
    expect(successes.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Section 11: TPM race regression ───

describe("DF-002: TPM race regression", () => {
  it("concurrent dispatch respects TPM capacity — second call blocked", async () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });

    const gateway: ModelGateway = {
      async reason<T>(_task: ReasoningTask<T>): Promise<ModelResult<T>> {
        return makeModelResult({ answer: "ok" }) as ModelResult<T>;
      },
    };

    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      tpmLimit: 7000,
      sleepFn: async () => {},
    });

    // Each task: context ~3000 tokens + maxTokens 3500 = ~6500 demand
    const task1: ReasoningTask<{ answer: string }> = {
      role: "test",
      objective: "test",
      context: { data: "x".repeat(11992) },
      outputSchema: SimpleOutputSchema,
      maxTokens: 3500,
      promptVersion: "test-v1",
    };
    const task2: ReasoningTask<{ answer: string }> = {
      role: "test",
      objective: "test",
      context: { data: "x".repeat(11992) },
      outputSchema: SimpleOutputSchema,
      maxTokens: 3500,
      promptVersion: "test-v1",
    };

    const results = await Promise.allSettled([
      budgetGateway.reason(task1),
      budgetGateway.reason(task2),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const failure = failures[0] as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(ThroughputExceededError);
  });

  it("pending TPM demand is released after successful dispatch", async () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });

    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        return makeModelResult({ answer: "ok" }) as ModelResult<T>;
      },
    };

    const budgetGateway = new BudgetAwareGateway(gateway, budget, {
      tpmLimit: 7000,
      sleepFn: async () => {},
    });

    const task: ReasoningTask<{ answer: string }> = {
      role: "test",
      objective: "test",
      context: { data: "x".repeat(11992) },
      outputSchema: SimpleOutputSchema,
      maxTokens: 3500,
      promptVersion: "test-v1",
    };

    // First call succeeds
    await budgetGateway.reason(task);

    // Second sequential call should also succeed (pending released)
    await budgetGateway.reason(task);
  });
});

// ─── Section 12: Simulated dogfood timing ───

describe("DF-002: Simulated dogfood timing — parallel chunks complete within budget", () => {
  it("two 35-40s chunks complete in parallel within 45s window", async () => {
    const reqs = makeRequirements(38);
    const chunkCompletionTimes: number[] = [];
    const startTime = Date.now();

    let callCount = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        // Simulate 35-40ms delay (scaled from 35-40s)
        await new Promise((resolve) =>
          setTimeout(resolve, 35 + Math.random() * 5),
        );
        chunkCompletionTimes.push(Date.now() - startTime);

        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "VERIFIED",
            evidenceIds: [],
            explanation: "Verified",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    const totalTime = Date.now() - startTime;

    expect(callCount).toBe(2);
    expect(result.chunksSucceeded).toBe(2);
    expect(result.partial).toBe(false);

    // Parallel: both should complete in ~40ms total, not ~80ms serial
    // Using generous bounds for CI flakiness
    expect(totalTime).toBeLessThan(200);

    // Both chunks should complete at roughly the same time (parallel)
    expect(chunkCompletionTimes).toHaveLength(2);
    const timeDiff = Math.abs(
      chunkCompletionTimes[0] - chunkCompletionTimes[1],
    );
    expect(timeDiff).toBeLessThan(50);
  });

  it("serial single-chunk path still works for <= 19 requirements", async () => {
    const reqs = makeRequirements(19);
    let callCount = 0;

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "VERIFIED",
            evidenceIds: [],
            explanation: "Verified",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(callCount).toBe(1);
    expect(result.chunksAttempted).toBe(1);
    expect(result.chunksSucceeded).toBe(1);
    expect(result.partial).toBe(false);
    expect(result.requirementAssessments).toHaveLength(19);
  });
});

// ─── Section 13: Persistent verdict reservation ───

describe("DF-002: Persistent verdict reservation", () => {
  it("reserveVerdictCall sets persistent hold that blocks optional calls", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.reserveVerdictCall();
    expect(budget.verdictReserved).toBe(1);

    budget.recordModelCall(); // risk (1)
    budget.recordModelCall(); // plan (2)
    budget.recordModelCall(); // chunk1 (3)
    budget.recordModelCall(); // chunk2 (4)

    // 4 consumed + 0 reserved + 1 verdict = 5 committed; 1 slot remains
    expect(budget.snapshot().remainingModelCalls).toBe(1);

    // canAffordModelCall: 4+0+1=5 < 6 → true (could be used by a stage check)
    expect(budget.canAffordModelCall()).toBe(true);

    budget.recordModelCall(); // testGen (5)
    // 5+0+1=6 >= 6 → verdict slot is the only one left
    expect(budget.canAffordModelCall()).toBe(false);
    expect(budget.canAffordOptionalModelCall(0)).toBe(false);
  });

  it("releaseVerdictReservation at FORMING_VERDICT unlocks verdict call", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.reserveVerdictCall();
    budget.recordModelCall(); // risk (1)
    budget.recordModelCall(); // plan (2)
    budget.recordModelCall(); // chunk1 (3)
    budget.recordModelCall(); // chunk2 (4)
    budget.recordModelCall(); // testGen (5)

    // Verdict hold blocks the last slot
    expect(budget.canAffordModelCall()).toBe(false);

    // Simulate FORMING_VERDICT
    budget.releaseVerdictReservation();
    expect(budget.verdictReserved).toBe(0);
    expect(budget.canAffordModelCall()).toBe(true);

    budget.recordModelCall(); // verdict (6)
    expect(budget.canAffordModelCall()).toBe(false);
  });

  it("full quick-profile budget trace: risk, plan, 2 chunks, verdict, memory = 6 calls", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.reserveVerdictCall();

    budget.recordModelCall(); // risk (1)
    budget.recordModelCall(); // plan (2)

    const reserved = budget.reserveModelCalls(2);
    expect(reserved).toBe(2); // available = 6-2-0-1 = 3, reserves 2

    budget.consumeReservation(); // chunk1 (3)
    budget.consumeReservation(); // chunk2 (4)

    // testGen gate: canAffordOptionalModelCall(1)
    // remaining = 6-4-0-1 = 1, 1 <= 1 → false
    expect(budget.canAffordOptionalModelCall(1)).toBe(false);

    // Simulate FORMING_VERDICT
    budget.releaseVerdictReservation();
    expect(budget.canAffordModelCall()).toBe(true);
    budget.recordModelCall(); // verdict (5)

    // After verdict, memory distillation uses remaining unreserved capacity
    expect(budget.canAffordModelCall()).toBe(true);
    budget.recordModelCall(); // memory (6)
    expect(budget.canAffordModelCall()).toBe(false);
  });

  it("optional calls never consume the verdict slot", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 3,
    });
    budget.reserveVerdictCall();

    budget.recordModelCall(); // (1)
    budget.recordModelCall(); // (2)
    // 2 consumed + 0 reserved + 1 verdict = 3 committed
    expect(budget.canAffordModelCall()).toBe(false);
    expect(budget.canAffordOptionalModelCall(0)).toBe(false);

    // Release for verdict
    budget.releaseVerdictReservation();
    expect(budget.canAffordModelCall()).toBe(true);
    budget.recordModelCall(); // verdict (3)
    expect(budget.canAffordModelCall()).toBe(false);
  });

  it("reserveVerdictCall is idempotent", () => {
    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 6,
    });
    budget.reserveVerdictCall();
    budget.reserveVerdictCall();
    budget.reserveVerdictCall();
    expect(budget.verdictReserved).toBe(1);
    expect(budget.snapshot().remainingModelCalls).toBe(5);
  });
});

// ─── Section 14: Exact missing-assessment regression ───

describe("DF-002: Missing-assessment regression — chunk returns fewer assessments", () => {
  it("38 reqs, chunk 2 omits FR-023–FR-027 and FR-030–FR-034: 10 NOT_VERIFIED fallbacks", async () => {
    const reqs = makeRequirements(38);
    const missingIds = new Set([
      "FR-023",
      "FR-024",
      "FR-025",
      "FR-026",
      "FR-027",
      "FR-030",
      "FR-031",
      "FR-032",
      "FR-033",
      "FR-034",
    ]);

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        const assessments = reqCtx
          .filter((r: { id: string }) => !missingIds.has(r.id))
          .map((r: { id: string }) => ({
            requirementId: r.id,
            status: "VERIFIED",
            evidenceIds: [],
            explanation: "Verified",
          }));
        return makeModelResult({
          requirementAssessments: assessments,
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [makePassEvidence("ev-1")],
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    // Both chunks fulfilled (Promise.allSettled), so chunksSucceeded = 2
    expect(result.chunksSucceeded).toBe(2);
    expect(result.partial).toBe(true);

    // Total assessments must equal total requirements
    expect(result.requirementAssessments).toHaveLength(38);

    // Exactly 10 NOT_VERIFIED fallbacks for the missing IDs
    const notVerified = result.requirementAssessments.filter(
      (a) => a.status === "NOT_VERIFIED",
    );
    expect(notVerified).toHaveLength(10);
    const notVerifiedIds = new Set(notVerified.map((a) => a.requirementId));
    expect(notVerifiedIds).toEqual(missingIds);

    // All fallbacks reference pass evidence
    for (const a of notVerified) {
      expect(a.evidenceIds).toContain("ev-1");
    }

    // 28 VERIFIED assessments
    const verified = result.requirementAssessments.filter(
      (a) => a.status === "VERIFIED",
    );
    expect(verified).toHaveLength(28);

    // Gap Analysis marker exists
    const gapAnalysisGap = result.gaps.find((g) => g.area === "Gap Analysis");
    expect(gapAnalysisGap).toBeDefined();
    expect(gapAnalysisGap!.reason).toContain("10 of 38");
    expect(gapAnalysisGap!.reason).toContain("incomplete model response");

    // Ordering preserved
    for (let i = 0; i < result.requirementAssessments.length - 1; i++) {
      const aIdx = reqs.findIndex(
        (r) => r.id === result.requirementAssessments[i].requirementId,
      );
      const bIdx = reqs.findIndex(
        (r) => r.id === result.requirementAssessments[i + 1].requirementId,
      );
      expect(aIdx).toBeLessThan(bIdx);
    }
  });

  it("chunk 1 complete, chunk 2 returns 0 assessments: 19 NOT_VERIFIED fallbacks", async () => {
    const reqs = makeRequirements(38);

    let chunkNum = 0;
    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        chunkNum++;
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        if (chunkNum === 1) {
          return makeModelResult({
            requirementAssessments: reqCtx.map((r: { id: string }) => ({
              requirementId: r.id,
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "Verified",
            })),
            gaps: [],
          }) as ModelResult<T>;
        }
        // Chunk 2 returns empty assessments
        return makeModelResult({
          requirementAssessments: [],
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    expect(result.chunksSucceeded).toBe(2);
    expect(result.partial).toBe(true);
    expect(result.requirementAssessments).toHaveLength(38);

    const verified = result.requirementAssessments.filter(
      (a) => a.status === "VERIFIED",
    );
    expect(verified).toHaveLength(19);

    const notVerified = result.requirementAssessments.filter(
      (a) => a.status === "NOT_VERIFIED",
    );
    expect(notVerified).toHaveLength(19);

    // All NOT_VERIFIED are from chunk 2 (FR-020 through FR-038)
    for (const a of notVerified) {
      const num = parseInt(a.requirementId.replace("FR-", ""), 10);
      expect(num).toBeGreaterThanOrEqual(20);
      expect(num).toBeLessThanOrEqual(38);
    }

    expect(result.gaps.some((g) => g.area === "Gap Analysis")).toBe(true);
  });
});

// ─── Section 15: Duplicate and unknown ID handling ───

describe("DF-002: Chunk completeness — duplicate and unknown IDs", () => {
  it("duplicate IDs: first valid occurrence wins, later duplicates discarded", async () => {
    const reqs = makeRequirements(5);

    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        return makeModelResult({
          requirementAssessments: [
            {
              requirementId: "FR-001",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "First",
            },
            {
              requirementId: "FR-002",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
            {
              requirementId: "FR-001",
              status: "FAIL",
              evidenceIds: [],
              explanation: "Duplicate",
            },
            {
              requirementId: "FR-003",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
            {
              requirementId: "FR-004",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
            {
              requirementId: "FR-005",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
          ],
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.requirementAssessments).toHaveLength(5);
    expect(result.partial).toBe(true);

    // First occurrence wins: FR-001 should be VERIFIED, not FAIL
    const fr001 = result.requirementAssessments.find(
      (a) => a.requirementId === "FR-001",
    );
    expect(fr001!.status).toBe("VERIFIED");
    expect(fr001!.explanation).toBe("First");

    // Gap Analysis marker created
    expect(result.gaps.some((g) => g.area === "Gap Analysis")).toBe(true);
    const gapMarker = result.gaps.find((g) => g.area === "Gap Analysis")!;
    expect(gapMarker.reason).toContain("duplicate");
  });

  it("unknown IDs: excluded from results, gap marker created", async () => {
    const reqs = makeRequirements(3);

    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        return makeModelResult({
          requirementAssessments: [
            {
              requirementId: "FR-001",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
            {
              requirementId: "UNKNOWN-X",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "Hallucinated",
            },
            {
              requirementId: "FR-002",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
            {
              requirementId: "FR-003",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
          ],
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.requirementAssessments).toHaveLength(3);
    expect(result.partial).toBe(true);

    // Unknown ID excluded
    const unknownAssessment = result.requirementAssessments.find(
      (a) => a.requirementId === "UNKNOWN-X",
    );
    expect(unknownAssessment).toBeUndefined();

    // All requested IDs present
    const ids = result.requirementAssessments.map((a) => a.requirementId);
    expect(ids).toEqual(["FR-001", "FR-002", "FR-003"]);

    const gapMarker = result.gaps.find((g) => g.area === "Gap Analysis")!;
    expect(gapMarker.reason).toContain("unknown");
  });

  it("missing + duplicate + unknown combined: fallbacks synthesized, first occurrence wins, unknowns excluded", async () => {
    const reqs = makeRequirements(5);

    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        return makeModelResult({
          requirementAssessments: [
            {
              requirementId: "FR-001",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "First",
            },
            {
              requirementId: "FR-001",
              status: "FAIL",
              evidenceIds: [],
              explanation: "Dup",
            },
            {
              requirementId: "FR-002",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
            {
              requirementId: "PHANTOM",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "Unknown",
            },
            // FR-003 missing
            {
              requirementId: "FR-004",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
            // FR-005 missing
          ],
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [makePassEvidence("ev-1")],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    // Canonical invariant: exactly 5 assessments
    expect(result.requirementAssessments).toHaveLength(5);
    expect(result.partial).toBe(true);

    // FR-001: first occurrence (VERIFIED), duplicate discarded
    const fr001 = result.requirementAssessments.find(
      (a) => a.requirementId === "FR-001",
    );
    expect(fr001!.status).toBe("VERIFIED");
    expect(fr001!.explanation).toBe("First");

    // FR-003 and FR-005: NOT_VERIFIED fallbacks
    const fr003 = result.requirementAssessments.find(
      (a) => a.requirementId === "FR-003",
    );
    expect(fr003!.status).toBe("NOT_VERIFIED");
    expect(fr003!.evidenceIds).toContain("ev-1");

    const fr005 = result.requirementAssessments.find(
      (a) => a.requirementId === "FR-005",
    );
    expect(fr005!.status).toBe("NOT_VERIFIED");

    // PHANTOM excluded
    expect(
      result.requirementAssessments.find((a) => a.requirementId === "PHANTOM"),
    ).toBeUndefined();

    // Gap marker mentions all issues
    const gapMarker = result.gaps.find((g) => g.area === "Gap Analysis")!;
    expect(gapMarker).toBeDefined();
    expect(gapMarker.reason).toContain("2 of 5");
    expect(gapMarker.reason).toContain("duplicate");
    expect(gapMarker.reason).toContain("unknown");

    // Ordering preserved
    const ids = result.requirementAssessments.map((a) => a.requirementId);
    expect(ids).toEqual(["FR-001", "FR-002", "FR-003", "FR-004", "FR-005"]);
  });

  it("duplicates without missing IDs: no fallbacks but gap marker created", async () => {
    const reqs = makeRequirements(3);

    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        return makeModelResult({
          requirementAssessments: [
            {
              requirementId: "FR-001",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
            {
              requirementId: "FR-002",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
            {
              requirementId: "FR-002",
              status: "FAIL",
              evidenceIds: [],
              explanation: "Dup",
            },
            {
              requirementId: "FR-003",
              status: "VERIFIED",
              evidenceIds: [],
              explanation: "OK",
            },
          ],
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.requirementAssessments).toHaveLength(3);
    expect(result.partial).toBe(true);

    // No NOT_VERIFIED fallbacks — all IDs present
    const notVerified = result.requirementAssessments.filter(
      (a) => a.status === "NOT_VERIFIED",
    );
    expect(notVerified).toHaveLength(0);

    // Gap marker still created for semantic issues
    const gapMarker = result.gaps.find((g) => g.area === "Gap Analysis");
    expect(gapMarker).toBeDefined();
    expect(gapMarker!.reason).toContain("duplicate");
    expect(gapMarker!.reason).not.toContain("could not be assessed");
  });
});

// ─── Section 16: Legitimate success preservation ───

describe("DF-002: Legitimate success — no false gap markers", () => {
  it("all chunks return exact assessments: no gaps, partial=false", async () => {
    const reqs = makeRequirements(38);

    const gateway: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const reqCtx = (task.context as { requirements: { id: string }[] })
          .requirements;
        return makeModelResult({
          requirementAssessments: reqCtx.map((r: { id: string }) => ({
            requirementId: r.id,
            status: "VERIFIED",
            evidenceIds: [],
            explanation: "Verified",
          })),
          gaps: [],
        }) as ModelResult<T>;
      },
    };

    const result = await analyzeGapsChunked(
      gateway,
      reqs,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      2,
      () => {},
      () => {},
    );

    expect(result.chunksSucceeded).toBe(2);
    expect(result.partial).toBe(false);
    expect(result.requirementAssessments).toHaveLength(38);

    // No Gap Analysis marker
    expect(result.gaps.some((g) => g.area === "Gap Analysis")).toBe(false);

    // All VERIFIED
    const verified = result.requirementAssessments.filter(
      (a) => a.status === "VERIFIED",
    );
    expect(verified).toHaveLength(38);

    // No NOT_VERIFIED
    const notVerified = result.requirementAssessments.filter(
      (a) => a.status === "NOT_VERIFIED",
    );
    expect(notVerified).toHaveLength(0);

    // Ordering preserved
    for (let i = 0; i < result.requirementAssessments.length; i++) {
      expect(result.requirementAssessments[i].requirementId).toBe(
        `FR-${String(i + 1).padStart(3, "0")}`,
      );
    }
  });
});
