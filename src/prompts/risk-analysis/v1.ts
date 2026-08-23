import { z } from "zod";
import type { ReasoningTask } from "../../models/gateway/types.js";
import type { ReasoningContext } from "../../core/orchestrator/context-builder.js";

export const RiskAnalysisOutputSchema = z.object({
  level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  factors: z.array(
    z.object({
      factor: z.string(),
      reason: z.string(),
      weight: z.enum(["low", "medium", "high", "critical"]),
    }),
  ),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});

export type RiskAnalysisOutput = z.infer<typeof RiskAnalysisOutputSchema>;

export const PROMPT_VERSION = "risk-analysis-v1";

export function buildRiskAnalysisTask(
  ctx: ReasoningContext,
  changeAnalysis?: {
    summary: string;
    affectedComponents: { name: string; impact: string }[];
    behaviorChanges: { description: string; risk: string }[];
  },
): ReasoningTask<RiskAnalysisOutput> {
  return {
    role: "risk_analyst",
    objective:
      "Assess the risk level of this change or repository state. Consider change scope, business criticality, security sensitivity, data sensitivity, blast radius, test strength, authentication/authorization, financial logic, database changes, external integrations, concurrency, and public API changes. Explain which factors influenced the risk assessment.",
    context: {
      repositoryProfile: ctx.repositoryProfile,
      requirements: ctx.requirements,
      changeData: ctx.changeData ?? {},
      changeAnalysis: changeAnalysis ?? {},
      priorEvidence: ctx.priorEvidence,
      projectMemory: ctx.projectMemory ?? {},
    },
    outputSchema: RiskAnalysisOutputSchema,
    constraints: [
      "Do not build a pseudo-precise numerical risk algorithm.",
      "Cite the repository or change evidence that led to each risk factor.",
      "Model inference remains inference — do not present it as execution evidence.",
      "Do not assume implementation correctness.",
      "Attempt to identify what could break.",
      "Report uncertainty.",
      "Project memory describes observations from prior QE runs. Execution outcomes in memory (test pass/fail/timeout, command success/failure) are historical — they may not reflect current state. Do not state that tests currently fail or that a current defect exists based solely on historical memory. Historical observations may inform uncertainty or validation priority but must not be presented as current execution evidence.",
    ],
    maxTokens: 2048,
    promptVersion: PROMPT_VERSION,
  };
}
