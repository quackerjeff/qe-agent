import { z } from "zod";
import type { ReasoningTask } from "../../models/gateway/types.js";
import type { MemoryUpdateContext } from "../../core/memory/types.js";

export const MemoryDistillationOutputSchema = z.object({
  proposals: z.array(
    z.object({
      target: z.enum(["PROJECT", "TESTING", "RISKS", "KNOWLEDGE", "HISTORY"]),
      operation: z.enum(["ADD", "UPDATE", "REMOVE", "NO_CHANGE"]),
      topic: z.string().optional(),
      rationale: z.string().min(1),
      evidenceIds: z.array(z.string()).optional(),
      content: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  staleEntries: z.array(
    z.object({
      source: z.string(),
      reason: z.string(),
      proposedCorrection: z.string().optional(),
    }),
  ),
});

export type MemoryDistillationOutput = z.infer<
  typeof MemoryDistillationOutputSchema
>;

export const PROMPT_VERSION = "memory-distillation-v1";

export function buildMemoryDistillationTask(
  ctx: MemoryUpdateContext,
): ReasoningTask<MemoryDistillationOutput> {
  const existingMemorySummary: Record<string, unknown> = {};
  if (ctx.existingMemory.project) {
    existingMemorySummary.project = ctx.existingMemory.project.content.slice(
      0,
      2048,
    );
  }
  if (ctx.existingMemory.testing) {
    existingMemorySummary.testing = ctx.existingMemory.testing.content.slice(
      0,
      2048,
    );
  }
  if (ctx.existingMemory.risks) {
    existingMemorySummary.risks = ctx.existingMemory.risks.entries.map((e) => ({
      topic: e.topic,
      summary: e.content.slice(0, 512),
    }));
  }
  if (ctx.existingMemory.knowledgeFiles.length > 0) {
    existingMemorySummary.knowledgeFiles =
      ctx.existingMemory.knowledgeFiles.map((k) => ({
        name: k.name,
        summary: k.content.slice(0, 512),
      }));
  }

  return {
    role: "memory_distiller",
    objective:
      "Determine what durable knowledge this QE run produced that would materially improve future QE runs. Propose only high-confidence, evidence-backed updates. Do NOT persist raw transcripts, full logs, temporary state, or speculative guesses. Do NOT persist secrets, credentials, tokens, or passwords.",
    context: {
      executionId: ctx.executionId,
      verdict: ctx.verdict,
      evidence: ctx.evidence.slice(0, 20),
      findings: ctx.findings.slice(0, 10),
      discoveredCommands: ctx.discoveredCommands.slice(0, 10),
      riskSummary: ctx.riskSummary,
      changeAnalysisSummary: ctx.changeAnalysisSummary,
      existingMemory: existingMemorySummary,
    },
    outputSchema: MemoryDistillationOutputSchema,
    constraints: [
      "Only propose durable knowledge that would improve future QE runs.",
      "Do NOT persist raw stack traces, full stdout/stderr, or temporary failure data.",
      "Do NOT persist secrets, tokens, passwords, or credential values.",
      "Do NOT persist raw model responses or conversation transcripts.",
      "Evidence-backed facts require corresponding evidence IDs.",
      "Speculative conclusions must be labeled as hypotheses.",
      "Do NOT duplicate information that already exists in memory.",
      "Keep content concise — summaries, not exhaustive descriptions.",
      "If nothing durable was learned, return an empty proposals array.",
      "For stale entries, identify existing memory that conflicts with current evidence.",
      "Content must be valid Markdown suitable for human reading.",
      "Do NOT include file paths outside the .qe/ directory.",
      "Maximum 6 proposals per run.",
    ],
    maxTokens: 2048,
    promptVersion: PROMPT_VERSION,
  };
}
