import type { QEResult } from "../types/index.js";

/**
 * Render a QE result as a markdown message suitable for delivery into an
 * OpenCode session. Reuses the same fields as the GitHub workflow summary
 * but framed for an interactive harness consumer.
 */
export function renderSessionMessage(
  result: QEResult,
  redactSecrets: (text: string) => string,
): string {
  const lines: string[] = [];

  lines.push(`# QE Agent Verdict — ${result.verdict}`);
  lines.push("");
  lines.push(`The QE Agent completed an autonomous quality-engineering run.`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Verdict | **${result.verdict}** |`);
  lines.push(`| Confidence | ${result.confidence} |`);
  lines.push(`| Profile | ${result.profile} |`);
  lines.push(`| Execution ID | \`${result.executionId}\` |`);
  lines.push(
    `| Repository | ${result.repository.name ?? result.repository.path} |`,
  );
  lines.push("");

  lines.push("## Summary");
  lines.push(redactSecrets(result.summary));
  lines.push("");

  if (result.changeAnalysis) {
    lines.push("## Change Analysis");
    lines.push(redactSecrets(result.changeAnalysis.summary));
    lines.push("");
  }

  lines.push("## Risk Assessment");
  lines.push(`**Level:** ${result.riskAssessment.level}`);
  lines.push(redactSecrets(result.riskAssessment.summary));
  lines.push("");

  if (result.evidence.length > 0) {
    lines.push("## Validations Executed");
    lines.push("");
    for (const e of result.evidence) {
      const icon =
        e.status === "PASS" ? "pass" : e.status === "FAIL" ? "FAIL" : e.status;
      lines.push(`- [${icon}] ${redactSecrets(e.summary)}`);
    }
    lines.push("");
  }

  if (result.findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const f of result.findings) {
      lines.push(
        `- **${f.severity}** ${f.category}: ${redactSecrets(f.title)} (confidence: ${f.confidence})`,
      );
    }
    lines.push("");
  }

  if (result.requirements.length > 0) {
    lines.push("## Requirements");
    lines.push("");
    for (const r of result.requirements) {
      lines.push(
        `- ${r.status} — ${r.requirementId}: ${redactSecrets(r.explanation)}`,
      );
    }
    lines.push("");
  }

  if (result.remainingGaps.length > 0) {
    lines.push("## Remaining Gaps");
    lines.push("");
    for (const g of result.remainingGaps) {
      lines.push(`- [${g.risk}] ${g.area}: ${redactSecrets(g.description)}`);
    }
    lines.push("");
  }

  lines.push("## Metrics");
  lines.push(`- Duration: ${result.metrics.durationMs ?? 0}ms`);
  lines.push(`- Model calls: ${result.metrics.modelCalls}`);
  lines.push(`- Commands executed: ${result.metrics.commandsExecuted}`);
  lines.push("");

  return lines.join("\n");
}
