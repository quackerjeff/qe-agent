import { describe, it, expect } from "vitest";
import {
  applyGuardrails,
  produceVerdict,
  buildEvidenceClassificationMap,
} from "../src/core/reasoning/verdict-engine.js";
import { buildVerdictTask } from "../src/prompts/verdict/v1.js";
import { buildGapAnalysisTask } from "../src/prompts/gap-analysis/v1.js";
import { analyzeGaps } from "../src/core/reasoning/gap-analyzer.js";
import type { ModelGateway, ModelResult } from "../src/models/gateway/types.js";
import type {
  Evidence,
  Finding,
  RequirementAssessment,
  RiskLevel,
} from "../src/types/index.js";

interface EvidenceContext {
  id: string;
  type: string;
  status: string;
  summary: string;
  investigatedClassification?: string;
}

interface TaskContext {
  context: { collectedEvidence: EvidenceContext[] };
}

function makeFailEvidence(
  id: string,
  summary = "Command 'npm run test' failed with exit code 1",
): Evidence {
  return {
    id,
    type: "TEST_RESULT",
    provenance: "executed",
    timestamp: new Date().toISOString(),
    source: "local:npm run test",
    status: "FAIL",
    summary,
  };
}

function makePassEvidence(
  id: string,
  source = "local:npm",
  summary = "Command passed",
): Evidence {
  return {
    id,
    type: "COMMAND_RESULT",
    provenance: "executed",
    timestamp: new Date().toISOString(),
    source,
    status: "PASS",
    summary,
  };
}

function makeFlakyFinding(
  id: string,
  evidenceIds: string[],
  confidence = 0.7,
): Finding {
  return {
    id,
    category: "FLAKY_TEST",
    severity: "MEDIUM",
    confidence,
    title: "FLAKY: Command 'npm run test' failed with exit code 1",
    description: "Timing-sensitive assertion failure",
    evidenceIds,
  };
}

function makeDefectFinding(
  id: string,
  evidenceIds: string[],
  confidence = 0.85,
): Finding {
  return {
    id,
    category: "DEFECT",
    severity: "CRITICAL",
    confidence,
    title: "Product defect found",
    description: "A real product defect",
    evidenceIds,
  };
}

