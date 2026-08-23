import type { ModelGateway, ModelResult } from "../../models/gateway/types.js";
import type {
  Verdict,
  Confidence,
  Finding,
  Evidence,
  RequirementAssessment,
  RiskAssessment,
  RiskLevel,
  Requirement,
} from "../../types/index.js";
import {
  buildVerdictTask,
  type VerdictRecommendationOutput,
} from "../../prompts/verdict/v1.js";
import { projectEvidenceForModel } from "../orchestrator/evidence-projection.js";

export interface VerdictResult {
  verdict: Verdict;
  confidence: Confidence;
  summary: string;
  recommendedNextActions: string[];
  modelRecommendation: VerdictRecommendationOutput;
  overrideApplied: boolean;
  overrideReason?: string;
  modelResult: ModelResult<VerdictRecommendationOutput>;
}

export async function produceVerdict(
  gateway: ModelGateway,
  requirements: Requirement[],
  findings: Finding[],
  riskAssessment: RiskAssessment,
  gaps: { area: string; description: string; risk: RiskLevel }[],
  requirementAssessments: RequirementAssessment[],
  evidence: Evidence[],
  budgetExhausted: boolean,
): Promise<VerdictResult> {
  // Exclude TEST_DEFECT generated-test evidence from verdict model input
  // so the model does not treat defective generated tests as product failures.
  // The evidence is still available to guardrails and retained in the result.
  const verdictEvidence = evidence.filter(
    (e) =>
      !(
        e.generatedTestProvenance?.failureClassification === "TEST_DEFECT" ||
        (e.generatedTestProvenance != null && e.status === "INCONCLUSIVE")
      ),
  );

  const classificationMap = buildEvidenceClassificationMap(findings);

  const task = buildVerdictTask(
    requirements.map((r) => ({ id: r.id, description: r.description })),
    findings.map((f) => ({
      id: f.id,
      category: f.category,
      severity: f.severity,
      confidence: f.confidence,
      title: f.title,
    })),
    { level: riskAssessment.level, summary: riskAssessment.summary },
    gaps,
    requirementAssessments.map((a) => ({
      requirementId: a.requirementId,
      status: a.status,
      explanation: a.explanation,
    })),
    projectEvidenceForModel(verdictEvidence, classificationMap),
    budgetExhausted,
  );

  const modelResult = await gateway.reason(task);
  let recommendation = modelResult.data;

  if (recommendation.summary === undefined) {
    recommendation = {
      ...recommendation,
      summary: synthesizeVerdictSummary(
        recommendation.recommendedVerdict,
        recommendation.confidence,
      ),
    };
  }

  const guardrailResult = applyGuardrails(
    recommendation.recommendedVerdict,
    findings,
    evidence,
    gaps,
    requirementAssessments,
    budgetExhausted,
  );

  const confidenceOrder: Confidence[] = ["LOW", "MEDIUM", "HIGH"];
  const modelConfidence = recommendation.confidence;
  const finalConfidence =
    guardrailResult.confidenceCap &&
    confidenceOrder.indexOf(modelConfidence) >
      confidenceOrder.indexOf(guardrailResult.confidenceCap)
      ? guardrailResult.confidenceCap
      : modelConfidence;

  const finalSummary = guardrailResult.overridden
    ? buildOverrideSummary(
        guardrailResult.verdict,
        recommendation.recommendedVerdict,
        guardrailResult.reason!,
      )
    : recommendation.summary!;

  return {
    verdict: guardrailResult.verdict,
    confidence: finalConfidence,
    summary: finalSummary,
    recommendedNextActions: recommendation.recommendedNextActions,
    modelRecommendation: recommendation,
    overrideApplied: guardrailResult.overridden,
    overrideReason: guardrailResult.reason,
    modelResult,
  };
}

export function buildOverrideSummary(
  finalVerdict: Verdict,
  modelVerdict: Verdict,
  guardrailReason: string,
): string {
  return (
    `Verdict adjusted: the model recommended ${modelVerdict}, ` +
    `but deterministic guardrails set the final verdict to ${finalVerdict}. ` +
    `Reason: ${guardrailReason}`
  );
}

export function synthesizeVerdictSummary(
  verdict: string,
  confidence: string,
): string {
  return `Verdict recommendation: ${verdict} with ${confidence} confidence.`;
}

export function buildEvidenceClassificationMap(
  findings: Finding[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of findings) {
    for (const eid of f.evidenceIds) {
      if (!map.has(eid)) {
        map.set(eid, f.category);
      }
    }
  }
  return map;
}

