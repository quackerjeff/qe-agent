import type { Verdict } from "../types/domain.js";
import { VERDICT_TO_CHECK, type GitHubCheckConclusion } from "./types.js";

export function mapVerdictToConclusion(
  verdict: Verdict,
): GitHubCheckConclusion {
  return VERDICT_TO_CHECK[verdict];
}

export function shouldFailCi(verdict: Verdict, failOn: Verdict[]): boolean {
  return failOn.includes(verdict);
}

export function getCiExitCode(verdict: Verdict, failOn: Verdict[]): number {
  return shouldFailCi(verdict, failOn) ? 1 : 0;
}
