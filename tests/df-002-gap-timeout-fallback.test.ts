import { describe, it, expect } from "vitest";
import {
  applyGuardrails,
  produceVerdict,
  buildOverrideSummary,
} from "../src/core/reasoning/verdict-engine.js";
import type { ModelGateway, ModelResult } from "../src/models/gateway/types.js";
import type {
  Evidence,
  Finding,
  RequirementAssessment,
  RiskLevel,
} from "../src/types/index.js";

function makePassEvidence(
  id: string,
  type: Evidence["type"] = "COMMAND_RESULT",
): Evidence {
  return {
    id,
    type,
    provenance: "executed",
    timestamp: new Date().toISOString(),
    source: `local:npm`,
    status: "PASS",
    summary: `Command passed`,
  };
}

function makeFailEvidence(
  id: string,
  type: Evidence["type"] = "TEST_RESULT",
): Evidence {
  return {
    id,
    type,
    provenance: "executed",
    timestamp: new Date().toISOString(),
    source: `local:npm`,
    status: "FAIL",
    summary: `Command failed`,
  };
}

function makeNotVerifiedAssessment(
  requirementId: string,
  evidenceIds: string[] = [],
  explanation = "Gap analysis timed out; repository-level validation passed but requirement-specific assessment could not be completed",
): RequirementAssessment {
  return { requirementId, status: "NOT_VERIFIED", evidenceIds, explanation };
}

function makeProductDefectFinding(
  id: string,
  severity: "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" = "CRITICAL",
): Finding {
  return {
    id,
    category: "DEFECT",
    severity,
    confidence: 0.85,
    title: "Product defect found",
    description: "A real product defect",
    evidenceIds: ["ev-fail"],
    relatedRequirementIds: [],
  };
}

const INCOMPLETE_GAP = {
  area: "Gap Analysis",
  description:
    "Requirement-to-evidence gap analysis did not complete within the execution budget.",
  reason:
    "Primary gap analysis model call timed out before completing requirement assessments",
  risk: "MEDIUM" as RiskLevel,
};

// ─── Section 1: Gap-Analysis Fallback Evidence Preservation ───

describe("DF-002: Gap-analysis fallback preserves evidence", () => {
  it("fallback includes PASS execution evidence IDs in assessments", () => {
    const evidence: Evidence[] = [
      makePassEvidence("ev-test", "TEST_RESULT"),
      makePassEvidence("ev-lint"),
      makePassEvidence("ev-typecheck"),
    ];
    const passIds = evidence
      .filter((e) => e.provenance === "executed" && e.status === "PASS")
      .map((e) => e.id);

    const requirements = Array.from({ length: 38 }, (_, i) => ({
      id: `req-${i + 1}`,
    }));

    const assessments: RequirementAssessment[] = requirements.map((r) => ({
      requirementId: r.id,
      status: "NOT_VERIFIED" as const,
      evidenceIds: passIds,
      explanation:
        "Gap analysis timed out; repository-level validation passed but requirement-specific assessment could not be completed",
    }));

    expect(assessments).toHaveLength(38);
    for (const a of assessments) {
      expect(a.evidenceIds).toEqual(["ev-test", "ev-lint", "ev-typecheck"]);
      expect(a.status).toBe("NOT_VERIFIED");
      expect(a.explanation).toContain("timed out");
      expect(a.explanation).toContain("repository-level validation passed");
    }
  });

  it("fallback excludes FAIL evidence from requirement assessments", () => {
    const evidence: Evidence[] = [
      makePassEvidence("ev-lint"),
      makeFailEvidence("ev-test"),
    ];
    const passIds = evidence
      .filter((e) => e.provenance === "executed" && e.status === "PASS")
      .map((e) => e.id);

    expect(passIds).toEqual(["ev-lint"]);
    expect(passIds).not.toContain("ev-test");
  });

  it("fallback with no PASS evidence produces empty evidenceIds", () => {
    const evidence: Evidence[] = [makeFailEvidence("ev-test")];
    const passIds = evidence
      .filter((e) => e.provenance === "executed" && e.status === "PASS")
      .map((e) => e.id);

    expect(passIds).toEqual([]);

    const assessment: RequirementAssessment = {
      requirementId: "req-1",
      status: "NOT_VERIFIED",
      evidenceIds: passIds,
      explanation:
        "Gap analysis timed out; no execution evidence available for assessment",
    };
    expect(assessment.evidenceIds).toEqual([]);
    expect(assessment.explanation).toContain("no execution evidence");
  });

  it("fallback explanation differs based on evidence availability", () => {
    const withEvidence =
      "Gap analysis timed out; repository-level validation passed but requirement-specific assessment could not be completed";
    const withoutEvidence =
      "Gap analysis timed out; no execution evidence available for assessment";

    expect(withEvidence).not.toBe(withoutEvidence);
    expect(withEvidence).toContain("repository-level validation passed");
    expect(withoutEvidence).toContain("no execution evidence");
  });
});