export function applyGuardrails(
  recommended: Verdict,
  findings: Finding[],
  evidence: Evidence[],
  gaps: { area: string; description: string; risk: RiskLevel }[],
  requirementAssessments: RequirementAssessment[],
  budgetExhausted: boolean,
): {
  verdict: Verdict;
  overridden: boolean;
  reason?: string;
  confidenceCap?: Confidence;
} {
  const hasBlockerFinding = findings.some(
    (f) =>
      (f.category === "DEFECT" || f.category === "REGRESSION") &&
      (f.severity === "BLOCKER" || f.severity === "CRITICAL") &&
      f.confidence >= 0.7,
  );

  if (hasBlockerFinding && recommended === "PASS") {
    return {
      verdict: "FAIL",
      overridden: true,
      reason:
        "Guardrail: demonstrated material defect/regression overrides PASS recommendation",
    };
  }

  const hasNoExecutionEvidence = !evidence.some(
    (e) => e.provenance === "executed",
  );
  const hasCriticalGaps = gaps.some((g) => g.risk === "CRITICAL");
  const allRequirementsBlocked =
    requirementAssessments.length > 0 &&
    requirementAssessments.every(
      (a) => a.status === "BLOCKED" || a.status === "NOT_VERIFIED",
    );

  if (
    (hasNoExecutionEvidence || (hasCriticalGaps && allRequirementsBlocked)) &&
    recommended === "PASS"
  ) {
    return {
      verdict: "BLOCKED",
      overridden: true,
      reason:
        "Guardrail: insufficient evidence for defensible assessment overrides PASS",
    };
  }

  if (budgetExhausted && recommended === "PASS") {
    return {
      verdict: "PASS_WITH_CONCERNS",
      overridden: true,
      reason:
        "Guardrail: budget exhausted before full validation — downgrading PASS to PASS_WITH_CONCERNS",
    };
  }

  const singleTestEvidence = evidence.filter(
    (e) => e.provenance === "executed",
  );
  const hasOnlyPassingTests =
    singleTestEvidence.length > 0 &&
    singleTestEvidence.every((e) => e.status === "PASS") &&
    singleTestEvidence.length <= 1 &&
    gaps.length > 0;

  if (hasOnlyPassingTests && recommended === "PASS") {
    return {
      verdict: "PASS_WITH_CONCERNS",
      overridden: true,
      reason:
        "Guardrail: passing single test alone cannot produce PASS with remaining gaps",
    };
  }

  // Generated-test-only FAIL guardrail: if the only failure evidence comes
  // from generated tests classified as TEST_DEFECT (or INCONCLUSIVE due to
  // import validation), and no independent product-defect finding exists,
  // the verdict must not be FAIL.
  if (recommended === "FAIL") {
    const failEvidence = evidence.filter(
      (e) => e.status === "FAIL" || e.status === "INCONCLUSIVE",
    );
    const allFailsAreGeneratedTestDefects =
      failEvidence.length > 0 &&
      failEvidence.every(
        (e) =>
          e.generatedTestProvenance != null &&
          (e.generatedTestProvenance.failureClassification === "TEST_DEFECT" ||
            e.status === "INCONCLUSIVE"),
      );
    const hasIndependentProductDefect = findings.some(
      (f) =>
        (f.category === "DEFECT" || f.category === "REGRESSION") &&
        f.confidence >= 0.5 &&
        !f.evidenceIds.every((eid) => {
          const ev = evidence.find((e) => e.id === eid);
          return ev?.generatedTestProvenance != null;
        }),
    );

    if (allFailsAreGeneratedTestDefects && !hasIndependentProductDefect) {
      return {
        verdict: "PASS_WITH_CONCERNS",
        overridden: true,
        reason:
          "Guardrail: generated-test TEST_DEFECT failures cannot drive product FAIL without independent product-defect evidence",
      };
    }
  }

  if (recommended === "FAIL" || recommended === "BLOCKED") {
    const failExecutionEvidence = evidence.filter(
      (e) => e.status === "FAIL" && e.provenance === "executed",
    );

    if (failExecutionEvidence.length > 0) {
      const flakyEvidenceIds = new Set(
        findings
          .filter((f) => f.category === "FLAKY_TEST")
          .flatMap((f) => f.evidenceIds),
      );

      const allFailsAreFlakyClassified = failExecutionEvidence.every((e) =>
        flakyEvidenceIds.has(e.id),
      );

      const hasIndependentProductFailure = findings.some(
        (f) =>
          (f.category === "DEFECT" || f.category === "REGRESSION") &&
          f.confidence >= 0.5,
      );

      if (allFailsAreFlakyClassified && !hasIndependentProductFailure) {
        return {
          verdict: "PASS_WITH_CONCERNS",
          overridden: true,
          reason:
            "Guardrail: all execution failures were classified as FLAKY_TEST by failure investigation — flaky-only failures cannot independently drive " +
            recommended,
          confidenceCap: "LOW",
        };
      }
    }
  }

  const gapAnalysisIncomplete = gaps.some((g) => g.area === "Gap Analysis");
  if (gapAnalysisIncomplete) {
    const executedEvidence = evidence.filter(
      (e) => e.provenance === "executed",
    );
    const allExecutedPositive =
      executedEvidence.length > 0 &&
      executedEvidence.every(
        (e) => e.status === "PASS" || e.status === "INCONCLUSIVE",
      );
    const hasProductDefectFinding = findings.some(
      (f) =>
        (f.category === "DEFECT" || f.category === "REGRESSION") &&
        f.confidence >= 0.5,
    );

    if (allExecutedPositive && !hasProductDefectFinding) {
      if (recommended === "FAIL") {
        return {
          verdict: "PASS_WITH_CONCERNS",
          overridden: true,
          reason:
            "Guardrail: incomplete gap analysis with positive execution evidence cannot drive FAIL without demonstrated product defect",
          confidenceCap: "LOW",
        };
      }
      if (recommended === "BLOCKED") {
        return {
          verdict: "PASS_WITH_CONCERNS",
          overridden: true,
          reason:
            "Guardrail: incomplete gap analysis with positive execution evidence cannot drive BLOCKED when no product failure was demonstrated",
          confidenceCap: "LOW",
        };
      }
    }

    return {
      verdict: recommended,
      overridden: false,
      confidenceCap: "LOW",
    };
  }

  return { verdict: recommended, overridden: false };
}
