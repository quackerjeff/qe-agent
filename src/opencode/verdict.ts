import type { Verdict } from "../types/domain.js";
import { VERDICT_TO_URGENCY, type OpenCodeMessageUrgency } from "./types.js";

export function mapVerdictToUrgency(verdict: Verdict): OpenCodeMessageUrgency {
  return VERDICT_TO_URGENCY[verdict] ?? "normal";
}

export function shouldFailHarness(
  verdict: Verdict,
  failOn: Verdict[],
): boolean {
  return failOn.includes(verdict);
}

export function getHarnessExitCode(
  verdict: Verdict,
  failOn: Verdict[],
): number {
  return shouldFailHarness(verdict, failOn) ? 1 : 0;
}
