import type { Verdict } from "../types/domain.js";
import { VERDICT_TO_URGENCY, type OpenCodeMessageUrgency } from "./types.js";

export function mapVerdictToUrgency(verdict: Verdict): OpenCodeMessageUrgency {
  return VERDICT_TO_URGENCY[verdict];
}
