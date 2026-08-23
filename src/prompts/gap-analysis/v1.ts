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

export const GAP_ANALYSIS_BASE_TOKENS = 512;
export const GAP_ANALYSIS_PER_REQUIREMENT_TOKENS = 110;
export const GAP_ANALYSIS_MAX_TOKENS = 16384;

export function calculateGapAnalysisMaxTokens(
  requirementCount: number,
): number {
  const scaled =
    GAP_ANALYSIS_BASE_TOKENS +
    requirementCount * GAP_ANALYSIS_PER_REQUIREMENT_TOKENS;
  return Math.min(scaled, GAP_ANALYSIS_MAX_TOKENS);
}

export function buildGapAnalysisTask(
  requirements: {
    id: string;
    description: string;
    acceptanceCriteria?: { id: string; description: string }[];
  }[],
  evidence: {
    id: string;
    type: string;
    status: string;
    summary: string;
    details?: Record<string, unknown>;
    investigatedClassification?: string;
  }[],
  findings: { id: string; category: string; title: string }[],
  riskAssessment: { level: string; factors: { factor: string }[] },
  changeData?: Record<string, unknown>,
): ReasoningTask<GapAnalysisOutput> {
  const context: Record<string, unknown> = {
    requirements,
    collectedEvidence: evidence,
    findings,
    riskAssessment,
    changeData: changeData ?? {},
  };
  return {
    role: "gap_analyst",
    objective:
      "Analyze what important behavior remains unverified. Map evidence to supplied requirements. Each requirement should receive an assessment. A criterion SHALL NOT become VERIFIED solely because source code appears to implement it — evidence must support verification.",
    context,
    outputSchema: GapAnalysisOutputSchema,
    constraints: [
      "A requirement is NOT VERIFIED solely because code implements it.",
      "Evidence must support verification status.",
      "Report all meaningful unverified behavior as gaps.",
      "Do not claim actions occurred unless evidence exists.",
      "Distinguish three evidence provenance tiers: executed evidence (direct command/test execution results), observed evidence (deterministic machine observations such as DISCOVERY_RESULT or LIFECYCLE_OBSERVATION), and inferred conclusions (model-derived reasoning). Observed evidence is authoritative fact, not inference — do not discount it.",
      "Do not generate tests — report TEST_GAP instead.",
      "Keep explanations to one concise sentence citing specific evidence IDs.",
      "If evidence has investigatedClassification: FLAKY_TEST, the failure was classified as likely flaky by failure investigation. Do not treat it as demonstrated product failure when assessing requirements.",
      "Do not classify a test failure by test type (integration, e2e, API, browser, component, contract) unless the evidence explicitly states the test category.",
      "A single evidence record may support multiple requirements. Citing evidence for one requirement does not consume or reserve it — the same evidence ID may appear in multiple assessments.",
      "DISCOVERY_RESULT evidence with status OBSERVED represents a deterministic repository observation (e.g. detected frameworks, commands, capabilities). It is citable as authoritative evidence when relevant to a requirement.",
      "LIFECYCLE_OBSERVATION evidence with status OBSERVED represents a deterministic observation of current-run or system state (e.g. invocation mode, budget configuration). It is citable as authoritative evidence when relevant to a requirement.",
      "TEST_RESULT evidence represents actual test execution outcomes. COMMAND_RESULT evidence represents executed command outcomes. Do not treat lifecycle or budget metadata as proof that tests were executed.",
      "Use structured evidence.details fields alongside the summary when determining whether evidence supports a requirement. Details contain machine-readable facts (e.g. testFrameworks, lintCommands, exitCode, invocationMode, budgetActive) that may be more precise than the summary text.",
      "When a requirement includes candidateEvidenceIds, consider each listed evidence ID as potentially relevant. Evaluate whether it supports the requirement. Candidate evidence is a relevance hint — it does not automatically confer any status. The same evidence may appear as a candidate for multiple requirements.",
    ],
    maxTokens: calculateGapAnalysisMaxTokens(requirements.length),
    promptVersion: PROMPT_VERSION,
  };
}