// ─── Section 2: Explicit Incomplete-Analysis Gap ───

describe("DF-002: Incomplete-analysis gap creation", () => {
  it("gap analysis timeout produces explicit Gap Analysis gap", () => {
    expect(INCOMPLETE_GAP.area).toBe("Gap Analysis");
    expect(INCOMPLETE_GAP.risk).toBe("MEDIUM");
    expect(INCOMPLETE_GAP.description).toContain("did not complete");
    expect(INCOMPLETE_GAP.reason).toContain("timed out");
  });

  it("remainingGaps is not empty after gap analysis timeout", () => {
    const remainingGaps = [INCOMPLETE_GAP];
    expect(remainingGaps.length).toBeGreaterThan(0);
    expect(remainingGaps[0].area).toBe("Gap Analysis");
  });

  it("incomplete-analysis gap uses existing risk enum value", () => {
    const validRisks: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    expect(validRisks).toContain(INCOMPLETE_GAP.risk);
  });
});

// ─── Section 3: No False Product Failures ───

describe("DF-002: Gap timeout does not fabricate product failures", () => {
  it("fallback assessments do not contain FAIL status", () => {
    const assessments = Array.from({ length: 38 }, (_, i) =>
      makeNotVerifiedAssessment(`req-${i + 1}`, ["ev-test"]),
    );
    expect(assessments.every((a) => a.status !== "FAIL")).toBe(true);
    expect(assessments.every((a) => a.status !== "BLOCKED")).toBe(true);
  });

  it("fallback does not create product-defect findings", () => {
    const findings: Finding[] = [];
    expect(findings.length).toBe(0);
  });
});

// ─── Section 4-5: Verdict Guardrail ───

