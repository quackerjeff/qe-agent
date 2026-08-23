import { z } from "zod";
import {
  CommandCategory,
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
  TechnologyCategory,
  ValidationActionType,
  Verdict,
} from "./domain.js";
import {
  MemoryUpdateResultSchema,
  MemoryWarningSchema,
  MemoryMetricsSchema,
} from "../core/memory/types.js";

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
  generatedTestProvenance: z
    .lazy(() => GeneratedTestProvenanceSchema)
    .optional(),
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

export const DetectionEvidenceSchema = z.object({
  source: z.string(),
  reason: z.string(),
});
export type DetectionEvidence = z.infer<typeof DetectionEvidenceSchema>;

export const DetectedTechnologySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: TechnologyCategory,
  version: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(DetectionEvidenceSchema),
});
export type DetectedTechnology = z.infer<typeof DetectedTechnologySchema>;

export const ExecutionSupport = z.enum(["STRUCTURED", "DISCOVERED_ONLY"]);
export type ExecutionSupport = z.infer<typeof ExecutionSupport>;

export const DiscoveredCommandSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: CommandCategory,
  command: z.string(),
  executable: z.string().optional(),
  args: z.array(z.string()).optional(),
  source: z.string(),
  confidence: z.number().min(0).max(1),
  executionSupport: ExecutionSupport.default("DISCOVERED_ONLY"),
});
export type DiscoveredCommand = z.infer<typeof DiscoveredCommandSchema>;

export const ApplicationProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  type: z.string().optional(),
});
export type ApplicationProfile = z.infer<typeof ApplicationProfileSchema>;

export const GitInfoSchema = z.object({
  detected: z.boolean(),
  root: z.string().optional(),
  branch: z.string().optional(),
});
export type GitInfo = z.infer<typeof GitInfoSchema>;

export const RepositoryProfileSchema = z.object({
  root: z.string(),
  git: GitInfoSchema,
  languages: z.array(DetectedTechnologySchema),
  frameworks: z.array(DetectedTechnologySchema),
  packageManagers: z.array(DetectedTechnologySchema),
  buildSystems: z.array(DetectedTechnologySchema),
  testFrameworks: z.array(DetectedTechnologySchema),
  ciSystems: z.array(DetectedTechnologySchema),
  applications: z.array(ApplicationProfileSchema),
  documentation: z.array(
    z.object({
      path: z.string(),
      type: z.string(),
    }),
  ),
  commands: z.array(DiscoveredCommandSchema),
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
  maxBrowserScenarios: z.number().nonnegative().optional(),
  maxBrowserActions: z.number().nonnegative().optional(),
  maxBrowserDurationMs: z.number().nonnegative().optional(),
  maxScreenshots: z.number().nonnegative().optional(),
});
export type ExecutionBudget = z.infer<typeof ExecutionBudgetSchema>;

export const LifecycleTransitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  timestamp: z.string(),
  reason: z.string().optional(),
});
export type LifecycleTransition = z.infer<typeof LifecycleTransitionSchema>;

export const ModelCallMetadataSchema = z.object({
  role: z.string(),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nonnegative(),
  success: z.boolean(),
  retryCount: z.number().nonnegative(),
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  cachedTokens: z.number().nonnegative().optional(),
  totalTokens: z.number().nonnegative().optional(),
});
export type ModelCallMetadata = z.infer<typeof ModelCallMetadataSchema>;

export const AILimitStatus = z.enum([
  "OK",
  "REDUCED",
  "DEGRADED",
  "BLOCKED",
  "UNKNOWN",
]);
export type AILimitStatus = z.infer<typeof AILimitStatus>;

export const ThroughputLimitClassification = z.enum([
  "CONTEXT_WINDOW_EXCEEDED",
  "THROUGHPUT_REQUEST_TOO_LARGE",
  "THROUGHPUT_TEMPORARILY_EXHAUSTED",
  "RATE_LIMIT_UNKNOWN",
]);
export type ThroughputLimitClassification = z.infer<
  typeof ThroughputLimitClassification
>;

