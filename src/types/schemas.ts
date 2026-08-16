import { z } from "zod";
import {
  Confidence,
  EvidenceProvenance,
  EvidenceStatus,
  EvidenceType,
  ExecutionProfile,
  FindingCategory,
  FindingSeverity,
  QEMode,
  RequirementPriority,
  RequirementStatus,
  RiskLevel,
  ValidationActionType,
  Verdict,
} from "./domain.js";

export const RequirementSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .optional(),
  priority: RequirementPriority.optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const RequirementAssessmentSchema = z.object({
  requirementId: z.string().min(1),
  status: RequirementStatus,
  evidenceIds: z.array(z.string()),
  explanation: z.string(),
});
export type RequirementAssessment = z.infer<typeof RequirementAssessmentSchema>;

export const QERequestSchema = z.object({
  repositoryPath: z.string().min(1),
  requirements: z.array(RequirementSchema).optional(),
  baselineRef: z.string().optional(),
  targetRef: z.string().optional(),
  profile: ExecutionProfile,
  mode: QEMode,
});
export type QERequest = z.infer<typeof QERequestSchema>;

export const CapabilitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  provider: z.string().min(1),
  available: z.boolean(),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.unknown()).optional(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  type: EvidenceType,
  provenance: EvidenceProvenance,
  timestamp: z.string(),
  source: z.string(),
  status: EvidenceStatus,
  summary: z.string(),
  details: z.unknown().optional(),
  artifacts: z
    .array(
      z.object({
        path: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
  relatedRequirementIds: z.array(z.string()).optional(),
  relatedFindingIds: z.array(z.string()).optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  category: FindingCategory,
  severity: FindingSeverity,
  confidence: z.number().min(0).max(1),
  title: z.string().min(1),
  description: z.string(),
  evidenceIds: z.array(z.string()),
  affectedFiles: z.array(z.string()).optional(),
  reproduction: z
    .object({
      steps: z.array(z.string()),
      command: z.string().optional(),
    })
    .optional(),
  proposedRemediation: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const RiskFactorSchema = z.object({
  factor: z.string(),
  reason: z.string(),
  weight: z.enum(["low", "medium", "high", "critical"]),
});

export const RiskAssessmentSchema = z.object({
  level: RiskLevel,
  factors: z.array(RiskFactorSchema),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

export const ValidationActionSchema = z.object({
  id: z.string().min(1),
  type: ValidationActionType,
  purpose: z.string(),
  riskAddressed: z.array(z.string()).optional(),
  requirementIds: z.array(z.string()).optional(),
  command: z
    .object({
      executable: z.string(),
      args: z.array(z.string()),
      workingDirectory: z.string(),
      timeoutMs: z.number().positive(),
      purpose: z.string(),
    })
    .optional(),
  priority: z.number(),
  estimatedDurationMs: z.number().positive().optional(),
});
export type ValidationAction = z.infer<typeof ValidationActionSchema>;

export const ValidationPlanSchema = z.object({
  objectives: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
    }),
  ),
  plannedActions: z.array(ValidationActionSchema),
  identifiedRisks: z.array(z.string()),
  expectedCapabilities: z.array(z.string()),
});
export type ValidationPlan = z.infer<typeof ValidationPlanSchema>;

export const DetectedTechnologySchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  confidence: z.number().min(0).max(1),
  detectedFrom: z.string(),
});

export const RepositoryProfileSchema = z.object({
  root: z.string(),
  languages: z.array(DetectedTechnologySchema),
  frameworks: z.array(DetectedTechnologySchema),
  packageManagers: z.array(DetectedTechnologySchema),
  buildSystems: z.array(DetectedTechnologySchema),
  testFrameworks: z.array(DetectedTechnologySchema),
  ciSystems: z.array(DetectedTechnologySchema),
  documentation: z.array(
    z.object({
      path: z.string(),
      type: z.string(),
    }),
  ),
  commands: z.array(
    z.object({
      name: z.string(),
      command: z.string(),
      source: z.string(),
    }),
  ),
  capabilities: z.array(CapabilitySchema),
  confidence: z.number().min(0).max(1),
});
export type RepositoryProfile = z.infer<typeof RepositoryProfileSchema>;

export const ChangedFileSchema = z.object({
  path: z.string(),
  changeType: z.enum(["added", "modified", "deleted", "renamed"]),
  oldPath: z.string().optional(),
});

export const ChangeAnalysisSchema = z.object({
  summary: z.string(),
  changedFiles: z.array(ChangedFileSchema),
  affectedComponents: z.array(
    z.object({
      name: z.string(),
      impact: z.string(),
    }),
  ),
  behaviorChanges: z.array(
    z.object({
      description: z.string(),
      risk: RiskLevel,
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
export type ChangeAnalysis = z.infer<typeof ChangeAnalysisSchema>;

export const ExecutionBudgetSchema = z.object({
  maxDurationMs: z.number().positive(),
  maxModelCalls: z.number().positive().optional(),
  maxRetries: z.number().nonnegative().optional(),
  maxGeneratedTests: z.number().nonnegative().optional(),
});
export type ExecutionBudget = z.infer<typeof ExecutionBudgetSchema>;

export const ExecutionMetricsSchema = z.object({
  startTime: z.string(),
  endTime: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  modelCalls: z.number().nonnegative(),
  commandsExecuted: z.number().nonnegative(),
  testsExecuted: z.number().nonnegative(),
  testsGenerated: z.number().nonnegative(),
  retries: z.number().nonnegative(),
  stateTransitions: z.number().nonnegative(),
});
export type ExecutionMetrics = z.infer<typeof ExecutionMetricsSchema>;

export const QualityGapSchema = z.object({
  area: z.string(),
  description: z.string(),
  reason: z.string(),
  risk: RiskLevel,
});

export const QEResultSchema = z.object({
  executionId: z.string().min(1),
  repository: z.object({
    path: z.string(),
    name: z.string().optional(),
  }),
  baseline: z.string().optional(),
  target: z.string(),
  profile: ExecutionProfile,
  repositoryProfile: RepositoryProfileSchema,
  changeAnalysis: ChangeAnalysisSchema.optional(),
  riskAssessment: RiskAssessmentSchema,
  validationPlan: ValidationPlanSchema,
  evidence: z.array(EvidenceSchema),
  findings: z.array(FindingSchema),
  requirements: z.array(RequirementAssessmentSchema),
  remainingGaps: z.array(QualityGapSchema),
  verdict: Verdict,
  confidence: Confidence,
  summary: z.string(),
  recommendedNextActions: z.array(z.string()),
  metrics: ExecutionMetricsSchema,
});
export type QEResult = z.infer<typeof QEResultSchema>;

export const PartialQEResultSchema = z.object({
  executionId: z.string().min(1),
  repository: z.object({
    path: z.string(),
    name: z.string().optional(),
  }),
  baseline: z.string().optional(),
  target: z.string(),
  profile: ExecutionProfile,
  repositoryProfile: RepositoryProfileSchema.optional(),
  changeAnalysis: ChangeAnalysisSchema.optional(),
  riskAssessment: RiskAssessmentSchema.optional(),
  validationPlan: ValidationPlanSchema.optional(),
  evidence: z.array(EvidenceSchema),
  findings: z.array(FindingSchema),
  requirements: z.array(RequirementAssessmentSchema),
  remainingGaps: z.array(QualityGapSchema),
  verdict: Verdict.optional(),
  confidence: Confidence.optional(),
  summary: z.string().optional(),
  recommendedNextActions: z.array(z.string()).optional(),
  metrics: ExecutionMetricsSchema,
});
export type PartialQEResult = z.infer<typeof PartialQEResultSchema>;