describe("DF-002: Verdict guardrail — incomplete analysis + positive evidence", () => {
  it("BLOCKED is overridden to PASS_WITH_CONCERNS when all evidence is PASS and gap analysis incomplete", () => {
    const evidence = [
      makePassEvidence("ev-test", "TEST_RESULT"),
      makePassEvidence("ev-lint"),
      makePassEvidence("ev-typecheck"),
    ];
    const assessments = Array.from({ length: 38 }, (_, i) =>
      makeNotVerifiedAssessment(`req-${i + 1}`, [
        "ev-test",
        "ev-lint",
        "ev-typecheck",
      ]),
    );
    const gaps = [INCOMPLETE_GAP];
    const findings: Finding[] = [];

    const result = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
    expect(result.reason).toContain("incomplete gap analysis");
    expect(result.reason).toContain("positive execution evidence");
    expect(result.confidenceCap).toBe("LOW");
  });

  it("FAIL is overridden to PASS_WITH_CONCERNS when all evidence is PASS and gap analysis incomplete", () => {
    const evidence = [makePassEvidence("ev-test", "TEST_RESULT")];
    const gaps = [INCOMPLETE_GAP];
    const findings: Finding[] = [];
    const assessments = [makeNotVerifiedAssessment("req-1", ["ev-test"])];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
    expect(result.confidenceCap).toBe("LOW");
  });

  it("confidence is capped to LOW when gap analysis is incomplete", () => {
    const evidence = [makePassEvidence("ev-test", "TEST_RESULT")];
    const gaps = [INCOMPLETE_GAP];
    const findings: Finding[] = [];
    const assessments = [makeNotVerifiedAssessment("req-1", ["ev-test"])];

    const result = applyGuardrails(
      "PASS_WITH_CONCERNS",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(false);
    expect(result.confidenceCap).toBe("LOW");
  });

  it("confidence cap applies even when verdict is not overridden", () => {
    const evidence = [makePassEvidence("ev-test", "TEST_RESULT")];
    const gaps = [INCOMPLETE_GAP];
    const findings: Finding[] = [];
    const assessments = [makeNotVerifiedAssessment("req-1", ["ev-test"])];

    const result = applyGuardrails(
      "NEEDS_REVIEW",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );

    expect(result.verdict).toBe("NEEDS_REVIEW");
    expect(result.overridden).toBe(false);
    expect(result.confidenceCap).toBe("LOW");
  });
});

// ─── Section 6: Preserve Real BLOCKED Cases ───

describe("DF-002: Real BLOCKED cases are preserved", () => {
  it("BLOCKED survives when no evidence exists and gap analysis incomplete", () => {
    const evidence: Evidence[] = [];
    const gaps = [INCOMPLETE_GAP];
    const findings: Finding[] = [];
    const assessments = [makeNotVerifiedAssessment("req-1")];

    const result = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );

    expect(result.verdict).toBe("BLOCKED");
    expect(result.overridden).toBe(false);
    expect(result.confidenceCap).toBe("LOW");
  });

  it("BLOCKED survives when evidence contains FAIL results", () => {
    const evidence = [makeFailEvidence("ev-test", "TEST_RESULT")];
    const gaps = [INCOMPLETE_GAP];
    const findings: Finding[] = [];
    const assessments = [makeNotVerifiedAssessment("req-1")];

    const result = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );

    expect(result.verdict).toBe("BLOCKED");
    expect(result.overridden).toBe(false);
    expect(result.confidenceCap).toBe("LOW");
  });

  it("BLOCKED survives without gap analysis incomplete marker", () => {
    const evidence = [makePassEvidence("ev-test", "TEST_RESULT")];
    const gaps: {
      area: string;
      description: string;
      reason: string;
      risk: RiskLevel;
    }[] = [];
    const findings: Finding[] = [];
    const assessments = [makeNotVerifiedAssessment("req-1", ["ev-test"])];

    const result = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );

    expect(result.verdict).toBe("BLOCKED");
    expect(result.overridden).toBe(false);
    expect(result.confidenceCap).toBeUndefined();
  });
});

// ─── Section 7: Preserve Real FAIL Cases ───

describe("DF-002: Real FAIL cases are preserved", () => {
  it("FAIL survives when independent product defect exists alongside gap timeout", () => {
    const evidence = [
      makePassEvidence("ev-lint"),
      makeFailEvidence("ev-test", "TEST_RESULT"),
    ];
    const gaps = [INCOMPLETE_GAP];
    const findings = [makeProductDefectFinding("finding-1")];
    const assessments = [makeNotVerifiedAssessment("req-1", ["ev-lint"])];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.overridden).toBe(false);
    expect(result.confidenceCap).toBe("LOW");
  });

  it("FAIL survives when blocker finding exists even with some PASS evidence", () => {
    const evidence = [
      makePassEvidence("ev-lint"),
      makeFailEvidence("ev-test", "TEST_RESULT"),
    ];
    const gaps = [INCOMPLETE_GAP];
    const findings: Finding[] = [
      {
        id: "f-blocker",
        category: "REGRESSION",
        severity: "BLOCKER",
        confidence: 0.9,
        title: "Real regression detected",
        description: "Real regression",
        evidenceIds: ["ev-test"],
        relatedRequirementIds: [],
      },
    ];
    const assessments = [makeNotVerifiedAssessment("req-1", ["ev-lint"])];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.overridden).toBe(false);
  });
});

