import type { QEResult } from "../types/index.js";
import { renderQESummary } from "../core/reporting/index.js";

/**
 * Render a QE result as a markdown message suitable for delivery into an
 * OpenCode session. The body is the canonical QE summary; only the
 * session-facing heading is OpenCode-specific.
 */
export function renderSessionMessage(
  result: QEResult,
  redactSecrets: (text: string) => string,
): string {
  const heading =
    `# QE Agent Verdict — ${result.verdict}\n\n` +
    `The QE Agent completed an autonomous quality-engineering run.\n\n`;
  return heading + renderQESummary(result, redactSecrets);
}
