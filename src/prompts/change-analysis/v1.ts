import { z } from "zod";
import type { ReasoningTask } from "../../models/gateway/types.js";
import type { ReasoningContext } from "../../core/orchestrator/context-builder.js";

export const ChangeAnalysisOutputSchema = z.object({
  summary: z.string(),
  affectedComponents: z.array(
    z.object({
      name: z.string(),
      impact: z.string(),
    }),
  ),
  behaviorChanges: z.array(
    z.object({
      description: z.string(),
      risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    }),
  ),
  potentialBlastRadius: z.array(
    z.object({
      area: z.string(),
      reason: z.string(),
    }),
  ),
  unknowns: z.array(z.string()),
});

export type ChangeAnalysisOutput = z.infer<typeof ChangeAnalysisOutputSchema>;

export const PROMPT_VERSION = "change-analysis-v1";

export function buildChangeAnalysisTask(
  ctx: ReasoningContext,
): ReasoningTask<ChangeAnalysisOutput> {
  return {
    role: "change_analyst",
    objective:
      "Analyze the semantic impact of the code changes. Identify affected components, behavior changes, potential blast radius, and unknowns. Base analysis on the diff data and file changes provided.",
    context: {
      repositoryProfile: ctx.repositoryProfile,
      changeData: ctx.changeData ?? {},
      fileDiffs: ctx.fileDiffs ?? {},
    },
    outputSchema: ChangeAnalysisOutputSchema,
    constraints: [
      "Do not assume implementation correctness.",
      "Separate inference from execution evidence.",
      "Report uncertainty explicitly as unknowns.",
      "Do not claim actions occurred unless evidence exists.",
      "Base affected components on actual file changes, not speculation.",
    ],
    maxTokens: 2048,
    promptVersion: PROMPT_VERSION,
  };
}
