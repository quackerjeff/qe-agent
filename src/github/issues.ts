import { createHash } from "node:crypto";
import type {
  QEResult,
  Finding,
  Evidence,
  BaselineComparison,
} from "../types/index.js";
import type { FindingSeverity } from "../types/domain.js";
import type { GitHubClient } from "./client.js";
import type { GitHubContext, IssueProposal } from "./types.js";

const FINGERPRINT_PREFIX = "<!-- qe-fingerprint:";
const FINGERPRINT_SUFFIX = " -->";

const INELIGIBLE_CATEGORIES = new Set([
  "TEST_DEFECT",
  "ENVIRONMENT_ISSUE",
  "FLAKY_TEST",
]);

const SEVERITY_RANK: Record<string, number> = {
  BLOCKER: 6,
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFORMATIONAL: 1,
};

const CONFIDENCE_RANK: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export interface IssueEligibilityConfig {
  minimumSeverity: FindingSeverity;
  minimumConfidence: number;
}

export function computeFingerprint(
  owner: string,
  repo: string,
  finding: Finding,
): string {
  const parts = [
    owner,
    repo,
    finding.category,
    ...(finding.affectedFiles ?? []).sort(),
    finding.title.toLowerCase().trim(),
  ];
  const hash = createHash("sha256").update(parts.join("|")).digest("hex");
  return hash.substring(0, 16);
}

export function formatFingerprintMarker(fingerprint: string): string {
  return `${FINGERPRINT_PREFIX}${fingerprint}${FINGERPRINT_SUFFIX}`;
}

export function isEligibleForIssue(
  finding: Finding,
  baselineComparisons: BaselineComparison[] | undefined,
  config: IssueEligibilityConfig,
  evidence?: Evidence[],
): { eligible: boolean; reason?: string } {
  if (INELIGIBLE_CATEGORIES.has(finding.category)) {
    return {
      eligible: false,
      reason: `category ${finding.category} is not eligible`,
    };
  }

  if (finding.evidenceIds.length === 0) {
    return { eligible: false, reason: "no evidence references" };
  }

  if (evidence) {
    const evidenceIdSet = new Set(evidence.map((e) => e.id));
    const invalid = finding.evidenceIds.filter((id) => !evidenceIdSet.has(id));
    if (invalid.length > 0) {
      return {
        eligible: false,
        reason: `evidence references not found in QEResult: ${invalid.join(", ")}`,
      };
    }
  }

  if (baselineComparisons && baselineComparisons.length > 0 && evidence) {
    const evidenceIdSet = new Set(evidence.map((e) => e.id));
    const findingEvidenceIds = new Set(finding.evidenceIds);
    const relevant = baselineComparisons.filter((bc) =>
      findingEvidenceIds.has(bc.targetEvidenceId),
    );
    for (const bc of relevant) {
      if (!evidenceIdSet.has(bc.targetEvidenceId)) {
        return {
          eligible: false,
          reason: `baseline comparison references missing target evidence: ${bc.targetEvidenceId}`,
        };
      }
      if (bc.baselineEvidenceId && !evidenceIdSet.has(bc.baselineEvidenceId)) {
        return {
          eligible: false,
          reason: `baseline comparison references missing baseline evidence: ${bc.baselineEvidenceId}`,
        };
      }
    }
  }

  const severityRank = SEVERITY_RANK[finding.severity] ?? 0;
  const minSeverityRank = SEVERITY_RANK[config.minimumSeverity] ?? 0;
  if (severityRank < minSeverityRank) {
    return {
      eligible: false,
      reason: `severity ${finding.severity} below threshold ${config.minimumSeverity}`,
    };
  }

  const confidenceStr =
    finding.confidence >= 0.8
      ? "HIGH"
      : finding.confidence >= 0.5
        ? "MEDIUM"
        : "LOW";
  const confidenceRank = CONFIDENCE_RANK[confidenceStr] ?? 0;
  const minConfidenceRank =
    CONFIDENCE_RANK[
      config.minimumConfidence >= 0.8
        ? "HIGH"
        : config.minimumConfidence >= 0.5
          ? "MEDIUM"
          : "LOW"
    ] ?? 0;
  if (confidenceRank < minConfidenceRank) {
    return {
      eligible: false,
      reason: `confidence ${finding.confidence} below threshold`,
    };
  }

  if (baselineComparisons && baselineComparisons.length > 0) {
    const findingEvidenceIds = new Set(finding.evidenceIds);
    const relevant = baselineComparisons.filter((bc) =>
      findingEvidenceIds.has(bc.targetEvidenceId),
    );
    if (relevant.length > 0) {
      const hasIntroduced = relevant.some(
        (bc) => bc.classification === "INTRODUCED",
      );
      if (!hasIntroduced) {
        const classifications = [
          ...new Set(relevant.map((bc) => bc.classification)),
        ];
        return {
          eligible: false,
          reason: `baseline classification is ${classifications.join(", ")}, not INTRODUCED`,
        };
      }
    }
  }

  return { eligible: true };
}