function makeRegressionFinding(
  id: string,
  evidenceIds: string[],
  confidence = 0.8,
): Finding {
  return {
    id,
    category: "REGRESSION",
    severity: "HIGH",
    confidence,
    title: "Regression detected",
    description: "Behavior change from baseline",
    evidenceIds,
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

const NOT_VERIFIED_ASSESSMENT: RequirementAssessment = {
  requirementId: "req-1",
  status: "NOT_VERIFIED",
  evidenceIds: [],
  explanation: "Gap analysis timed out",
};

function makeSpyVerdictGateway(
  recommendedVerdict: string,
  confidence: string,
  modelSummary: string,
): { gateway: ModelGateway; capturedTasks: unknown[] } {
  const capturedTasks: unknown[] = [];
  return {
    capturedTasks,
    gateway: {
      async reason<T>(task: unknown): Promise<ModelResult<T>> {
        capturedTasks.push(task);
        return {
          data: {
            recommendedVerdict,
            confidence,
            summary: modelSummary,
            reasoning: "Test reasoning",
            concerns: [],
            recommendedNextActions: ["Re-run tests"],
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
    },
  };
}

// ─── Section 1: Flaky-Only Failure Guardrail ───

describe("DF-002: Flaky-only failure guardrail", () => {
  it("1A: FAIL + only FLAKY_TEST finding → PASS_WITH_CONCERNS, confidenceCap LOW", () => {
    const evidence = [
      makeFailEvidence("ev-test"),
      makePassEvidence("ev-lint"),
      makePassEvidence("ev-typecheck"),
    ];
    const findings = [makeFlakyFinding("f-1", ["ev-test"])];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
    expect(result.confidenceCap).toBe("LOW");
    expect(result.reason).toContain("FLAKY_TEST");
    expect(result.reason).toContain("FAIL");
  });

  it("1B: BLOCKED + only FLAKY_TEST finding → PASS_WITH_CONCERNS, confidenceCap LOW", () => {
    const evidence = [makeFailEvidence("ev-test"), makePassEvidence("ev-lint")];
    const findings = [makeFlakyFinding("f-1", ["ev-test"])];

    const result = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
    expect(result.confidenceCap).toBe("LOW");
    expect(result.reason).toContain("FLAKY_TEST");
    expect(result.reason).toContain("BLOCKED");
  });

  it("1C: FAIL + FLAKY_TEST + independent DEFECT → FAIL preserved", () => {
    const evidence = [makeFailEvidence("ev-test"), makePassEvidence("ev-lint")];
    const findings = [
      makeFlakyFinding("f-flaky", ["ev-test"]),
      makeDefectFinding("f-defect", ["ev-test"]),
    ];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.overridden).toBe(false);
  });

  it("1D: FAIL + FLAKY_TEST + independent REGRESSION → FAIL preserved", () => {
    const evidence = [makeFailEvidence("ev-test"), makePassEvidence("ev-lint")];
    const findings = [
      makeFlakyFinding("f-flaky", ["ev-test"]),
      makeRegressionFinding("f-regression", ["ev-test"]),
    ];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.overridden).toBe(false);
  });

  it("1E: mixed FAILs — one flaky-classified, one unclassified → no override", () => {
    const evidence = [
      makeFailEvidence("ev-test-1"),
      makeFailEvidence("ev-test-2", "Command 'npm run e2e' failed"),
      makePassEvidence("ev-lint"),
    ];
    const findings = [makeFlakyFinding("f-flaky", ["ev-test-1"])];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.overridden).toBe(false);
  });

  it("1F: NEEDS_REVIEW + FLAKY_TEST → not overridden by flaky guardrail", () => {
    const evidence = [makeFailEvidence("ev-test"), makePassEvidence("ev-lint")];
    const findings = [makeFlakyFinding("f-1", ["ev-test"])];

    const result = applyGuardrails(
      "NEEDS_REVIEW",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("NEEDS_REVIEW");
  });

  it("1G: no FAIL evidence + FLAKY_TEST finding → flaky guardrail does not fire", () => {
    const evidence = [
      makePassEvidence("ev-lint"),
      makePassEvidence("ev-typecheck"),
    ];
    const findings = [makeFlakyFinding("f-1", ["ev-old"])];

    const result = applyGuardrails(
      "BLOCKED",
      findings,
      evidence,
      [],
      [],
      false,
    );

    expect(result.verdict).toBe("BLOCKED");
    expect(result.overridden).toBe(false);
  });

  it("1H: FLAKY_TEST with low-confidence DEFECT does not block override", () => {
    const evidence = [makeFailEvidence("ev-test"), makePassEvidence("ev-lint")];
    const findings = [
      makeFlakyFinding("f-flaky", ["ev-test"]),
      makeDefectFinding("f-weak-defect", ["ev-test"], 0.3),
    ];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
  });
});

// ─── Section 2: Evidence Classification Map ───

describe("DF-002: Evidence classification map", () => {
  it("2A: maps FLAKY_TEST finding to its evidence IDs", () => {
    const findings = [makeFlakyFinding("f-1", ["ev-test"])];
    const map = buildEvidenceClassificationMap(findings);

    expect(map.get("ev-test")).toBe("FLAKY_TEST");
    expect(map.size).toBe(1);
  });

  it("2B: maps multiple findings to their evidence IDs", () => {
    const findings = [
      makeFlakyFinding("f-1", ["ev-test-1"]),
      makeDefectFinding("f-2", ["ev-test-2"]),
    ];
    const map = buildEvidenceClassificationMap(findings);

    expect(map.get("ev-test-1")).toBe("FLAKY_TEST");
    expect(map.get("ev-test-2")).toBe("DEFECT");
    expect(map.size).toBe(2);
  });

  it("2C: first finding classification wins for same evidence ID", () => {
    const findings = [
      makeFlakyFinding("f-1", ["ev-test"]),
      makeDefectFinding("f-2", ["ev-test"]),
    ];
    const map = buildEvidenceClassificationMap(findings);

    expect(map.get("ev-test")).toBe("FLAKY_TEST");
  });

  it("2D: empty findings → empty map", () => {
    const map = buildEvidenceClassificationMap([]);
    expect(map.size).toBe(0);
  });

  it("2E: finding with multiple evidence IDs maps all", () => {
    const findings: Finding[] = [
      {
        id: "f-1",
        category: "REGRESSION",
        severity: "HIGH",
        confidence: 0.8,
        title: "Regression",
        description: "desc",
        evidenceIds: ["ev-1", "ev-2", "ev-3"],
      },
    ];
    const map = buildEvidenceClassificationMap(findings);

    expect(map.get("ev-1")).toBe("REGRESSION");
    expect(map.get("ev-2")).toBe("REGRESSION");
    expect(map.get("ev-3")).toBe("REGRESSION");
  });
});

// ─── Section 3: Exact Dogfood Regression Test ───

describe("DF-002: Exact dogfood regression — flaky test scenario", () => {
  it("3A: npm test FAIL + FLAKY_TEST, lint/typecheck PASS, gap incomplete → PASS_WITH_CONCERNS LOW", async () => {
    const { gateway } = makeSpyVerdictGateway(
      "BLOCKED",
      "HIGH",
      "Integration test failures indicate potential data-integrity issues and authentication vulnerabilities.",
    );

    const evidence: Evidence[] = [
      makeFailEvidence("ev-test"),
      makePassEvidence(
        "ev-lint",
        "local:npm run lint",
        "Command 'npm run lint' passed",
      ),
      makePassEvidence(
        "ev-typecheck",
        "local:npm run typecheck",
        "Command 'npm run typecheck' passed",
      ),
    ];

    const findings: Finding[] = [makeFlakyFinding("f-flaky", ["ev-test"])];

    const result = await produceVerdict(
      gateway,
      [{ id: "req-1", description: "test requirement" }],
      findings,
      {
        level: "HIGH",
        factors: [
          {
            factor: "Security sensitivity",
            reason: "Authentication and authorization logic present",
            weight: "high",
          },
        ],
        confidence: 0.6,
        summary: "High risk due to security-sensitive areas",
      },
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      evidence,
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.confidence).toBe("LOW");
    expect(result.overrideApplied).toBe(true);
    expect(result.overrideReason).toContain("FLAKY_TEST");

    // Deterministic summary must reference PASS_WITH_CONCERNS
    expect(result.summary).toContain("PASS_WITH_CONCERNS");
    // Must NOT claim "integration test" failures
    expect(result.summary).not.toMatch(/integration test/i);
    // Must NOT claim demonstrated authentication/security defects
    expect(result.summary).not.toMatch(
      /authentication vulnerabilit|data-integrity issues/i,
    );
    // Model's original summary preserved
    expect(result.modelRecommendation.summary).toContain(
      "Integration test failures",
    );
  });

  it("3B: verdict model receives evidence annotated with investigatedClassification", async () => {
    const { gateway, capturedTasks } = makeSpyVerdictGateway(
      "BLOCKED",
      "MEDIUM",
      "Failures observed.",
    );

    const evidence: Evidence[] = [
      makeFailEvidence("ev-test"),
      makePassEvidence("ev-lint"),
    ];
    const findings: Finding[] = [makeFlakyFinding("f-flaky", ["ev-test"])];

    await produceVerdict(
      gateway,
      [{ id: "req-1", description: "test" }],
      findings,
      { level: "MEDIUM", factors: [], confidence: 0.5, summary: "Medium risk" },
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      evidence,
      false,
    );

    const task = capturedTasks[0] as TaskContext;
    const verdictEvidence = task.context.collectedEvidence;

    const flakyEv = verdictEvidence.find((e) => e.id === "ev-test");
    expect(flakyEv!.investigatedClassification).toBe("FLAKY_TEST");
    expect(flakyEv!.status).toBe("FAIL");

    const lintEv = verdictEvidence.find((e) => e.id === "ev-lint");
    expect(lintEv!.investigatedClassification).toBeUndefined();
  });
});

// ─── Section 4: Verdict Prompt Constraints ───

describe("DF-002: Verdict prompt constraints", () => {
  it("4A: verdict task includes flaky classification constraint", () => {
    const task = buildVerdictTask(
      [{ id: "req-1", description: "test" }],
      [],
      { level: "LOW", summary: "Low risk" },
      [],
      [],
      [],
      false,
    );

    const constraints = task.constraints as string[];
    expect(
      constraints.some((c) => c.includes("FLAKY_TEST") && c.includes("flaky")),
    ).toBe(true);
  });

  it("4B: verdict task includes test category constraint", () => {
    const task = buildVerdictTask(
      [{ id: "req-1", description: "test" }],
      [],
      { level: "LOW", summary: "Low risk" },
      [],
      [],
      [],
      false,
    );

    const constraints = task.constraints as string[];
    expect(
      constraints.some(
        (c) =>
          c.includes("test type") &&
          c.includes("integration") &&
          c.includes("provenance"),
      ),
    ).toBe(true);
  });

  it("4C: verdict task includes risk-inference separation constraint", () => {
    const task = buildVerdictTask(
      [{ id: "req-1", description: "test" }],
      [],
      { level: "LOW", summary: "Low risk" },
      [],
      [],
      [],
      false,
    );

    const constraints = task.constraints as string[];
    expect(
      constraints.some(
        (c) =>
          c.includes("Risk assessment inferences") &&
          c.includes("not validation findings"),
      ),
    ).toBe(true);
  });
});

// ─── Section 5: Gap Analysis Annotation ───

describe("DF-002: Gap analysis evidence annotation", () => {
  it("5A: gap analysis task accepts investigatedClassification on evidence", () => {
    const task = buildGapAnalysisTask(
      [{ id: "req-1", description: "test" }],
      [
        {
          id: "ev-test",
          type: "TEST_RESULT",
          status: "FAIL",
          summary: "npm run test failed",
          investigatedClassification: "FLAKY_TEST",
        },
        {
          id: "ev-lint",
          type: "COMMAND_RESULT",
          status: "PASS",
          summary: "lint passed",
        },
      ],
      [{ id: "f-1", category: "FLAKY_TEST", title: "Flaky test" }],
      {
        level: "MEDIUM",
        factors: [{ factor: "test", reason: "r", weight: "medium" as const }],
      },
    );

    const evidence = (task.context as TaskContext["context"]).collectedEvidence;
    expect(evidence[0].investigatedClassification).toBe("FLAKY_TEST");
    expect(evidence[1].investigatedClassification).toBeUndefined();
  });

  it("5B: gap analysis constraints include flaky evidence handling", () => {
    const task = buildGapAnalysisTask(
      [{ id: "req-1", description: "test" }],
      [],
      [],
      { level: "LOW", factors: [] },
    );

    const constraints = task.constraints as string[];
    expect(
      constraints.some(
        (c) =>
          c.includes("FLAKY_TEST") &&
          c.includes("demonstrated product failure"),
      ),
    ).toBe(true);
  });

  it("5C: gap analysis constraints include test category restriction", () => {
    const task = buildGapAnalysisTask(
      [{ id: "req-1", description: "test" }],
      [],
      [],
      { level: "LOW", factors: [] },
    );

    const constraints = task.constraints as string[];
    expect(
      constraints.some(
        (c) => c.includes("test type") && c.includes("integration"),
      ),
    ).toBe(true);
  });

  it("5D: analyzeGaps annotates evidence with classification from findings", async () => {
    let capturedTask: TaskContext | null = null;
    const gateway: ModelGateway = {
      async reason<T>(task: unknown): Promise<ModelResult<T>> {
        capturedTask = task as TaskContext;
        return {
          data: {
            gaps: [],
            requirementAssessments: [
              {
                requirementId: "req-1",
                status: "NOT_VERIFIED",
                evidenceIds: [],
                explanation: "test",
              },
            ],
          } as T,
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
          model: "test",
          provider: "fake",
          durationMs: 50,
          startedAt: new Date().toISOString(),
          retryCount: 0,
          promptVersion: "v1",
        };
      },
    };

    const evidence: Evidence[] = [
      makeFailEvidence("ev-test"),
      makePassEvidence("ev-lint"),
    ];
    const findings: Finding[] = [makeFlakyFinding("f-1", ["ev-test"])];

    await analyzeGaps(
      gateway,
      [{ id: "req-1", description: "test requirement" }],
      evidence,
      findings,
      { level: "MEDIUM", factors: [], confidence: 0.5, summary: "Medium risk" },
    );

    const gapEvidence = capturedTask.context.collectedEvidence;
    expect(gapEvidence[0].investigatedClassification).toBe("FLAKY_TEST");
    expect(gapEvidence[0].status).toBe("FAIL");
    expect(gapEvidence[1].investigatedClassification).toBeUndefined();
  });
});

// ─── Section 6: Contrasting Legitimate Failures ───

describe("DF-002: Contrasting legitimate failures", () => {
  it("6A: reproducible PRODUCT_DEFECT classification → FAIL preserved", () => {
    const evidence = [makeFailEvidence("ev-test"), makePassEvidence("ev-lint")];
    const findings = [makeDefectFinding("f-defect", ["ev-test"])];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.overridden).toBe(false);
  });

  it("6B: FLAKY_TEST + independent security DEFECT → DEFECT authoritative", () => {
    const evidence = [
      makeFailEvidence("ev-test-1"),
      makeFailEvidence("ev-test-2", "Security test failure: auth bypass"),
    ];
    const findings = [
      makeFlakyFinding("f-flaky", ["ev-test-1"]),
      {
        id: "f-security",
        category: "DEFECT" as const,
        severity: "CRITICAL" as const,
        confidence: 0.9,
        title: "Security: authentication bypass in login handler",
        description: "Demonstrated authentication bypass",
        evidenceIds: ["ev-test-2"],
      },
    ];

    const result = applyGuardrails("FAIL", findings, evidence, [], [], false);

    expect(result.verdict).toBe("FAIL");
    expect(result.overridden).toBe(false);
  });

  it("6C: REGRESSION finding with confidence >= 0.5 blocks flaky override", () => {
    const evidence = [makeFailEvidence("ev-test"), makePassEvidence("ev-lint")];
    const findings = [
      makeFlakyFinding("f-flaky", ["ev-test"]),
      makeRegressionFinding("f-regression", ["ev-other"], 0.6),
    ];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.overridden).toBe(false);
  });

  it("6D: all FAILs flaky + SECURITY_CONCERN (not DEFECT) → override still fires", () => {
    const evidence = [makeFailEvidence("ev-test"), makePassEvidence("ev-lint")];
    const findings: Finding[] = [
      makeFlakyFinding("f-flaky", ["ev-test"]),
      {
        id: "f-concern",
        category: "SECURITY_CONCERN",
        severity: "HIGH",
        confidence: 0.7,
        title: "Potential security concern",
        description: "Inferred risk",
        evidenceIds: [],
      },
    ];

    const result = applyGuardrails(
      "FAIL",
      findings,
      evidence,
      [INCOMPLETE_GAP],
      [NOT_VERIFIED_ASSESSMENT],
      false,
    );

    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
  });
});

// ─── Section 7: Generic Test Category Handling ───

describe("DF-002: Generic test category handling", () => {
  it("7A: verdict evidence for generic npm run test has no test type classification", () => {
    const task = buildVerdictTask(
      [{ id: "req-1", description: "test" }],
      [
        {
          id: "f-1",
          category: "FLAKY_TEST",
          severity: "MEDIUM",
          confidence: 0.7,
          title: "FLAKY: Command 'npm run test' failed",
        },
      ],
      { level: "MEDIUM", summary: "Medium risk" },
      [],
      [],
      [
        {
          id: "ev-test",
          type: "TEST_RESULT",
          status: "FAIL",
          summary: "Command 'npm run test' failed with exit code 1",
          investigatedClassification: "FLAKY_TEST",
        },
      ],
      false,
    );

    const evidence = (task.context as TaskContext["context"]).collectedEvidence;
    expect(evidence[0].summary).not.toMatch(/integration/i);
    expect(evidence[0].type).toBe("TEST_RESULT");
  });

  it("7B: constraint explicitly disallows inferring integration from generic command", () => {
    const task = buildVerdictTask(
      [],
      [],
      { level: "LOW", summary: "Low risk" },
      [],
      [],
      [],
      false,
    );

    const constraints = task.constraints as string[];
    const testCategoryConstraint = constraints.find((c) =>
      c.includes("unknown test category"),
    );
    expect(testCategoryConstraint).toBeDefined();
    expect(testCategoryConstraint).toContain("not integration");
  });
});

// ─── Section 8: Speculation Separation ───

describe("DF-002: Speculation separation", () => {
  it("8A: risk-inference constraint separates inferred risk from validation findings", () => {
    const task = buildVerdictTask(
      [],
      [],
      { level: "HIGH", summary: "High risk due to security areas" },
      [],
      [],
      [],
      false,
    );

    const constraints = task.constraints as string[];
    const riskConstraint = constraints.find((c) =>
      c.includes("Risk assessment inferences"),
    );
    expect(riskConstraint).toBeDefined();
    expect(riskConstraint).toContain("demonstrated defects");
    expect(riskConstraint).toContain("execution evidence");
  });

  it("8B: gap analysis does NOT include speculation separation constraint (not its role)", () => {
    const task = buildGapAnalysisTask([], [], [], {
      level: "LOW",
      factors: [],
    });

    const constraints = task.constraints as string[];
    expect(
      constraints.some((c) => c.includes("Risk assessment inferences")),
    ).toBe(false);
  });
});
