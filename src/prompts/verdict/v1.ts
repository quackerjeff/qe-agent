import { z } from "zod";
import type { ReasoningTask } from "../../models/gateway/types.js";

export const VerdictRecommendationOutputSchema = z.object({
  recommendedVerdict: z.enum([
    "PASS",
    "PASS_WITH_CONCERNS",
    "NEEDS_REVIEW",
    "FAIL",
    "BLOCKED",
  ]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reasoning: z.string(),
  concerns: z.array(z.string()),
  recommendedNextActions: z.array(z.string()),
  summary: z.string().optional(),
});

export type VerdictRecommendationOutput = z.infer<
  typeof VerdictRecommendationOutputSchema
>;

export const PROMPT_VERSION = "verdict-v1";

export function buildVerdictTask(
  requirements: { id: string; description: string }[],
  findings: {
    id: string;
    category: string;
    severity: string;
    confidence: number;
    title: string;
  }[],
  riskAssessment: { level: string; summary: string },
  gaps: { area: string; description: string; risk: string }[],
  requirementAssessments: {
    requirementId: string;
    status: string;
    explanation: string;
  }[],
  evidence: {
    id: string;
    type: string;
    status: string;
    summary: string;
    details?: Record<string, unknown>;
    investigatedClassification?: string;
  }[],
  budgetExhausted: boolean,
): ReasoningTask<VerdictRecommendationOutput> {
  return {
    role: "verdict_reviewer",
    objective:
      "Recommend a QE verdict based on all available evidence, findings, risk, gaps, and requirement assessments. The final verdict is produced by a deterministic Verdict Engine that may override this recommendation — you are providing a recommendation, not making the final decision.",
    context: {
      requirements,
      findings,
      riskAssessment,
      remainingGaps: gaps,
      requirementAssessments,
      collectedEvidence: evidence,
      budgetExhausted,
    },
    outputSchema: VerdictRecommendationOutputSchema,
    constraints: [
      "Passing one test command SHALL NOT automatically produce PASS.",
      "A demonstrated material defect or regression should produce FAIL.",
      "Critical required validation that could not be performed should produce BLOCKED.",
      "Evidence conflicts or material uncertainty should produce NEEDS_REVIEW.",
      "No blocking defect but meaningful residual risk should produce PASS_WITH_CONCERNS.",
      "PASS requires no material defect identified AND available evidence strongly supports expected behavior.",
      "Do not assume implementation correctness.",
      "Separate inference from execution evidence.",
      "If evidence has investigatedClassification: FLAKY_TEST, the failure was classified as likely flaky by failure investigation and does not demonstrate a product defect. Flaky-classified failures should not independently justify FAIL or BLOCKED.",
      "Do not classify a test failure by test type (integration, e2e, API, browser, component, contract) unless the evidence explicitly contains test-category provenance. A generic command failure such as 'npm run test failed' must be described generically (e.g., 'repository test suite failure') — unknown test category is not integration.",
      "Risk assessment inferences (security sensitivity, data sensitivity, authentication concerns) are not validation findings. Do not present inferred risks as demonstrated defects in the summary or concerns unless specific execution evidence or findings substantiate them.",
    ],
    maxTokens: 2048,
    promptVersion: PROMPT_VERSION,
  };
}
