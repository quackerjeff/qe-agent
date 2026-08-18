import { z } from "zod";
import type { ReasoningTask } from "../../models/gateway/types.js";
import type { ReasoningContext } from "../../core/orchestrator/context-builder.js";

export const ValidationPlanOutputSchema = z.object({
  objectives: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
    }),
  ),
  recommendedActions: z.array(
    z.object({
      commandId: z.string().optional(),
      type: z.enum([
        "BUILD",
        "TEST",
        "LINT",
        "TYPECHECK",
        "STATIC_ANALYSIS",
        "BROWSER",
        "API",
        "SOURCE_INSPECTION",
        "CUSTOM",
      ]),
      purpose: z.string(),
      priority: z.number().min(1).max(100),
      riskAddressed: z.array(z.string()),
      requirementIds: z.array(z.string()),
      browserActions: z.array(z.record(z.unknown())).optional(),
    }),
  ),
  identifiedRisks: z.array(z.string()),
  expectedCapabilities: z.array(z.string()),
  unavailableValidations: z.array(
    z.object({
      description: z.string(),
      reason: z.string(),
    }),
  ),
});

export type ValidationPlanOutput = z.infer<typeof ValidationPlanOutputSchema>;

export const PROMPT_VERSION = "validation-plan-v1";

export function buildValidationPlanTask(
  ctx: ReasoningContext,
  riskAssessment: {
    level: string;
    factors: { factor: string; reason: string }[];
    summary: string;
  },
  profile: "quick" | "standard" | "deep",
): ReasoningTask<ValidationPlanOutput> {
  return {
    role: "test_strategist",
    objective:
      "Determine what should be validated, why, which existing capabilities can validate it, and what remains unavailable. Create a structured validation plan. Select ONLY commands from the available discovered commands list. Do NOT invent arbitrary shell commands.",
    context: {
      repositoryProfile: ctx.repositoryProfile,
      requirements: ctx.requirements,
      changeData: ctx.changeData ?? {},
      riskAssessment,
      availableCommands: ctx.repositoryProfile.commands,
      availableCapabilities: ctx.repositoryProfile.capabilities,
      executionProfile: profile,
      priorEvidence: ctx.priorEvidence,
      projectMemory: ctx.projectMemory ?? {},
    },
    outputSchema: ValidationPlanOutputSchema,
    constraints: [
      "Select ONLY command IDs from the provided available commands list.",
      "Do NOT invent or suggest arbitrary shell commands.",
      "Prioritize cheap/high-signal checks first, focused tests next, broader tests after, expensive last.",
      `Profile is '${profile}': ${profile === "quick" ? "select minimal high-value actions" : profile === "standard" ? "balanced breadth and depth" : "thorough validation coverage"}.`,
      "If no existing command can validate a requirement, report it as an unavailable validation.",
      "Do not modify production code.",
      "Do not generate tests.",
    ],
    maxTokens: 2048,
    promptVersion: PROMPT_VERSION,
  };
}
