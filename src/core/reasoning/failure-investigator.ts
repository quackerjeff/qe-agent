import type { ModelGateway, ModelResult } from "../../models/gateway/types.js";
import type { Finding, Evidence } from "../../types/index.js";
import {
  buildFailureAnalysisTask,
  type FailureAnalysisOutput,
} from "../../prompts/failure-analysis/v1.js";

export interface FailureInvestigationResult {
  finding: Finding;
  likelyCause: FailureAnalysisOutput["likelyCause"];
  suggestRetry: boolean;
  suggestBaselineComparison: boolean;
  modelResult: ModelResult<FailureAnalysisOutput>;
}

export async function investigateFailure(
  gateway: ModelGateway,
  evidence: Evidence,
  stdout: string,
  stderr: string,
  exitCode: number | null,
  changeData?: Record<string, unknown>,
  requirements?: { id: string; description: string }[],
): Promise<FailureInvestigationResult> {
  const task = buildFailureAnalysisTask(
    {
      id: evidence.id,
      summary: evidence.summary,
      stdout: stdout.slice(0, 4096),
      stderr: stderr.slice(0, 4096),
      exitCode,
      command: evidence.source,
    },
    changeData,
    requirements,
  );

  const modelResult = await gateway.reason(task);
  const output = modelResult.data;

  const categoryMap: Record<string, Finding["category"]> = {
    PRODUCT_DEFECT: "DEFECT",
    REGRESSION: "REGRESSION",
    TEST_DEFECT: "TEST_DEFECT",
    ENVIRONMENT_ISSUE: "ENVIRONMENT_ISSUE",
    FLAKY: "FLAKY_TEST",
    UNKNOWN: "QUALITY_RISK",
  };

  const finding: Finding = {
    id: `finding-${evidence.id}`,
    category: categoryMap[output.likelyCause] ?? "QUALITY_RISK",
    severity:
      output.confidence > 0.8
        ? "HIGH"
        : output.confidence > 0.5
          ? "MEDIUM"
          : "LOW",
    confidence: output.confidence,
    title: `${output.likelyCause}: ${evidence.summary}`,
    description: output.explanation,
    evidenceIds: [evidence.id],
    affectedFiles: output.affectedFiles,
  };

  return {
    finding,
    likelyCause: output.likelyCause,
    suggestRetry: output.suggestRetry,
    suggestBaselineComparison: output.suggestBaselineComparison,
    modelResult,
  };
}

export interface BaselineComparisonResult {
  classification:
    | "INTRODUCED"
    | "PRE_EXISTING"
    | "ENVIRONMENT_SPECIFIC"
    | "FLAKY"
    | "UNKNOWN";
  baselinePassed: boolean;
  targetPassed: boolean;
}

export function classifyWithBaseline(
  baselineStatus: "PASS" | "FAIL" | "INCONCLUSIVE",
  targetStatus: "PASS" | "FAIL" | "INCONCLUSIVE",
): BaselineComparisonResult {
  if (targetStatus === "FAIL" && baselineStatus === "PASS") {
    return {
      classification: "INTRODUCED",
      baselinePassed: true,
      targetPassed: false,
    };
  }
  if (targetStatus === "FAIL" && baselineStatus === "FAIL") {
    return {
      classification: "PRE_EXISTING",
      baselinePassed: false,
      targetPassed: false,
    };
  }
  if (targetStatus === "FAIL" && baselineStatus === "INCONCLUSIVE") {
    return {
      classification: "UNKNOWN",
      baselinePassed: false,
      targetPassed: false,
    };
  }
  return {
    classification: "UNKNOWN",
    baselinePassed: baselineStatus === "PASS",
    targetPassed: targetStatus === "PASS",
  };
}
