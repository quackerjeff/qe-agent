import { resolve, isAbsolute } from "node:path";
import { writeFile, stat } from "node:fs/promises";
import type { QEResult } from "../types/index.js";
import { renderWorkflowSummary } from "./summary.js";

export interface StepSummaryResult {
  written: boolean;
  path?: string;
  error?: string;
}

export async function writeStepSummary(
  result: QEResult,
  summaryPath: string | undefined,
  redactSecrets: (text: string) => string,
): Promise<StepSummaryResult> {
  if (!summaryPath || summaryPath.trim().length === 0) {
    return { written: false, error: "GITHUB_STEP_SUMMARY not set" };
  }

  if (!isAbsolute(summaryPath)) {
    return {
      written: false,
      error: "GITHUB_STEP_SUMMARY must be an absolute path",
    };
  }

  if (summaryPath.includes("\0")) {
    return { written: false, error: "GITHUB_STEP_SUMMARY contains null bytes" };
  }

  const resolved = resolve(summaryPath);

  try {
    const parentDir = resolve(resolved, "..");
    const parentStat = await stat(parentDir);
    if (!parentStat.isDirectory()) {
      return {
        written: false,
        error: "GITHUB_STEP_SUMMARY parent is not a directory",
      };
    }
  } catch {
    return {
      written: false,
      error: "GITHUB_STEP_SUMMARY parent directory does not exist",
    };
  }

  const summary = renderWorkflowSummary(result, redactSecrets);

  try {
    await writeFile(resolved, summary, "utf-8");
    return { written: true, path: resolved };
  } catch (err) {
    return {
      written: false,
      error: `Failed to write step summary: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
