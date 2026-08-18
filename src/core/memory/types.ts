import { z } from "zod";

export const MemoryUpdateTarget = z.enum([
  "PROJECT",
  "TESTING",
  "RISKS",
  "KNOWLEDGE",
  "HISTORY",
]);
export type MemoryUpdateTarget = z.infer<typeof MemoryUpdateTarget>;

export const MemoryUpdateOperation = z.enum([
  "ADD",
  "UPDATE",
  "REMOVE",
  "NO_CHANGE",
]);
export type MemoryUpdateOperation = z.infer<typeof MemoryUpdateOperation>;

export const MemoryUpdateProposalSchema = z.object({
  target: MemoryUpdateTarget,
  operation: MemoryUpdateOperation,
  topic: z.string().optional(),
  rationale: z.string().min(1),
  evidenceIds: z.array(z.string()).optional(),
  content: z.string(),
  confidence: z.number().min(0).max(1),
});
export type MemoryUpdateProposal = z.infer<typeof MemoryUpdateProposalSchema>;

export const MemoryUpdateResultSchema = z.object({
  target: MemoryUpdateTarget,
  operation: MemoryUpdateOperation,
  filePath: z.string(),
  applied: z.boolean(),
  reason: z.string().optional(),
});
export type MemoryUpdateResult = z.infer<typeof MemoryUpdateResultSchema>;

export const MemoryWarningSchema = z.object({
  type: z.enum(["STALE", "CONFLICT", "MALFORMED", "READ_FAILURE"]),
  source: z.string(),
  message: z.string(),
  proposedCorrection: z.string().optional(),
});
export type MemoryWarning = z.infer<typeof MemoryWarningSchema>;

export interface ProjectKnowledge {
  content: string;
  source: string;
  lastModified?: string;
}

export interface TestingKnowledge {
  content: string;
  source: string;
  lastModified?: string;
}

export interface RiskEntry {
  topic: string;
  content: string;
}

export interface RiskKnowledge {
  entries: RiskEntry[];
  source: string;
  lastModified?: string;
}

export interface KnowledgeDocument {
  name: string;
  content: string;
  source: string;
  lastModified?: string;
}

export interface RunSummary {
  name: string;
  content: string;
  source: string;
}

export interface ProjectMemory {
  project?: ProjectKnowledge;
  testing?: TestingKnowledge;
  risks?: RiskKnowledge;
  knowledgeFiles: KnowledgeDocument[];
  historySummaries: RunSummary[];
}

export interface MemoryUpdateContext {
  repositoryRoot: string;
  executionId: string;
  evidence: { id: string; type: string; status: string; summary: string }[];
  findings: { id: string; category: string; title: string }[];
  verdict: string;
  discoveredCommands: { name: string; command: string; category: string }[];
  riskSummary?: string;
  changeAnalysisSummary?: string;
  existingMemory: ProjectMemory;
  knownSecrets?: string[];
}

export type MemoryClaimCategory =
  | "CONFIRMED_FACT"
  | "TESTING_PROCEDURE"
  | "PROJECT_METADATA"
  | "RISK_OR_HYPOTHESIS"
  | "HISTORY_SUMMARY";

export interface MemoryMetrics {
  memoryFilesRead: number;
  memoryEntriesUsed: number;
  memoryUpdatesProposed: number;
  memoryUpdatesApplied: number;
  memoryUpdatesRejected: number;
  memoryConflicts: number;
}

export const MemoryMetricsSchema = z.object({
  memoryFilesRead: z.number().nonnegative(),
  memoryEntriesUsed: z.number().nonnegative(),
  memoryUpdatesProposed: z.number().nonnegative(),
  memoryUpdatesApplied: z.number().nonnegative(),
  memoryUpdatesRejected: z.number().nonnegative(),
  memoryConflicts: z.number().nonnegative(),
});