export const ThroughputActionSchema = z.object({
  action: z.enum([
    "RIGHT_SIZED_OUTPUT",
    "REDUCED_CONTEXT",
    "DEFERRED",
    "BLOCKED",
  ]),
  reason: z.string(),
  originalDemand: z.number().optional(),
  adjustedDemand: z.number().optional(),
  waitMs: z.number().optional(),
});
export type ThroughputAction = z.infer<typeof ThroughputActionSchema>;

export const AIContextBreakdownSchema = z.object({
  category: z.string(),
  estimatedTokens: z.number().nonnegative(),
});
export type AIContextBreakdown = z.infer<typeof AIContextBreakdownSchema>;

export const AIUsageTelemetrySchema = z.object({
  modelCalls: z.number().nonnegative(),
  successfulModelCalls: z.number().nonnegative(),
  failedModelCalls: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cachedTokens: z.number().nonnegative(),
  maxResponseTokens: z.number().nonnegative().optional(),
  estimatedTpmDemand: z.number().nonnegative().optional(),
  modelLimit: z.number().nonnegative().optional(),
  throughputLimit: z.number().nonnegative().optional(),
  throughputActions: z.array(ThroughputActionSchema).optional(),
  limitClassification: ThroughputLimitClassification.optional(),
  estimatedCost: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  contextBreakdown: z.array(AIContextBreakdownSchema).optional(),
  limitStatus: AILimitStatus,
});
export type AIUsageTelemetry = z.infer<typeof AIUsageTelemetrySchema>;

export const BaselineComparisonClassification = z.enum([
  "INTRODUCED",
  "PRE_EXISTING",
  "ENVIRONMENT_SPECIFIC",
  "FLAKY",
  "UNKNOWN",
]);

export const BaselineComparisonSchema = z.object({
  classification: BaselineComparisonClassification,
  targetEvidenceId: z.string().min(1),
  baselineEvidenceId: z.string().optional(),
  validationActionId: z.string().optional(),
  explanation: z.string().optional(),
});
export type BaselineComparison = z.infer<typeof BaselineComparisonSchema>;

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
  lifecycleHistory: z.array(LifecycleTransitionSchema).optional(),
  modelCallDetails: z.array(ModelCallMetadataSchema).optional(),
});
export type ExecutionMetrics = z.infer<typeof ExecutionMetricsSchema>;

export const TestClassification = z.enum([
  "PERMANENT_REGRESSION",
  "CANDIDATE",
  "INVESTIGATIVE",
]);
export type TestClassification = z.infer<typeof TestClassification>;

export const ExecutionTargetingMode = z.enum([
  "TARGETED",
  "SUITE_INCLUDED",
  "UNVERIFIED",
]);
export type ExecutionTargetingMode = z.infer<typeof ExecutionTargetingMode>;

export const GeneratedTestFailureClassification = z.enum([
  "TEST_DEFECT",
  "PRODUCT_DEFECT",
  "REGRESSION",
  "ENVIRONMENT_ISSUE",
  "UNKNOWN",
]);
export type GeneratedTestFailureClassification = z.infer<
  typeof GeneratedTestFailureClassification
>;

export const GeneratedTestProvenanceSchema = z.object({
  generatedTestId: z.string().min(1),
  generatedFilePath: z.string().min(1),
  failureClassification: GeneratedTestFailureClassification.optional(),
  assertionsExecuted: z.boolean().optional(),
});
export type GeneratedTestProvenance = z.infer<
  typeof GeneratedTestProvenanceSchema
>;

export const WriteOperation = z.enum(["CREATE", "MODIFY"]);
export type WriteOperation = z.infer<typeof WriteOperation>;

export const WriteOutcome = z.enum([
  "APPLIED",
  "DENIED_PRODUCTION_PATH",
  "DENIED_TRAVERSAL",
  "DENIED_SYMLINK",
  "DENIED_DIRTY_FILE",
  "DENIED_OUTSIDE_REPO",
  "DENIED_INVALID_CONTENT",
  "DENIED_SIZE_LIMIT",
  "DENIED_FILE_COUNT",
  "DENIED_UNCERTAIN_CLASSIFICATION",
]);
export type WriteOutcome = z.infer<typeof WriteOutcome>;

