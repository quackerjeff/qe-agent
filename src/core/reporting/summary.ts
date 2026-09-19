import type { QEResult } from "../../types/index.js";
import { redactSecrets } from "../../execution/secret-redactor.js";

/**
 * Canonical markdown renderer for a QEResult (ADR-009 canonical result
 * contract). Integration-specific publishers (GitHub workflow summary,
 * OpenCode session message) use this as their shared core so the rendered
 * verdict never drifts between invocation mechanisms.
 */
export function renderQESummary(
  result: QEResult,
  redact: (text: string) => string,
): string {
  const lines: string[] = [];

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
  lines.push(redact(result.summary));
  lines.push("");

  if (result.changeAnalysis) {
    lines.push("## Change Analysis");
    lines.push(redact(result.changeAnalysis.summary));
    lines.push("");
    if (result.changeAnalysis.changedFiles.length > 0) {
      lines.push(`${result.changeAnalysis.changedFiles.length} files changed`);
      lines.push("");
    }
  }

  lines.push("## Risk Assessment");
  lines.push(`**Level:** ${result.riskAssessment.level}`);
  lines.push(redact(result.riskAssessment.summary));
  lines.push("");

  if (result.evidence.length > 0) {
    lines.push("## Validations Executed");
    lines.push("");
    for (const e of result.evidence) {
      const icon =
        e.status === "PASS" ? "pass" : e.status === "FAIL" ? "FAIL" : e.status;
      lines.push(`- [${icon}] ${redact(e.summary)}`);
    }
    lines.push("");
  }

  if (result.findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const f of result.findings) {
      lines.push(
        `- **${f.severity}** ${f.category}: ${redact(f.title)} (confidence: ${f.confidence})`,
      );
    }
    lines.push("");
  }

  if (result.requirements.length > 0) {
    lines.push("## Requirements");
    lines.push("");
    for (const r of result.requirements) {
      lines.push(
        `- ${r.status} — ${r.requirementId}: ${redact(r.explanation)}`,
      );
    }
    lines.push("");
  }

  if (result.baselineComparisons && result.baselineComparisons.length > 0) {
    lines.push("## Baseline Classifications");
    lines.push("");
    for (const bc of result.baselineComparisons) {
      lines.push(`- ${bc.classification}: evidence \`${bc.targetEvidenceId}\``);
    }
    lines.push("");
  }

  if (result.generatedTestChanges && result.generatedTestChanges.length > 0) {
    const retained = result.generatedTestChanges.filter((t) => t.retained);
    lines.push("## Generated Tests");
    lines.push(
      `${result.generatedTestChanges.length} generated, ${retained.length} retained`,
    );
    lines.push("");
  }

  if (result.remainingGaps.length > 0) {
    lines.push("## Remaining Gaps");
    lines.push("");
    for (const g of result.remainingGaps) {
      lines.push(`- [${g.risk}] ${g.area}: ${redact(g.description)}`);
    }
    lines.push("");
  }

  if (result.memoryWarnings && result.memoryWarnings.length > 0) {
    lines.push("## Memory Warnings");
    lines.push("");
    for (const w of result.memoryWarnings) {
      lines.push(`- ${w.type}: ${redact(w.message)}`);
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

/**
 * Wrap the canonical redactor for call sites that pass secrets as a list.
 * Secrets shorter than 4 characters are ignored (too likely to redact
 * incidental substrings).
 */
export function redactorFor(secrets: string[]): (text: string) => string {
  const meaningful = secrets.filter((s) => s.length >= 4);
  if (meaningful.length === 0) return (t) => t;
  return (text) => redactSecrets(text, meaningful);
}
