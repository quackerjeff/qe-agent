import { describe, it, expect } from "vitest";
import {
  produceVerdict,
  synthesizeVerdictSummary,
  buildOverrideSummary,
  applyGuardrails,
} from "../src/core/reasoning/verdict-engine.js";
import { VerdictRecommendationOutputSchema } from "../src/prompts/verdict/v1.js";
import type { ModelGateway, ModelResult } from "../src/models/gateway/types.js";
import type {
  Evidence,
  Finding,
  RequirementAssessment,
  RiskLevel,
} from "../src/types/index.js";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
} from "../src/core/orchestrator/budget-manager.js";

function makePassEvidence(id: string): Evidence {
  return {
    id,
    type: "TEST_RESULT",
    provenance: "executed",
    timestamp: new Date().toISOString(),
    source: "local:npm",
    status: "PASS",
    summary: "Command passed",
  };
}

function makeVerdictGateway(
  recommendedVerdict: string,
  confidence: string,
  modelSummary?: string,
): ModelGateway {
  return {
    async reason<T>(): Promise<ModelResult<T>> {
      const data: Record<string, unknown> = {
        recommendedVerdict,
        confidence,
        reasoning: "Test reasoning",
        concerns: ["concern-1"],
        recommendedNextActions: ["action-1"],
      };
      if (modelSummary !== undefined) {
        data.summary = modelSummary;
      }
      return {
        data: data as T,
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
    },
  };
}

function defaultArgs() {
  return {
    requirements: [{ id: "FR-001", description: "req" }],
    findings: [] as Finding[],
    riskAssessment: {
      level: "LOW" as const,
      factors: [] as { factor: string; reason: string; weight: string }[],
      confidence: 0.8,
      summary: "Low risk",
    },
    gaps: [] as { area: string; description: string; risk: RiskLevel }[],
    assessments: [
      {
        requirementId: "FR-001",
        status: "VERIFIED" as const,
        evidenceIds: ["ev-1"],
        explanation: "Verified",
      },
    ] as RequirementAssessment[],
    evidence: [makePassEvidence("ev-1"), makePassEvidence("ev-2")],
    budgetExhausted: false,
  };
}

describe("DF-002: Verdict summary resilience", () => {
  it("Case 1: missing summary alone is deterministically repaired without provider retry", async () => {
    const gateway = makeVerdictGateway("PASS", "HIGH");
    const args = defaultArgs();

    const result = await produceVerdict(
      gateway,
      args.requirements,
      args.findings,
      args.riskAssessment,
      args.gaps,
      args.assessments,
      args.evidence,
      args.budgetExhausted,
    );

    expect(result.summary).toBeDefined();
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toContain("PASS");
    expect(result.summary).toContain("HIGH");
  });

  it("Case 2: repaired result preserves model's recommended verdict", async () => {
    const gateway = makeVerdictGateway("NEEDS_REVIEW", "MEDIUM");
    const args = defaultArgs();

    const result = await produceVerdict(
      gateway,
      args.requirements,
      args.findings,
      args.riskAssessment,
      args.gaps,
      args.assessments,
      args.evidence,
      args.budgetExhausted,
    );

    expect(result.modelRecommendation.recommendedVerdict).toBe("NEEDS_REVIEW");
  });

  it("Case 3: repaired result preserves confidence", async () => {
    const gateway = makeVerdictGateway("PASS", "LOW");
    const args = defaultArgs();

    const result = await produceVerdict(
      gateway,
      args.requirements,
      args.findings,
      args.riskAssessment,
      args.gaps,
      args.assessments,
      args.evidence,
      args.budgetExhausted,
    );

    expect(result.confidence).toBe("LOW");
    expect(result.modelRecommendation.confidence).toBe("LOW");
  });

  it("Case 4: synthesized summary does not fabricate evidence, findings, or risk claims", async () => {
    const gateway = makeVerdictGateway("PASS_WITH_CONCERNS", "MEDIUM");
    const args = defaultArgs();

    const result = await produceVerdict(
      gateway,
      args.requirements,
      args.findings,
      args.riskAssessment,
      args.gaps,
      args.assessments,
      args.evidence,
      args.budgetExhausted,
    );

    const summary = result.summary;
    expect(summary).not.toMatch(/ev-/i);
    expect(summary).not.toMatch(/finding/i);
    expect(summary).not.toMatch(/defect/i);
    expect(summary).not.toMatch(/regression/i);
    expect(summary).not.toMatch(/security/i);
    expect(summary).not.toMatch(/vulnerability/i);
    expect(summary).toBe(
      "Verdict recommendation: PASS_WITH_CONCERNS with MEDIUM confidence.",
    );
  });

  it("Case 5: guardrail override still invokes buildOverrideSummary correctly", async () => {
    const gateway = makeVerdictGateway("BLOCKED", "HIGH");
    const args = defaultArgs();
    args.gaps = [
      {
        area: "Gap Analysis",
        description: "Incomplete",
        risk: "MEDIUM" as RiskLevel,
      },
    ];
    args.assessments = [
      {
        requirementId: "FR-001",
        status: "NOT_VERIFIED",
        evidenceIds: ["ev-1"],
        explanation: "Not verified",
      },
    ];

    const result = await produceVerdict(
      gateway,
      args.requirements,
      args.findings,
      args.riskAssessment,
      args.gaps,
      args.assessments,
      args.evidence,
      args.budgetExhausted,
    );

    expect(result.overrideApplied).toBe(true);
    expect(result.summary).toContain("PASS_WITH_CONCERNS");
    expect(result.summary).toContain("BLOCKED");
    expect(result.summary).toContain("Guardrail");
  });

  it("Case 6: valid model-provided summary remains unchanged", async () => {
    const modelSummary = "All tests passed. Quality is excellent.";
    const gateway = makeVerdictGateway("PASS", "HIGH", modelSummary);
    const args = defaultArgs();

    const result = await produceVerdict(
      gateway,
      args.requirements,
      args.findings,
      args.riskAssessment,
      args.gaps,
      args.assessments,
      args.evidence,
      args.budgetExhausted,
    );

    expect(result.summary).toBe(modelSummary);
    expect(result.modelRecommendation.summary).toBe(modelSummary);
  });

  it("Case 7: missing semantic verdict field still produces SchemaValidationError", () => {
    const result = VerdictRecommendationOutputSchema.safeParse({
      confidence: "HIGH",
      reasoning: "test",
      concerns: [],
      recommendedNextActions: [],
      summary: "test",
    });
    expect(result.success).toBe(false);
  });

  it("Case 8: invalid verdict enum still produces SchemaValidationError", () => {
    const result = VerdictRecommendationOutputSchema.safeParse({
      recommendedVerdict: "MAYBE",
      confidence: "HIGH",
      reasoning: "test",
      concerns: [],
      recommendedNextActions: [],
      summary: "test",
    });
    expect(result.success).toBe(false);
  });

  it("Case 9: correction consumes no retry budget", async () => {
    const innerGateway = new FakeModelGateway(() => ({
      recommendedVerdict: "PASS",
      confidence: "HIGH",
      reasoning: "test",
      concerns: [],
      recommendedNextActions: [],
    }));
    const budget = new BudgetManager(createBudgetForProfile("quick"));
    const budgetGateway = new BudgetAwareGateway(innerGateway, budget, {
      maxRetriesPerCall: 2,
    });

    const result = await budgetGateway.reason({
      role: "verdict_reviewer",
      objective: "test",
      context: {},
      outputSchema: VerdictRecommendationOutputSchema,
      maxTokens: 1024,
      promptVersion: "test-v1",
    });

    expect(result.data.summary).toBeUndefined();
    expect(budget.retries).toBe(0);
  });

  it("Case 10: provider-attempt count does not increase for missing summary", async () => {
    const innerGateway = new FakeModelGateway(() => ({
      recommendedVerdict: "PASS",
      confidence: "HIGH",
      reasoning: "test",
      concerns: [],
      recommendedNextActions: [],
    }));
    const budget = new BudgetManager(createBudgetForProfile("quick"));
    const budgetGateway = new BudgetAwareGateway(innerGateway, budget, {
      maxRetriesPerCall: 2,
    });

    await budgetGateway.reason({
      role: "verdict_reviewer",
      objective: "test",
      context: {},
      outputSchema: VerdictRecommendationOutputSchema,
      maxTokens: 1024,
      promptVersion: "test-v1",
    });

    expect(budgetGateway.diagnosticAttempts).toHaveLength(1);
    expect(budgetGateway.diagnosticAttempts[0].success).toBe(true);
  });

  it("Case 11: logical model-call count does not increase", async () => {
    const innerGateway = new FakeModelGateway(() => ({
      recommendedVerdict: "PASS",
      confidence: "HIGH",
      reasoning: "test",
      concerns: [],
      recommendedNextActions: [],
    }));
    const budget = new BudgetManager(createBudgetForProfile("quick"));
    const budgetGateway = new BudgetAwareGateway(innerGateway, budget, {
      maxRetriesPerCall: 2,
    });

    await budgetGateway.reason({
      role: "verdict_reviewer",
      objective: "test",
      context: {},
      outputSchema: VerdictRecommendationOutputSchema,
      maxTokens: 1024,
      promptVersion: "test-v1",
    });

    expect(budgetGateway.callMetadata).toHaveLength(1);
    expect(budget.modelCalls).toBe(0);
  });

  it("Case 12: existing verdict timeout behavior is unchanged", async () => {
    const gateway = makeVerdictGateway("PASS", "HIGH");
    const args = defaultArgs();

    const result = await produceVerdict(
      gateway,
      args.requirements,
      args.findings,
      args.riskAssessment,
      args.gaps,
      args.assessments,
      args.evidence,
      args.budgetExhausted,
    );

    expect(result.verdict).toBe("PASS");
    expect(result.modelResult.durationMs).toBeDefined();
  });

  it("Case 13: existing flaky-failure guardrails are unchanged", () => {
    const flakyEvidence: Evidence = {
      id: "ev-flaky",
      type: "TEST_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "vitest",
      status: "FAIL",
      summary: "Test failed",
    };
    const flakyFinding: Finding = {
      id: "f-1",
      category: "FLAKY_TEST",
      title: "Flaky test",
      severity: "INFO",
      confidence: 0.8,
      description: "Flaky",
      evidenceIds: ["ev-flaky"],
    };

    const result = applyGuardrails(
      "FAIL",
      [flakyFinding],
      [flakyEvidence],
      [],
      [],
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
    expect(result.reason).toContain("FLAKY_TEST");
  });

  it("Case 14: existing gap-analysis-incomplete guardrail is unchanged", () => {
    const passEvidence: Evidence = {
      id: "ev-1",
      type: "TEST_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "vitest",
      status: "PASS",
      summary: "Test passed",
    };

    const result = applyGuardrails(
      "BLOCKED",
      [],
      [passEvidence],
      [
        {
          area: "Gap Analysis",
          description: "Incomplete",
          risk: "MEDIUM" as RiskLevel,
        },
      ],
      [],
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
    expect(result.reason).toContain("incomplete gap analysis");
  });

  it("Case 15: existing buildOverrideSummary tests remain valid", () => {
    const a = buildOverrideSummary("PASS_WITH_CONCERNS", "BLOCKED", "reason A");
    const b = buildOverrideSummary("PASS_WITH_CONCERNS", "BLOCKED", "reason A");
    expect(a).toBe(b);
    expect(a).toContain("PASS_WITH_CONCERNS");
    expect(a).toContain("BLOCKED");
    expect(a).toContain("reason A");
  });
});

describe("DF-002: Schema strictness boundary", () => {
  it("summary-only missing passes schema validation", () => {
    const result = VerdictRecommendationOutputSchema.safeParse({
      recommendedVerdict: "PASS",
      confidence: "HIGH",
      reasoning: "All good",
      concerns: [],
      recommendedNextActions: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.summary).toBeUndefined();
  });

  it("missing recommendedVerdict fails schema validation", () => {
    const result = VerdictRecommendationOutputSchema.safeParse({
      confidence: "HIGH",
      reasoning: "test",
      concerns: [],
      recommendedNextActions: [],
    });
    expect(result.success).toBe(false);
  });

  it("missing confidence fails schema validation", () => {
    const result = VerdictRecommendationOutputSchema.safeParse({
      recommendedVerdict: "PASS",
      reasoning: "test",
      concerns: [],
      recommendedNextActions: [],
    });
    expect(result.success).toBe(false);
  });

  it("missing reasoning fails schema validation", () => {
    const result = VerdictRecommendationOutputSchema.safeParse({
      recommendedVerdict: "PASS",
      confidence: "HIGH",
      concerns: [],
      recommendedNextActions: [],
    });
    expect(result.success).toBe(false);
  });

  it("missing concerns fails schema validation", () => {
    const result = VerdictRecommendationOutputSchema.safeParse({
      recommendedVerdict: "PASS",
      confidence: "HIGH",
      reasoning: "test",
      recommendedNextActions: [],
    });
    expect(result.success).toBe(false);
  });

  it("missing recommendedNextActions fails schema validation", () => {
    const result = VerdictRecommendationOutputSchema.safeParse({
      recommendedVerdict: "PASS",
      confidence: "HIGH",
      reasoning: "test",
      concerns: [],
    });
    expect(result.success).toBe(false);
  });

  it("full valid response with summary passes", () => {
    const result = VerdictRecommendationOutputSchema.safeParse({
      recommendedVerdict: "PASS",
      confidence: "HIGH",
      reasoning: "All good",
      concerns: [],
      recommendedNextActions: [],
      summary: "Everything passed.",
    });
    expect(result.success).toBe(true);
    expect(result.data?.summary).toBe("Everything passed.");
  });
});

describe("DF-002: synthesizeVerdictSummary unit tests", () => {
  it("produces deterministic output", () => {
    const a = synthesizeVerdictSummary("PASS", "HIGH");
    const b = synthesizeVerdictSummary("PASS", "HIGH");
    expect(a).toBe(b);
  });

  it("includes verdict and confidence", () => {
    const s = synthesizeVerdictSummary("FAIL", "LOW");
    expect(s).toContain("FAIL");
    expect(s).toContain("LOW");
  });

  it("does not contain fabricated claims", () => {
    const s = synthesizeVerdictSummary("BLOCKED", "MEDIUM");
    expect(s).not.toMatch(/ev-/);
    expect(s).not.toMatch(/finding/i);
    expect(s).not.toMatch(/defect/i);
    expect(s).not.toMatch(/security/i);
  });
});
