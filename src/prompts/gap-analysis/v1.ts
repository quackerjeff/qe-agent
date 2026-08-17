import { z } from "zod";
import type { ReasoningTask } from "../../models/gateway/types.js";

export const GapAnalysisOutputSchema = z.object({
  gaps: z.array(
    z.object({
      area: z.string(),
      description: z.string(),
      reason: z.string(),
      risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    }),
  ),
  requirementAssessments: z.array(
    z.object({
      requirementId: z.string(),
      status: z.enum([
        "VERIFIED",
        "PARTIALLY_VERIFIED",
        "NOT_VERIFIED",
        "BLOCKED",
        "NOT_APPLICABLE",
      ]),
      evidenceIds: z.array(z.string()),
      explanation: z.string(),
    }),
  ),
});

export type GapAnalysisOutput = z.infer<typeof GapAnalysisOutputSchema>;

export const PROMPT_VERSION = "gap-analysis-v1";

export function buildGapAnalysisTask(
  requirements: {
    id: string;
    description: string;
    acceptanceCriteria?: { id: string; description: string }[];
  }[],
  evidence: { id: string; type: string; status: string; summary: string }[],
  findings: { id: string; category: string; title: string }[],
  riskAssessment: { level: string; factors: { factor: string }[] },
  changeData?: Record<string, unknown>,
): ReasoningTask<GapAnalysisOutput> {
  return {
    role: "gap_analyst",
    objective:
      "Analyze what important behavior remains unverified. Map evidence to supplied requirements. Each requirement should receive an assessment. A criterion SHALL NOT become VERIFIED solely because source code appears to implement it — evidence must support verification.",
    context: {
      requirements,
      collectedEvidence: evidence,
      findings,
      riskAssessment,
      changeData: changeData ?? {},
    },
    outputSchema: GapAnalysisOutputSchema,
    constraints: [
      "A requirement is NOT VERIFIED solely because code implements it.",
      "Evidence must support verification status.",
      "Report all meaningful unverified behavior as gaps.",
      "Do not claim actions occurred unless evidence exists.",
      "Separate inference from execution.",
      "Do not generate tests — report TEST_GAP instead.",
    ],
    maxTokens: 2048,
    promptVersion: PROMPT_VERSION,
  };
}
