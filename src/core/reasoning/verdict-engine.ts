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
    evidence.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      summary: e.summary,
    })),
    budgetExhausted,
  );

  const modelResult = await gateway.reason(task);
  const recommendation = modelResult.data;

  const guardrailResult = applyGuardrails(
    recommendation.recommendedVerdict,
    findings,
    evidence,
    gaps,
    requirementAssessments,
    budgetExhausted,
  );

  return {
    verdict: guardrailResult.verdict,
    confidence: recommendation.confidence,
    summary: recommendation.summary,
    recommendedNextActions: recommendation.recommendedNextActions,
    modelRecommendation: recommendation,
    overrideApplied: guardrailResult.overridden,
    overrideReason: guardrailResult.reason,
    modelResult,
  };
}

function applyGuardrails(
  recommended: Verdict,
  findings: Finding[],
  evidence: Evidence[],
  gaps: { area: string; description: string; risk: RiskLevel }[],
  requirementAssessments: RequirementAssessment[],
  budgetExhausted: boolean,
): { verdict: Verdict; overridden: boolean; reason?: string } {
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

  const hasNoEvidence = evidence.length === 0;
  const hasCriticalGaps = gaps.some((g) => g.risk === "CRITICAL");
  const allRequirementsBlocked =
    requirementAssessments.length > 0 &&
    requirementAssessments.every(
      (a) => a.status === "BLOCKED" || a.status === "NOT_VERIFIED",
    );

  if (
    (hasNoEvidence || (hasCriticalGaps && allRequirementsBlocked)) &&
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

  const hasOnlyPassingTests =
    evidence.length > 0 &&
    evidence.every((e) => e.status === "PASS") &&
    evidence.length <= 1 &&
    gaps.length > 0;

  if (hasOnlyPassingTests && recommended === "PASS") {
    return {
      verdict: "PASS_WITH_CONCERNS",
      overridden: true,
      reason:
        "Guardrail: passing single test alone cannot produce PASS with remaining gaps",
    };
  }

  return { verdict: recommended, overridden: false };
}
