import type {
  Evidence,
  Finding,
  GeneratedTestFailureClassification,
} from "../../types/index.js";
import { createExecutionId } from "../../logging/index.js";

export interface GeneratedTestFailureContext {
  generatedTestId: string;
  generatedFilePath: string;
  testContent: string;
  executionEvidence: Evidence;
  requirementIds: string[];
  classification: string;
  baselineComparison?: {
    classification: string;
    baselineEvidenceId?: string;
  };
}

export interface GeneratedTestInvestigationResult {
  failureClassification: GeneratedTestFailureClassification;
  explanation: string;
  finding?: Finding;
}

export function investigateGeneratedTestFailure(
  context: GeneratedTestFailureContext,
): GeneratedTestInvestigationResult {
  const hasBaselineComparison = !!context.baselineComparison;
  const isIntroduced =
    context.baselineComparison?.classification === "INTRODUCED";

  if (isIntroduced && hasBaselineComparison) {
    const finding: Finding = {
      id: `finding-gentest-${createExecutionId()}`,
      category: "REGRESSION",
      severity: "HIGH",
      confidence: 0.8,
      title: `Generated regression test detected introduced failure: ${context.generatedFilePath}`,
      description: `Generated test targeting ${context.generatedFilePath} passes on the baseline but fails on the target. Baseline comparison classified this as INTRODUCED, indicating a product regression.`,
      evidenceIds: [
        context.executionEvidence.id,
        ...(context.baselineComparison?.baselineEvidenceId
          ? [context.baselineComparison.baselineEvidenceId]
          : []),
      ],
      affectedFiles: [context.generatedFilePath],
    };

    return {
      failureClassification: "REGRESSION",
      explanation:
        "Baseline comparison confirms this failure was introduced in the target change",
      finding,
    };
  }

  if (looksLikeTestDefect(context.testContent, context.executionEvidence)) {
    return {
      failureClassification: "TEST_DEFECT",
      explanation:
        "Failure pattern suggests a defect in the generated test rather than the product",
    };
  }

  if (looksLikeEnvironmentIssue(context.executionEvidence)) {
    return {
      failureClassification: "ENVIRONMENT_ISSUE",
      explanation:
        "Failure pattern suggests an environment or setup issue rather than a product defect",
    };
  }

  return {
    failureClassification: "UNKNOWN",
    explanation:
      "Insufficient evidence to determine whether this is a product defect or a test defect. Generated test failures default to UNKNOWN without corroborating evidence.",
  };
}

function looksLikeTestDefect(testContent: string, evidence: Evidence): boolean {
  const output = String(evidence.summary ?? "").toLowerCase();
  const details = String(
    typeof evidence.details === "string" ? evidence.details : "",
  ).toLowerCase();
  const combined = output + " " + details;

  if (
    combined.includes("syntaxerror") ||
    combined.includes("referenceerror") ||
    combined.includes("importerror") ||
    combined.includes("modulenotfounderror") ||
    combined.includes("cannot find module") ||
    combined.includes("is not defined") ||
    combined.includes("is not a function")
  ) {
    return true;
  }

  if (
    combined.includes("typeerror") &&
    !combined.includes("expected") &&
    !combined.includes("assertion")
  ) {
    return true;
  }

  return false;
}

function looksLikeEnvironmentIssue(evidence: Evidence): boolean {
  const output = String(evidence.summary ?? "").toLowerCase();
  const details = String(
    typeof evidence.details === "string" ? evidence.details : "",
  ).toLowerCase();
  const combined = output + " " + details;

  return (
    combined.includes("enoent") ||
    combined.includes("eacces") ||
    combined.includes("permission denied") ||
    combined.includes("command not found") ||
    combined.includes("connection refused") ||
    combined.includes("timeout")
  );
}