export function proposeIssues(
  result: QEResult,
  context: GitHubContext,
  config: IssueEligibilityConfig,
): IssueProposal[] {
  const proposals: IssueProposal[] = [];

  for (const finding of result.findings) {
    const fingerprint = computeFingerprint(
      context.repositoryOwner,
      context.repositoryName,
      finding,
    );

    const eligibility = isEligibleForIssue(
      finding,
      result.baselineComparisons,
      config,
      result.evidence,
    );

    const title = `[QE Agent] ${finding.severity}: ${finding.title}`;
    const body = formatIssueBody(finding, result, fingerprint);

    proposals.push({
      findingId: finding.id,
      title,
      body,
      labels: ["qe-agent"],
      fingerprint,
      eligible: eligibility.eligible,
      ineligibleReason: eligibility.reason,
    });
  }

  return proposals;
}

function formatIssueBody(
  finding: Finding,
  result: QEResult,
  fingerprint: string,
): string {
  const lines: string[] = [];

  lines.push("## QE Agent Finding");
  lines.push("");
  lines.push(`**Severity:** ${finding.severity}`);
  lines.push(`**Category:** ${finding.category}`);
  lines.push(`**Confidence:** ${finding.confidence}`);
  lines.push("");

  lines.push("### Description");
  lines.push(finding.description);
  lines.push("");

  if (finding.affectedFiles && finding.affectedFiles.length > 0) {
    lines.push("### Affected Files");
    for (const f of finding.affectedFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  if (finding.reproduction) {
    lines.push("### Reproduction");
    for (const step of finding.reproduction.steps) {
      lines.push(`1. ${step}`);
    }
    if (finding.reproduction.command) {
      lines.push("");
      lines.push(`\`\`\`\n${finding.reproduction.command}\n\`\`\``);
    }
    lines.push("");
  }

  if (finding.proposedRemediation) {
    lines.push("### Proposed Remediation");
    lines.push(finding.proposedRemediation);
    lines.push("");
  }

  lines.push("---");
  lines.push(`Execution ID: \`${result.executionId}\``);
  lines.push("");
  lines.push(formatFingerprintMarker(fingerprint));

  return lines.join("\n");
}

export async function publishIssues(
  client: GitHubClient,
  context: GitHubContext,
  proposals: IssueProposal[],
  dryRun: boolean,
  redactSecrets: (text: string) => string,
): Promise<{
  created: number;
  skippedDuplicate: number;
  warnings: string[];
}> {
  let created = 0;
  let skippedDuplicate = 0;
  const warnings: string[] = [];

  const eligible = proposals.filter((p) => p.eligible);

  for (const proposal of eligible) {
    if (dryRun) {
      created++;
      continue;
    }

    try {
      const existing = await client.findOpenIssueByFingerprint(
        context.repositoryOwner,
        context.repositoryName,
        proposal.fingerprint,
      );

      if (existing) {
        skippedDuplicate++;
        continue;
      }

      await client.createIssue({
        owner: context.repositoryOwner,
        repo: context.repositoryName,
        title: redactSecrets(proposal.title),
        body: redactSecrets(proposal.body),
        labels: proposal.labels,
      });
      created++;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unknown issue creation error";
      warnings.push(
        redactSecrets(
          `Issue creation failed for ${proposal.findingId}: ${msg}`,
        ),
      );
    }
  }

  return { created, skippedDuplicate, warnings };
}