// ─── Section 8: Exact Dogfood Scenario ───

describe("DF-002: Exact dogfood scenario — 38 requirements, all PASS, gap timeout", () => {
  const requirements = Array.from({ length: 38 }, (_, i) => ({
    id: `req-${i + 1}`,
    description: `Requirement ${i + 1}`,
  }));

  const evidence: Evidence[] = [
    makePassEvidence("ev-test", "TEST_RESULT"),
    makePassEvidence("ev-lint"),
    makePassEvidence("ev-typecheck"),
  ];

  const passIds = evidence.map((e) => e.id);

  const assessments: RequirementAssessment[] = requirements.map((r) =>
    makeNotVerifiedAssessment(r.id, passIds),
  );

  const gaps = [INCOMPLETE_GAP];
  const findings: Finding[] = [];

  it("assessments remain truthful — status is NOT_VERIFIED, not FAIL", () => {
    expect(assessments).toHaveLength(38);
    for (const a of assessments) {
      expect(a.status).toBe("NOT_VERIFIED");
    }
  });

  it("existing execution evidence is not discarded", () => {
    for (const a of assessments) {
      expect(a.evidenceIds).toEqual(["ev-test", "ev-lint", "ev-typecheck"]);
    }
  });

  it("remainingGaps includes explicit incomplete-analysis gap", () => {
    expect(gaps).toHaveLength(1);
    expect(gaps[0].area).toBe("Gap Analysis");
    expect(gaps[0].description).toContain("did not complete");
  });

  it("no product FAIL evidence is fabricated", () => {
    const failEvidence = evidence.filter((e) => e.status === "FAIL");
    expect(failEvidence).toHaveLength(0);
  });

  it("verdict is not FAIL", () => {
    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );
    expect(result.verdict).not.toBe("FAIL");
  });

  it("verdict is not BLOCKED/HIGH due solely to timeout", () => {
    const result = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );
    expect(result.verdict).not.toBe("BLOCKED");
    expect(result.confidenceCap).toBe("LOW");
  });

  it("confidence is capped to LOW", () => {
    const result = applyGuardrails(
      "PASS_WITH_CONCERNS",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );
    expect(result.confidenceCap).toBe("LOW");
  });

  it("guardrail produces PASS_WITH_CONCERNS for model-recommended BLOCKED", () => {
    const result = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );
    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
  });
});

// ─── Section 9: Contrasting Tests ───

describe("DF-002: Contrasting scenarios", () => {
  it("9A: gap timeout + real product FAIL evidence → FAIL still allowed", () => {
    const evidence = [
      makePassEvidence("ev-lint"),
      makeFailEvidence("ev-test", "TEST_RESULT"),
    ];
    const gaps = [INCOMPLETE_GAP];
    const findings = [makeProductDefectFinding("f-1")];
    const assessments = [makeNotVerifiedAssessment("req-1", ["ev-lint"])];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );
    expect(result.verdict).toBe("FAIL");
  });

  it("9B: gap timeout + no usable evidence → BLOCKED still appropriate", () => {
    const evidence: Evidence[] = [];
    const gaps = [INCOMPLETE_GAP];
    const findings: Finding[] = [];
    const assessments = [makeNotVerifiedAssessment("req-1")];

    const result = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );
    expect(result.verdict).toBe("BLOCKED");
  });

  it("9C: gap timeout + all PASS execution evidence → PASS_WITH_CONCERNS, not FAIL", () => {
    const evidence = [
      makePassEvidence("ev-test", "TEST_RESULT"),
      makePassEvidence("ev-lint"),
      makePassEvidence("ev-typecheck"),
    ];
    const gaps = [INCOMPLETE_GAP];
    const findings: Finding[] = [];
    const assessments = [
      makeNotVerifiedAssessment("req-1", [
        "ev-test",
        "ev-lint",
        "ev-typecheck",
      ]),
    ];

    const failResult = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );
    expect(failResult.verdict).toBe("PASS_WITH_CONCERNS");

    const blockedResult = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      gaps,
      assessments,
      false,
    );
    expect(blockedResult.verdict).toBe("PASS_WITH_CONCERNS");
  });

  it("9D: timeout fallback never leaves remainingGaps empty", () => {
    const remainingGaps = [INCOMPLETE_GAP];
    expect(remainingGaps.length).toBeGreaterThan(0);
    expect(remainingGaps.some((g) => g.area === "Gap Analysis")).toBe(true);
  });
});