export const TestGenerationPlanSchema = z.object({
  objective: z.string().min(1),
  targetBehavior: z.string().min(1),
  requirementIds: z.array(z.string()),
  riskIds: z.array(z.string()).optional(),
  targetTestFramework: z.string().min(1),
  targetLocation: z.string().min(1),
  classification: TestClassification,
  expectedEvidence: z.string().min(1),
});
export type TestGenerationPlan = z.infer<typeof TestGenerationPlanSchema>;

export const GeneratedTestProposalSchema = z.object({
  filePath: z.string().min(1),
  operation: WriteOperation,
  classification: TestClassification,
  rationale: z.string().min(1),
  content: z.string().min(1),
});
export type GeneratedTestProposal = z.infer<typeof GeneratedTestProposalSchema>;

export const GeneratedTestChangeSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  operation: WriteOperation,
  classification: TestClassification,
  rationale: z.string().min(1),
  writeOutcome: WriteOutcome,
  beforeHash: z.string().optional(),
  afterHash: z.string().optional(),
  executionEvidenceId: z.string().optional(),
  executionTargetingMode: ExecutionTargetingMode.optional(),
  framework: z.string().optional(),
  failureClassification: GeneratedTestFailureClassification.optional(),
  planObjective: z.string().optional(),
  retained: z.boolean(),
  requirementIds: z.array(z.string()),
});
export type GeneratedTestChange = z.infer<typeof GeneratedTestChangeSchema>;

export const TestGenerationMetricsSchema = z.object({
  generationAttempts: z.number().nonnegative(),
  testsGenerated: z.number().nonnegative(),
  testsExecuted: z.number().nonnegative(),
  testsPassing: z.number().nonnegative(),
  testsFailing: z.number().nonnegative(),
  testsRejected: z.number().nonnegative(),
  permanentTestsRetained: z.number().nonnegative(),
  candidateTestsRetained: z.number().nonnegative(),
  investigativeTestsRemoved: z.number().nonnegative(),
  testDefectTestsRemoved: z.number().nonnegative(),
  modelCalls: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type TestGenerationMetrics = z.infer<typeof TestGenerationMetricsSchema>;

export const AnalysisResultSchema = z.object({
  repositoryProfile: RepositoryProfileSchema,
  aiUsage: AIUsageTelemetrySchema,
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

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
  baselineComparisons: z.array(BaselineComparisonSchema).optional(),
  generatedTestChanges: z.array(GeneratedTestChangeSchema).optional(),
  testGenerationMetrics: TestGenerationMetricsSchema.optional(),
  memoryUpdates: z.array(MemoryUpdateResultSchema).optional(),
  memoryWarnings: z.array(MemoryWarningSchema).optional(),
  memoryMetrics: MemoryMetricsSchema.optional(),
  requirements: z.array(RequirementAssessmentSchema),
  remainingGaps: z.array(QualityGapSchema),
  verdict: Verdict,
  confidence: Confidence,
  summary: z.string(),
  recommendedNextActions: z.array(z.string()),
  metrics: ExecutionMetricsSchema,
  aiUsage: AIUsageTelemetrySchema.optional(),
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
  baselineComparisons: z.array(BaselineComparisonSchema).optional(),
  generatedTestChanges: z.array(GeneratedTestChangeSchema).optional(),
  testGenerationMetrics: TestGenerationMetricsSchema.optional(),
  memoryUpdates: z.array(MemoryUpdateResultSchema).optional(),
  memoryWarnings: z.array(MemoryWarningSchema).optional(),
  memoryMetrics: MemoryMetricsSchema.optional(),
  requirements: z.array(RequirementAssessmentSchema),
  remainingGaps: z.array(QualityGapSchema),
  verdict: Verdict.optional(),
  confidence: Confidence.optional(),
  summary: z.string().optional(),
  recommendedNextActions: z.array(z.string()).optional(),
  metrics: ExecutionMetricsSchema,
  aiUsage: AIUsageTelemetrySchema.optional(),
});
export type PartialQEResult = z.infer<typeof PartialQEResultSchema>;
