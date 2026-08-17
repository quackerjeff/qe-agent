import { z } from "zod";
import type { ReasoningTask } from "../../models/gateway/types.js";
import { TestGenerationPlanSchema } from "../../types/index.js";

export const TestGenerationDecisionSchema = z.object({
  shouldGenerate: z.boolean(),
  reason: z.string(),
  plans: z.array(TestGenerationPlanSchema),
  proposals: z.array(
    z.object({
      filePath: z.string(),
      operation: z.enum(["CREATE", "MODIFY"]),
      classification: z.enum([
        "PERMANENT_REGRESSION",
        "CANDIDATE",
        "INVESTIGATIVE",
      ]),
      rationale: z.string(),
      content: z.string(),
      planIndex: z.number().nonnegative(),
      requirementIds: z.array(z.string()),
    }),
  ),
});

export type TestGenerationDecision = z.infer<
  typeof TestGenerationDecisionSchema
>;

export const PROMPT_VERSION = "test-generation-v1.1";

export function buildTestGenerationTask(
  context: {
    requirements: { id: string; description: string }[];
    gaps: { area: string; description: string; risk: string }[];
    findings: { id: string; category: string; title: string }[];
    testContext: {
      testFramework: string;
      conventions: {
        namingPattern: string;
        testDirectory: string;
        importStyle: string;
        assertionLibrary: string;
        fixturePatterns: string[];
      };
      relatedTestFiles: { path: string; content: string }[];
    };
    riskLevel: string;
    changedFiles?: string[];
    profile: string;
  },
  maxTests: number,
): ReasoningTask<TestGenerationDecision> {
  return {
    role: "test_generator",
    objective: `Analyze quality gaps and determine whether generating targeted tests would produce meaningful evidence for important unverified behavior. If yes, first produce structured generation plans, then up to ${maxTests} test proposal(s) each referencing a plan.`,
    context: {
      requirements: context.requirements,
      identifiedGaps: context.gaps,
      findings: context.findings,
      existingTestConventions: context.testContext,
      riskLevel: context.riskLevel,
      changedFiles: context.changedFiles ?? [],
      executionProfile: context.profile,
    },
    constraints: [
      "Generate tests ONLY when a requirement lacks sufficient evidence, a changed behavior has no meaningful coverage, a demonstrated defect should receive regression protection, a significant negative/boundary scenario is missing, or an important risk can be exercised with available test infrastructure.",
      "Do NOT generate tests merely because code coverage is below an arbitrary percentage, a file changed, more tests appear superficially useful, or you want to increase test count.",
      "Each proposal MUST reference a plan via planIndex and carry the requirementIds from that plan.",
      "plans[] must contain a structured generation plan for each distinct test objective. Each plan must have: objective, targetBehavior, requirementIds (from the relevant requirements), targetTestFramework, targetLocation, classification, and expectedEvidence.",
      "Generated tests MUST follow the existing repository test conventions shown in existingTestConventions.",
      "Generated tests MUST target meaningful behavior with deterministic assertions.",
      "Generated tests MUST NOT modify production/application source code.",
      "Generated tests MUST NOT weaken existing assertions.",
      "Generated tests MUST NOT delete existing tests or mark them as skipped.",
      "Generated tests MUST NOT mock the behavior under test so completely that the test proves nothing.",
      "Generated tests SHOULD prefer minimal mocking.",
      "Generated tests MUST be placed in appropriate test directories matching repository conventions.",
      "All proposed file paths MUST be test paths (tests/, test/, __tests__/, *.test.*, *.spec.*, etc).",
      "Do NOT propose modifications to files outside test infrastructure.",
      "PERMANENT_REGRESSION: for confirmed defects or high-value requirements. CANDIDATE: potentially useful but unproven. INVESTIGATIVE: temporary, for evidence gathering only.",
      `Maximum ${maxTests} test(s).`,
    ],
    outputSchema: TestGenerationDecisionSchema,
    maxTokens: 4096,
    promptVersion: PROMPT_VERSION,
  };
}