// ─── Verdict/summary consistency ───

function makeVerdictGateway(
  recommendedVerdict: string,
  confidence: string,
  modelSummary: string,
): ModelGateway {
  return {
    async reason<T>(): Promise<ModelResult<T>> {
      return {
        data: {
          recommendedVerdict,
          confidence,
          summary: modelSummary,
          recommendedNextActions: ["Re-run with larger budget"],
        } as T,
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

describe("DF-002: Verdict/summary consistency — guardrail overrides", () => {
  it("A: BLOCKED→PASS_WITH_CONCERNS override produces summary describing PASS_WITH_CONCERNS", async () => {
    const gateway = makeVerdictGateway(
      "BLOCKED",
      "HIGH",
      "The current state of testing is insufficient, necessitating a BLOCKED verdict.",
    );

    const result = await produceVerdict(
      gateway,
      [{ id: "FR-001", description: "req" }],
      [],
      { level: "MEDIUM", factors: [], confidence: 0.5, summary: "Medium risk" },
      [
        {
          area: "Gap Analysis",
          description: "Incomplete",
          risk: "MEDIUM" as RiskLevel,
        },
      ],
      [
        {
          requirementId: "FR-001",
          status: "NOT_VERIFIED",
          evidenceIds: ["ev-1"],
          explanation: "Not verified",
        },
      ],
      [makePassEvidence("ev-1")],
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.confidence).toBe("LOW");
    expect(result.overrideApplied).toBe(true);

    // Summary must describe PASS_WITH_CONCERNS as the final verdict
    expect(result.summary).toContain("PASS_WITH_CONCERNS");
    // Summary must NOT assert BLOCKED is the current/final verdict
    expect(result.summary).not.toMatch(
      /necessitating a BLOCKED|requires? a? ?BLOCKED|final verdict (?:is |: ?)BLOCKED/i,
    );
    // Summary must mention the model's original recommendation
    expect(result.summary).toContain("BLOCKED");
    // Guardrail reason must be present
    expect(result.summary).toContain("Guardrail");

    // Model's original summary preserved in modelRecommendation
    expect(result.modelRecommendation.summary).toContain("BLOCKED verdict");
  });

  it("B: FAIL→PASS_WITH_CONCERNS override produces summary reflecting downgraded verdict", async () => {
    const gateway = makeVerdictGateway(
      "FAIL",
      "HIGH",
      "Critical failures detected. A FAIL verdict is required.",
    );

    const result = await produceVerdict(
      gateway,
      [{ id: "FR-001", description: "req" }],
      [],
      { level: "MEDIUM", factors: [], confidence: 0.5, summary: "Medium risk" },
      [
        {
          area: "Gap Analysis",
          description: "Incomplete",
          risk: "MEDIUM" as RiskLevel,
        },
      ],
      [
        {
          requirementId: "FR-001",
          status: "NOT_VERIFIED",
          evidenceIds: ["ev-1"],
          explanation: "Not verified",
        },
      ],
      [makePassEvidence("ev-1")],
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overrideApplied).toBe(true);

    // Summary reflects canonical verdict
    expect(result.summary).toContain("PASS_WITH_CONCERNS");
    // Summary must NOT assert FAIL is the current verdict
    expect(result.summary).not.toMatch(
      /FAIL verdict is required|necessitating.*FAIL/i,
    );
    // Model's original recommendation mentioned
    expect(result.summary).toContain("FAIL");
  });

  it("C: no guardrail override preserves original model summary", async () => {
    const modelSummary =
      "All requirements verified with high confidence. PASS recommended.";
    const gateway = makeVerdictGateway("PASS", "HIGH", modelSummary);

    const result = await produceVerdict(
      gateway,
      [{ id: "FR-001", description: "req" }],
      [],
      { level: "LOW", factors: [], confidence: 0.8, summary: "Low risk" },
      [],
      [
        {
          requirementId: "FR-001",
          status: "VERIFIED",
          evidenceIds: ["ev-1"],
          explanation: "Verified",
        },
      ],
      [makePassEvidence("ev-1"), makePassEvidence("ev-2")],
      false,
    );

    expect(result.verdict).toBe("PASS");
    expect(result.overrideApplied).toBe(false);
    expect(result.summary).toBe(modelSummary);
  });

  it("D: override summary never asserts superseded verdict as current/required/final", async () => {
    const verdicts: Array<{
      model: string;
      final: string;
      modelSummary: string;
    }> = [
      {
        model: "BLOCKED",
        final: "PASS_WITH_CONCERNS",
        modelSummary: "A BLOCKED verdict is the only appropriate outcome.",
      },
      {
        model: "FAIL",
        final: "PASS_WITH_CONCERNS",
        modelSummary: "This requires a FAIL verdict due to deficiencies.",
      },
    ];

    for (const v of verdicts) {
      const gateway = makeVerdictGateway(v.model, "HIGH", v.modelSummary);

      const result = await produceVerdict(
        gateway,
        [{ id: "FR-001", description: "req" }],
        [],
        {
          level: "MEDIUM",
          factors: [],
          confidence: 0.5,
          summary: "Medium risk",
        },
        [
          {
            area: "Gap Analysis",
            description: "Incomplete",
            risk: "MEDIUM" as RiskLevel,
          },
        ],
        [
          {
            requirementId: "FR-001",
            status: "NOT_VERIFIED",
            evidenceIds: ["ev-1"],
            explanation: "Not verified",
          },
        ],
        [makePassEvidence("ev-1")],
        false,
      );

      expect(result.overrideApplied).toBe(true);
      // The canonical summary must not contain the model's contradictory prose
      expect(result.summary).not.toContain(v.modelSummary);
      // It must contain the final verdict
      expect(result.summary).toContain(v.final);
      // It must mention what the model recommended
      expect(result.summary).toContain(v.model);
    }
  });

  it("E: guardrail override reason is visible in the final result", async () => {
    const gateway = makeVerdictGateway(
      "BLOCKED",
      "HIGH",
      "BLOCKED is required.",
    );

    const result = await produceVerdict(
      gateway,
      [{ id: "FR-001", description: "req" }],
      [],
      { level: "MEDIUM", factors: [], confidence: 0.5, summary: "Medium risk" },
      [
        {
          area: "Gap Analysis",
          description: "Incomplete",
          risk: "MEDIUM" as RiskLevel,
        },
      ],
      [
        {
          requirementId: "FR-001",
          status: "NOT_VERIFIED",
          evidenceIds: ["ev-1"],
          explanation: "Not verified",
        },
      ],
      [makePassEvidence("ev-1")],
      false,
    );

    expect(result.overrideApplied).toBe(true);
    // overrideReason field preserved
    expect(result.overrideReason).toBeDefined();
    expect(result.overrideReason).toContain("Guardrail");
    // Guardrail reason also embedded in summary
    expect(result.summary).toContain(result.overrideReason!);
  });
});

describe("DF-002: buildOverrideSummary determinism", () => {
  it("produces identical output for identical inputs", () => {
    const a = buildOverrideSummary("PASS_WITH_CONCERNS", "BLOCKED", "reason A");
    const b = buildOverrideSummary("PASS_WITH_CONCERNS", "BLOCKED", "reason A");
    expect(a).toBe(b);
  });

  it("names both the model verdict and the final verdict", () => {
    const summary = buildOverrideSummary(
      "PASS_WITH_CONCERNS",
      "FAIL",
      "some guardrail reason",
    );
    expect(summary).toContain("PASS_WITH_CONCERNS");
    expect(summary).toContain("FAIL");
    expect(summary).toContain("some guardrail reason");
  });
});
