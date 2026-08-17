import { z } from "zod";
import type { ReasoningTask } from "../../models/gateway/types.js";

export const FailureAnalysisOutputSchema = z.object({
  likelyCause: z.enum([
    "PRODUCT_DEFECT",
    "REGRESSION",
    "TEST_DEFECT",
    "ENVIRONMENT_ISSUE",
    "FLAKY",
    "UNKNOWN",
  ]),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  suggestRetry: z.boolean(),
  suggestBaselineComparison: z.boolean(),
  affectedFiles: z.array(z.string()),
  relatedRequirementIds: z.array(z.string()),
});

export type FailureAnalysisOutput = z.infer<typeof FailureAnalysisOutputSchema>;

export const PROMPT_VERSION = "failure-analysis-v1";

export function buildFailureAnalysisTask(
  failedEvidence: {
    id: string;
    summary: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    command: string;
  },
  changeData?: Record<string, unknown>,
  requirements?: { id: string; description: string }[],
): ReasoningTask<FailureAnalysisOutput> {
  return {
    role: "failure_investigator",
    objective:
      "Investigate why a validation action failed. Classify the likely cause. A failed validation action is NOT automatically a product defect — it could be a test defect, environment issue, or flaky behavior.",
    context: {
      failedExecution: failedEvidence,
      changeData: changeData ?? {},
      requirements: requirements ?? [],
    },
    outputSchema: FailureAnalysisOutputSchema,
    constraints: [
      "Do not assume a failure is a product defect without supporting evidence.",
      "Consider environment issues, test defects, and flakiness as alternatives.",
      "Report uncertainty.",
      "Do not generate new tests.",
      "Do not modify production source.",
      "Potential flaky behavior should become a finding, not be hidden.",
    ],
    maxTokens: 1536,
    promptVersion: PROMPT_VERSION,
  };
}
