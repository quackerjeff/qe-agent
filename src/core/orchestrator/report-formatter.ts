import type { QEResult } from "../../types/index.js";

export function formatQEReport(result: QEResult): string {
  const lines: string[] = [];

  lines.push("═".repeat(60));
  lines.push(`  QE VERDICT: ${result.verdict}`);
  lines.push(`  Confidence: ${result.confidence}`);
  lines.push("═".repeat(60));
  lines.push("");

  lines.push("## Summary");
  lines.push(result.summary);
  lines.push("");

  if (result.changeAnalysis) {
    lines.push("## Change Analysis");
    lines.push(result.changeAnalysis.summary);
    if (result.changeAnalysis.changedFiles.length > 0) {
      lines.push("");
      lines.push(`Files changed: ${result.changeAnalysis.changedFiles.length}`);
      for (const f of result.changeAnalysis.changedFiles.slice(0, 20)) {
        lines.push(`  ${f.changeType.padEnd(10)} ${f.path}`);
      }
      if (result.changeAnalysis.changedFiles.length > 20) {
        lines.push(
          `  ... and ${result.changeAnalysis.changedFiles.length - 20} more`,
        );
      }
    }
    if (result.changeAnalysis.unknowns.length > 0) {
      lines.push("");
      lines.push("Unknowns:");
      for (const u of result.changeAnalysis.unknowns) {
        lines.push(`  - ${u}`);
      }
    }
    lines.push("");
  }

  lines.push("## Risk Assessment");
  lines.push(`Level: ${result.riskAssessment.level}`);
  lines.push(result.riskAssessment.summary);
  if (result.riskAssessment.factors.length > 0) {
    lines.push("");
    lines.push("Risk Factors:");
    for (const f of result.riskAssessment.factors) {
      lines.push(`  [${f.weight.toUpperCase()}] ${f.factor}: ${f.reason}`);
    }
  }
  lines.push("");

  if (result.requirements.length > 0) {
    lines.push("## Requirements Validation");
    for (const r of result.requirements) {
      const icon =
        r.status === "VERIFIED"
          ? "[VERIFIED]"
          : r.status === "PARTIALLY_VERIFIED"
            ? "[PARTIAL] "
            : r.status === "NOT_VERIFIED"
              ? "[NOT_VER] "
              : r.status === "BLOCKED"
                ? "[BLOCKED] "
                : "[N/A]     ";
      lines.push(`  ${icon} ${r.requirementId}: ${r.explanation}`);
    }
    lines.push("");
  }

  lines.push("## Validation Performed");
  if (result.evidence.length > 0) {
    for (const e of result.evidence) {
      const statusTag =
        e.provenance === "executed"
          ? `[${e.status}]`
          : e.provenance === "inferred"
            ? "[inferred]"
            : `[${e.provenance}]`;
      lines.push(`  ${statusTag.padEnd(14)} ${e.summary}`);
    }
  } else {
    lines.push("  No validation actions were executed.");
  }
  lines.push("");

  if (result.findings.length > 0) {
    lines.push("## Findings");
    for (const f of result.findings) {
      lines.push(
        `  [${f.severity}] ${f.category}: ${f.title} (confidence: ${f.confidence})`,
      );
      if (f.description) {
        lines.push(`    ${f.description}`);
      }
    }
    lines.push("");
  }

  if (result.remainingGaps.length > 0) {
    lines.push("## Remaining Gaps");
    for (const g of result.remainingGaps) {
      lines.push(`  [${g.risk}] ${g.area}: ${g.description}`);
      lines.push(`    Reason: ${g.reason}`);
    }
    lines.push("");
  }

  if (result.recommendedNextActions.length > 0) {
    lines.push("## Recommended Next Actions");
    for (const a of result.recommendedNextActions) {
      lines.push(`  - ${a}`);
    }
    lines.push("");
  }

  lines.push("## Execution Metrics");
  lines.push(`  Duration:           ${result.metrics.durationMs ?? 0}ms`);
  lines.push(`  Model calls:        ${result.metrics.modelCalls}`);
  lines.push(`  Commands executed:   ${result.metrics.commandsExecuted}`);
  lines.push(`  State transitions:  ${result.metrics.stateTransitions}`);
  lines.push("");

  if (result.aiUsage) {
    const u = result.aiUsage;
    lines.push("## AI Usage");
    if (u.failedModelCalls > 0) {
      lines.push(
        `  Model calls:        ${u.modelCalls} (${u.failedModelCalls} failed)`,
      );
    } else {
      lines.push(`  Model calls:        ${u.modelCalls}`);
    }
    lines.push(
      `  Input tokens:       ${u.inputTokens.toLocaleString("en-US")}`,
    );
    lines.push(
      `  Output tokens:      ${u.outputTokens.toLocaleString("en-US")}`,
    );
    if (u.cachedTokens > 0) {
      lines.push(
        `  Cached tokens:      ${u.cachedTokens.toLocaleString("en-US")}`,
      );
    }
    if (u.estimatedCost !== undefined) {
      lines.push(`  Estimated cost:     $${u.estimatedCost.toFixed(2)}`);
    }
    if (u.throughputLimit !== undefined) {
      lines.push(
        `  Throughput limit:   ${u.throughputLimit.toLocaleString("en-US")} TPM`,
      );
    }
    if (u.limitStatus !== "OK" && u.limitStatus !== "UNKNOWN") {
      lines.push(`  Limit status:       ${u.limitStatus}`);
    }
    if (u.limitClassification) {
      lines.push(`  Limit class:        ${u.limitClassification}`);
    }
    if (u.throughputActions && u.throughputActions.length > 0) {
      lines.push("  Throughput actions:");
      for (const a of u.throughputActions) {
        lines.push(`    [${a.action}] ${a.reason}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
