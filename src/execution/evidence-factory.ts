import type { Evidence, EvidenceStatus, EvidenceType } from "../types/index.js";
import type { ExecutionResult } from "./types.js";

export function createExecutionEvidence(
  result: ExecutionResult,
  commandCategory?: string,
): Evidence {
  const type = inferEvidenceType(commandCategory);
  const status = inferEvidenceStatus(result, commandCategory);

  return {
    id: `ev-${result.executionId}`,
    type,
    provenance: "executed",
    timestamp: result.endTime,
    source: `${result.executor}:${result.command.executable}`,
    status,
    summary: buildSummary(result, status),
    details: {
      executionId: result.executionId,
      executable: result.command.executable,
      args: result.command.args,
      workingDirectory: result.command.workingDirectory,
      executor: result.executor,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      terminationReason: result.terminationReason,
      truncated: result.truncated,
      secretsRedacted: result.secretsRedacted,
      networkPolicy: result.networkPolicy,
      networkPolicyEnforced: result.networkPolicyEnforced,
      purpose: result.purpose,
    },
  };
}

function inferEvidenceType(commandCategory?: string): EvidenceType {
  switch (commandCategory) {
    case "TEST":
      return "TEST_RESULT";
    case "BUILD":
      return "BUILD_RESULT";
    default:
      return "COMMAND_RESULT";
  }
}

function inferEvidenceStatus(
  result: ExecutionResult,
  commandCategory?: string,
): EvidenceStatus {
  if (result.terminationReason === "TIMED_OUT") return "INCONCLUSIVE";
  if (result.terminationReason === "SPAWN_FAILED") return "INCONCLUSIVE";
  if (result.terminationReason === "POLICY_DENIED") return "INCONCLUSIVE";

  if (
    commandCategory === "TEST" ||
    commandCategory === "BUILD" ||
    commandCategory === "LINT" ||
    commandCategory === "TYPECHECK"
  ) {
    return result.exitCode === 0 ? "PASS" : "FAIL";
  }

  return "OBSERVED";
}

function buildSummary(result: ExecutionResult, status: EvidenceStatus): string {
  const cmd = [result.command.executable, ...result.command.args].join(" ");
  switch (result.terminationReason) {
    case "TIMED_OUT":
      return `Command '${cmd}' timed out after ${result.durationMs}ms`;
    case "SPAWN_FAILED":
      return `Command '${cmd}' failed to start`;
    case "POLICY_DENIED":
      return `Command '${cmd}' denied by execution policy`;
    default:
      return `Command '${cmd}' ${status === "PASS" ? "succeeded" : status === "FAIL" ? "failed" : "completed"} with exit code ${result.exitCode}`;
  }
}
