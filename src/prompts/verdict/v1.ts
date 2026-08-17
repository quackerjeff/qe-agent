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
  summary: z.string(),
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
  evidence: { id: string; type: string; status: string; summary: string }[],
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
    ],
    maxTokens: 2048,
    promptVersion: PROMPT_VERSION,
  };
}
