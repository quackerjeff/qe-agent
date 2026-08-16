import { z } from "zod";

export const ExecutionProfile = z.enum(["quick", "standard", "deep"]);
export type ExecutionProfile = z.infer<typeof ExecutionProfile>;

export const QEMode = z.enum(["repository", "change"]);
export type QEMode = z.infer<typeof QEMode>;

export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const Verdict = z.enum([
  "PASS",
  "PASS_WITH_CONCERNS",
  "NEEDS_REVIEW",
  "FAIL",
  "BLOCKED",
]);
export type Verdict = z.infer<typeof Verdict>;

export const Confidence = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type Confidence = z.infer<typeof Confidence>;

export const FindingCategory = z.enum([
  "DEFECT",
  "REGRESSION",
  "TEST_GAP",
  "QUALITY_RISK",
  "SECURITY_CONCERN",
  "PERFORMANCE_CONCERN",
  "ACCESSIBILITY_CONCERN",
  "FLAKY_TEST",
  "TEST_DEFECT",
  "ENVIRONMENT_ISSUE",
  "MAINTAINABILITY_CONCERN",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FindingSeverity = z.enum([
  "BLOCKER",
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFORMATIONAL",
]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const EvidenceStatus = z.enum([
  "PASS",
  "FAIL",
  "OBSERVED",
  "INCONCLUSIVE",
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;

export const EvidenceType = z.enum([
  "TEST_RESULT",
  "COMMAND_RESULT",
  "BUILD_RESULT",
  "STATIC_ANALYSIS_RESULT",
  "BROWSER_RESULT",
  "SCREENSHOT",
  "TRACE",
  "SOURCE_INSPECTION",
  "DIFF_ANALYSIS",
  "REQUIREMENT_MAPPING",
  "MANUAL_INFERENCE",
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const EvidenceProvenance = z.enum([
  "observed",
  "executed",
  "inferred",
  "not_verified",
]);
export type EvidenceProvenance = z.infer<typeof EvidenceProvenance>;

export const RequirementStatus = z.enum([
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "NOT_VERIFIED",
  "BLOCKED",
  "NOT_APPLICABLE",
]);
export type RequirementStatus = z.infer<typeof RequirementStatus>;

export const RequirementPriority = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type RequirementPriority = z.infer<typeof RequirementPriority>;

export const ValidationActionType = z.enum([
  "BUILD",
  "TEST",
  "LINT",
  "TYPECHECK",
  "STATIC_ANALYSIS",
  "BROWSER",
  "API",
  "SOURCE_INSPECTION",
  "GENERATE_TEST",
  "CUSTOM",
]);
export type ValidationActionType = z.infer<typeof ValidationActionType>;
