import type { QEResult } from "../types/index.js";
import { renderQESummary } from "../core/reporting/index.js";

/**
 * Render a QE result as a prompt payload for a headless Kiro CLI run.
 * The body is the canonical QE summary; only the framing is Kiro-specific.
 */
export function renderKiroPrompt(
  result: QEResult,
  redactSecrets: (text: string) => string,
): string {
  return (
    `QE Agent completed an autonomous quality-engineering run.\n` +
    `Verdict: ${result.verdict} (confidence: ${result.confidence}).\n\n` +
    renderQESummary(result, redactSecrets)
  );
}
