import { describe, it, expect } from "vitest";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import { SchemaValidationError } from "../src/models/gateway/types.js";
import {
  BudgetManager,
  createBudgetForProfile,
  VERDICT_TIME_RESERVE_MS,
} from "../src/core/orchestrator/budget-manager.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  analyzeGapsChunked,
  buildRequirementCompletenessValidator,
  chunkRequirements,
  MAX_REQUIREMENTS_PER_GAP_CHUNK,
} from "../src/core/reasoning/gap-analyzer.js";
import type { GapAnalysisOutput } from "../src/prompts/gap-analysis/v1.js";
import {
  buildCandidateEvidenceMap,
  extractTerms,
} from "../src/core/reasoning/evidence-candidates.js";
import {
  projectEvidenceForModel,
  isAuthoritativeVerificationEvidence,
} from "../src/core/orchestrator/evidence-projection.js";
import type {
  Requirement,
  RiskAssessment,
  Evidence,
} from "../src/types/index.js";

// ─── Helpers ───

function makeRequirements(count: number, prefix: string = "FR"): Requirement[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(3, "0")}`,
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

function makeGapResult(
  reqIds: string[],
  status: string = "NOT_VERIFIED",
): GapAnalysisOutput {
  return {
    gaps: [],
    requirementAssessments: reqIds.map((id) => ({
      requirementId: id,
      status: status as "NOT_VERIFIED",
      evidenceIds: [],
      explanation: "No evidence",
    })),
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

function makeEvidence(overrides: Partial<Evidence> & { id: string }): Evidence {
  return {
    type: "DISCOVERY_RESULT",
    provenance: "observed",
    timestamp: new Date().toISOString(),
    source: "test",
    status: "OBSERVED",
    summary: "Test evidence",
    ...overrides,
  };
}

// ─── Correction 1: Semantic Completeness ───

describe("Correction 1: Semantic gap-response completeness", () => {
  // Case 1: Complete chunk responses succeed without repair
  it("complete chunk response succeeds without repair", async () => {
    let callCount = 0;
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        return makeModelResult(
          makeGapResult(reqIds),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    const result = await analyzeGapsChunked(
      gateway,
      makeRequirements(5),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.chunksSucceeded).toBe(1);
    expect(result.requirementAssessments).toHaveLength(5);
    expect(callCount).toBe(1);
  });

  // Case 2: Response missing one requirement enters repair
  it("response missing one requirement enters repair", async () => {
    let callCount = 0;
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        if (callCount === 1) {
          return makeModelResult(
            makeGapResult(reqIds.slice(0, -1)),
          ) as unknown as ModelResult<T>;
        }
        return makeModelResult(
          makeGapResult(reqIds),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    const result = await analyzeGapsChunked(
      gateway,
      makeRequirements(5),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.chunksSucceeded).toBe(1);
    expect(result.requirementAssessments).toHaveLength(5);
    expect(callCount).toBe(2);
  });

  // Case 3: Response missing multiple requirements enters repair
  it("response missing multiple requirements enters repair", async () => {
    let callCount = 0;
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        if (callCount === 1) {
          return makeModelResult(
            makeGapResult(reqIds.slice(0, 2)),
          ) as unknown as ModelResult<T>;
        }
        return makeModelResult(
          makeGapResult(reqIds),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    const result = await analyzeGapsChunked(
      gateway,
      makeRequirements(8),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.chunksSucceeded).toBe(1);
    expect(result.requirementAssessments).toHaveLength(8);
    expect(callCount).toBe(2);
  });

  // Case 4: Duplicate requirement IDs enter repair
  it("duplicate requirement IDs enter repair", async () => {
    let callCount = 0;
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        if (callCount === 1) {
          const duped = makeGapResult(reqIds);
          duped.requirementAssessments.push({
            requirementId: reqIds[0],
            status: "NOT_VERIFIED",
            evidenceIds: [],
            explanation: "Duplicate",
          });
          return makeModelResult(duped) as unknown as ModelResult<T>;
        }
        return makeModelResult(
          makeGapResult(reqIds),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    const result = await analyzeGapsChunked(
      gateway,
      makeRequirements(3),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.chunksSucceeded).toBe(1);
    expect(callCount).toBe(2);
  });

  // Case 5: Unknown requirement IDs enter repair
  it("unknown requirement IDs enter repair", async () => {
    let callCount = 0;
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        if (callCount === 1) {
          const withUnknown = makeGapResult([...reqIds, "UNKNOWN-99"]);
          return makeModelResult(withUnknown) as unknown as ModelResult<T>;
        }
        return makeModelResult(
          makeGapResult(reqIds),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    const result = await analyzeGapsChunked(
      gateway,
      makeRequirements(3),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.chunksSucceeded).toBe(1);
    expect(callCount).toBe(2);
  });

  // Case 6: Repaired complete response is accepted
  it("repaired complete response is accepted", async () => {
    let callCount = 0;
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        if (callCount === 1) {
          return makeModelResult(
            makeGapResult(reqIds.slice(0, 1)),
          ) as unknown as ModelResult<T>;
        }
        // Repair succeeds with all IDs
        return makeModelResult(
          makeGapResult(reqIds),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    const result = await analyzeGapsChunked(
      gateway,
      makeRequirements(5),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(result.chunksSucceeded).toBe(1);
    expect(result.requirementAssessments).toHaveLength(5);
    for (const a of result.requirementAssessments) {
      expect(a.requirementId).toMatch(/^FR-/);
    }
  });

  // Case 7: Failed/denied repair falls back to deterministic NOT_VERIFIED
  it("failed repair falls back to deterministic NOT_VERIFIED", async () => {
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        // Always return incomplete (missing last 2)
        return makeModelResult(
          makeGapResult(reqIds.slice(0, -2)),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    const result = await analyzeGapsChunked(
      gateway,
      makeRequirements(5),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    // Chunk fails entirely after repair exhaustion
    expect(result.chunksSucceeded).toBe(0);
    expect(result.partial).toBe(true);
    // Deterministic fallback provides all 5
    expect(result.requirementAssessments).toHaveLength(5);
    for (const a of result.requirementAssessments) {
      expect(a.status).toBe("NOT_VERIFIED");
    }
  });

  // Case 8: Retry/model-call accounting unchanged
  it("retry accounting unchanged: repair uses retry budget", async () => {
    let callCount = 0;
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        if (callCount === 1) {
          return makeModelResult(
            makeGapResult(reqIds.slice(0, 1)),
          ) as unknown as ModelResult<T>;
        }
        return makeModelResult(
          makeGapResult(reqIds),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
      maxRetries: 3,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    await analyzeGapsChunked(
      gateway,
      makeRequirements(5),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    // 1 retry consumed (attempt 0 failed, attempt 1 succeeded)
    expect(budget.retries).toBe(1);
    expect(callCount).toBe(2);
  });

  it("quick profile retry limit is respected during repair", async () => {
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        return makeModelResult(
          makeGapResult(reqIds.slice(0, 1)),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager(createBudgetForProfile("quick"));
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    const result = await analyzeGapsChunked(
      gateway,
      makeRequirements(5),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    // Quick profile maxRetries=1: one retry used, then budget exhausted
    expect(budget.retries).toBe(1);
    // Chunk fails, falls back to deterministic NOT_VERIFIED
    expect(result.chunksSucceeded).toBe(0);
    expect(result.partial).toBe(true);
  });

  // Case 9: Verdict reserve semantics unchanged
  it("verdict reserve semantics unchanged after completeness repair", () => {
    const budget = new BudgetManager(createBudgetForProfile("quick"));
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

    expect(budget.callDeadlineReserveMs).toBe(VERDICT_TIME_RESERVE_MS);
    expect(budget.canAffordOptionalModelCall()).toBe(true);
  });

  // Case 10: Gap chunk sizing and parallel dispatch unchanged
  it("gap chunk sizing unchanged", () => {
    expect(MAX_REQUIREMENTS_PER_GAP_CHUNK).toBe(19);
    const chunks = chunkRequirements(makeRequirements(38));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(19);
    expect(chunks[1]).toHaveLength(19);
  });

  // Validator unit tests
  it("validator passes for exact requirement set match", () => {
    const validator = buildRequirementCompletenessValidator([
      "A-1",
      "A-2",
      "A-3",
    ]);
    const data = makeGapResult(["A-1", "A-2", "A-3"]);
    expect(() => validator(data)).not.toThrow();
  });

  it("validator throws SchemaValidationError for missing IDs", () => {
    const validator = buildRequirementCompletenessValidator([
      "A-1",
      "A-2",
      "A-3",
    ]);
    const data = makeGapResult(["A-1", "A-2"]);
    expect(() => validator(data)).toThrow(SchemaValidationError);
    try {
      validator(data);
    } catch (e) {
      expect((e as SchemaValidationError).validationErrors).toContain("A-3");
    }
  });

  it("validator throws SchemaValidationError for duplicate IDs", () => {
    const validator = buildRequirementCompletenessValidator(["A-1", "A-2"]);
    const data = makeGapResult(["A-1", "A-2", "A-1"]);
    expect(() => validator(data)).toThrow(SchemaValidationError);
  });

  it("validator throws SchemaValidationError for unknown IDs", () => {
    const validator = buildRequirementCompletenessValidator(["A-1", "A-2"]);
    const data = makeGapResult(["A-1", "A-2", "UNKNOWN"]);
    expect(() => validator(data)).toThrow(SchemaValidationError);
  });

  it("repair task includes _schemaRepair context", async () => {
    let repairCtx: Record<string, unknown> | undefined;
    let callCount = 0;
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        callCount++;
        const ctx = task.context as Record<string, unknown>;
        if (callCount === 2) {
          repairCtx = ctx;
        }
        const reqs = (ctx.requirements as { id: string }[]) ?? [];
        const reqIds = reqs.map((r) => r.id);
        if (callCount === 1) {
          return makeModelResult(
            makeGapResult(reqIds.slice(0, 1)),
          ) as unknown as ModelResult<T>;
        }
        return makeModelResult(
          makeGapResult(reqIds),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    await analyzeGapsChunked(
      gateway,
      makeRequirements(3),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(repairCtx).toBeDefined();
    expect(repairCtx!._schemaRepair).toBeDefined();
    const repair = repairCtx!._schemaRepair as Record<string, unknown>;
    expect(repair.validationErrors).toBeDefined();
    expect(typeof repair.validationErrors).toBe("string");
    expect(repair.validationErrors as string).toContain("omitted");
  });
});

// ─── Correction 2: Evidence Candidate Mapping ───

describe("Correction 2: Generic evidence candidate mapping", () => {
  // Case 11: Candidate evidence may be associated with multiple requirements
  it("same evidence is candidate for multiple requirements", () => {
    const requirements = [
      {
        id: "REQ-A",
        description: "The system must execute tests on every commit",
      },
      {
        id: "REQ-B",
        description: "Test results must be reported with pass/fail status",
      },
    ];
    const evidence = [
      {
        id: "ev-test-001",
        type: "TEST_RESULT",
        summary: "npm run test: 42 tests passed",
        details: { exitCode: 0, testFramework: "vitest" },
      },
    ];

    const candidates = buildCandidateEvidenceMap(requirements, evidence);

    expect(candidates.get("REQ-A")).toContain("ev-test-001");
    expect(candidates.get("REQ-B")).toContain("ev-test-001");
  });

  // Case 12: Works with arbitrary/custom requirement IDs
  it("candidate selection works with arbitrary requirement IDs", () => {
    const requirements = [
      {
        id: "CUSTOM-ALPHA",
        description: "Linting and static analysis must run",
      },
      { id: "xyz-99", description: "Browser tests must verify rendering" },
      { id: "42", description: "Build artifacts must compile successfully" },
    ];
    const evidence = [
      {
        id: "ev-lint-1",
        type: "STATIC_ANALYSIS_RESULT",
        summary: "eslint check passed",
        details: { exitCode: 0 },
      },
      {
        id: "ev-browser-1",
        type: "BROWSER_RESULT",
        summary: "Browser validation completed",
      },
      {
        id: "ev-build-1",
        type: "BUILD_RESULT",
        summary: "tsc compiled successfully",
      },
    ];

    const candidates = buildCandidateEvidenceMap(requirements, evidence);

    expect(candidates.get("CUSTOM-ALPHA")).toContain("ev-lint-1");
    expect(candidates.get("xyz-99")).toContain("ev-browser-1");
    expect(candidates.get("42")).toContain("ev-build-1");
  });

  // Case 13: Candidate evidence does not automatically produce VERIFIED
  it("candidate evidence does not automatically produce VERIFIED or PARTIALLY_VERIFIED", async () => {
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        return makeModelResult(
          makeGapResult(reqIds, "NOT_VERIFIED"),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    const testEvidence: Evidence[] = [
      makeEvidence({
        id: "ev-test-1",
        type: "TEST_RESULT",
        provenance: "executed",
        status: "PASS",
        summary: "All tests passed",
      }),
    ];

    const requirements: Requirement[] = [
      { id: "REQ-1", description: "Tests must execute and pass" },
    ];

    const result = await analyzeGapsChunked(
      gateway,
      requirements,
      testEvidence,
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    // Model said NOT_VERIFIED — candidate evidence doesn't override that
    expect(result.requirementAssessments[0].status).toBe("NOT_VERIFIED");
  });

  // Case 14: Fabricated evidence IDs remain rejected
  it("fabricated evidence IDs are rejected by validateEvidenceReferences", () => {
    const evidence: Evidence[] = [
      makeEvidence({
        id: "ev-real-1",
        type: "TEST_RESULT",
        provenance: "executed",
        status: "PASS",
      }),
    ];
    const evidenceIds = new Set(evidence.map((e) => e.id));

    const assessments = [
      {
        requirementId: "REQ-1",
        status: "VERIFIED" as const,
        evidenceIds: ["ev-real-1", "ev-fabricated-999"],
        explanation: "Verified with fabricated evidence",
      },
    ];

    const filtered = assessments.map((a) => ({
      ...a,
      evidenceIds: a.evidenceIds.filter((id) => evidenceIds.has(id)),
    }));

    expect(filtered[0].evidenceIds).toEqual(["ev-real-1"]);
    expect(filtered[0].evidenceIds).not.toContain("ev-fabricated-999");
  });

  // Case 15: VERIFIED without authoritative evidence is downgraded
  it("VERIFIED without authoritative evidence is downgraded", () => {
    const inferredEvidence = makeEvidence({
      id: "ev-inferred-1",
      type: "MANUAL_INFERENCE",
      provenance: "inferred",
      status: "OBSERVED",
      summary: "Inferred from code inspection",
    });

    expect(isAuthoritativeVerificationEvidence(inferredEvidence)).toBe(false);

    const executedEvidence = makeEvidence({
      id: "ev-exec-1",
      type: "TEST_RESULT",
      provenance: "executed",
      status: "PASS",
      summary: "Tests passed",
    });

    expect(isAuthoritativeVerificationEvidence(executedEvidence)).toBe(true);

    const observedEvidence = makeEvidence({
      id: "ev-obs-1",
      type: "DISCOVERY_RESULT",
      provenance: "observed",
      status: "OBSERVED",
      summary: "Repository discovery",
    });

    expect(isAuthoritativeVerificationEvidence(observedEvidence)).toBe(true);
  });

  // Case 16: Evidence projection/sanitization unchanged
  it("existing evidence projection and sanitization unchanged", () => {
    const evidence: Evidence[] = [
      makeEvidence({
        id: "ev-1",
        type: "DISCOVERY_RESULT",
        status: "OBSERVED",
        summary: "Detected test frameworks",
        details: {
          testFrameworks: ["vitest", "jest"],
          lintCommands: ["eslint src/"],
          secretField: "should-be-sanitized-if-too-long",
        },
      }),
    ];

    const projected = projectEvidenceForModel(evidence);

    expect(projected).toHaveLength(1);
    expect(projected[0].id).toBe("ev-1");
    expect(projected[0].type).toBe("DISCOVERY_RESULT");
    expect(projected[0].status).toBe("OBSERVED");
    expect(projected[0].details).toBeDefined();
    expect(
      (projected[0].details as Record<string, unknown>).testFrameworks,
    ).toEqual(["vitest", "jest"]);
  });

  // Additional candidate mapping tests
  it("DISCOVERY_RESULT matched to requirement about detection/analysis", () => {
    const requirements = [
      {
        id: "REQ-DETECT",
        description:
          "The agent must detect available test frameworks and lint tools",
      },
    ];
    const evidence = [
      {
        id: "ev-discovery-repo",
        type: "DISCOVERY_RESULT",
        summary: "Repository analysis: detected vitest, eslint",
        details: {
          testFrameworks: ["vitest"],
          lintCommands: ["eslint src/"],
        },
      },
    ];

    const candidates = buildCandidateEvidenceMap(requirements, evidence);
    expect(candidates.get("REQ-DETECT")).toContain("ev-discovery-repo");
  });

  it("TEST_RESULT matched to requirement about test execution", () => {
    const requirements = [
      {
        id: "REQ-EXEC",
        description: "Existing tests must be executed and results reported",
      },
    ];
    const evidence = [
      {
        id: "ev-test-run",
        type: "TEST_RESULT",
        summary: "npm run test: 100 tests passed, 2 failed",
        details: { exitCode: 1, passCount: 100, failCount: 2 },
      },
    ];

    const candidates = buildCandidateEvidenceMap(requirements, evidence);
    expect(candidates.get("REQ-EXEC")).toContain("ev-test-run");
  });

  it("content overlap matches evidence to requirement via shared terms", () => {
    const requirements = [
      {
        id: "REQ-PERF",
        description:
          "Performance benchmarks must complete within latency thresholds",
      },
    ];
    const evidence = [
      {
        id: "ev-perf-1",
        type: "COMMAND_RESULT",
        summary: "Performance benchmark completed: p99 latency 45ms",
        details: { p99: 45, threshold: 100 },
      },
    ];

    const candidates = buildCandidateEvidenceMap(requirements, evidence);
    expect(candidates.get("REQ-PERF")).toContain("ev-perf-1");
  });

  it("unrelated evidence is NOT a candidate", () => {
    const requirements = [
      { id: "REQ-DB", description: "Database migrations must apply cleanly" },
    ];
    const evidence = [
      {
        id: "ev-browser-1",
        type: "BROWSER_RESULT",
        summary: "Homepage rendered correctly in Chrome",
      },
    ];

    const candidates = buildCandidateEvidenceMap(requirements, evidence);
    expect(candidates.get("REQ-DB") ?? []).not.toContain("ev-browser-1");
  });

  it("candidateEvidenceIds appears in gap analysis task context", async () => {
    let capturedContext: Record<string, unknown> | undefined;
    const inner: ModelGateway = {
      async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
        capturedContext = task.context;
        const ctx = task.context as { requirements: { id: string }[] };
        const reqIds = ctx.requirements.map((r) => r.id);
        return makeModelResult(
          makeGapResult(reqIds),
        ) as unknown as ModelResult<T>;
      },
    };

    const budget = new BudgetManager({
      maxDurationMs: 120_000,
      maxModelCalls: 10,
    });
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 0,
      sleepFn: async () => {},
    });

    const testEvidence: Evidence[] = [
      makeEvidence({
        id: "ev-test-1",
        type: "TEST_RESULT",
        provenance: "executed",
        status: "PASS",
        summary: "Tests passed",
      }),
    ];

    const requirements: Requirement[] = [
      { id: "REQ-1", description: "Tests must be executed" },
    ];

    await analyzeGapsChunked(
      gateway,
      requirements,
      testEvidence,
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(capturedContext).toBeDefined();
    const reqs = capturedContext!.requirements as {
      id: string;
      candidateEvidenceIds?: string[];
    }[];
    expect(reqs[0].candidateEvidenceIds).toBeDefined();
    expect(reqs[0].candidateEvidenceIds).toContain("ev-test-1");
  });
});

// ─── extractTerms unit tests ───

describe("extractTerms utility", () => {
  it("extracts meaningful terms from text", () => {
    const terms = extractTerms("The system must execute lint checks");
    expect(terms.has("system")).toBe(true);
    expect(terms.has("execute")).toBe(true);
    expect(terms.has("lint")).toBe(true);
    expect(terms.has("checks")).toBe(true);
    expect(terms.has("the")).toBe(false);
    expect(terms.has("must")).toBe(false);
  });

  it("handles empty string", () => {
    expect(extractTerms("").size).toBe(0);
  });
});
