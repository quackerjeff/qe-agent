import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { QEResult } from "../types/index.js";
import { QEResultSchema } from "../types/index.js";
import type { GitHubClient } from "./client.js";
import { GitHubApiError } from "./client.js";
import type { GitHubContext, GitHubPublishingResult } from "./types.js";
import { mapVerdictToConclusion } from "./verdict.js";
import { renderWorkflowSummary } from "./summary.js";
import {
  proposeIssues,
  publishIssues,
  type IssueEligibilityConfig,
} from "./issues.js";

export interface GitHubReporterConfig {
  checksEnabled: boolean;
  issuesEnabled: boolean;
  issueEligibility: IssueEligibilityConfig;
  dryRun: boolean;
  maxRetries: number;
}

export class GitHubReporter {
  constructor(
    private readonly client: GitHubClient,
    private readonly config: GitHubReporterConfig,
  ) {}

  async publish(
    result: QEResult,
    context: GitHubContext,
    knownSecrets: string[] = [],
  ): Promise<GitHubPublishingResult> {
    const redact = buildRedactor(knownSecrets);

    const publishingResult: GitHubPublishingResult = {
      checkPublished: false,
      issuesProposed: 0,
      issuesCreated: 0,
      issuesSkippedDuplicate: 0,
      issuesSkippedIneligible: 0,
      publishingWarnings: [],
      dryRun: this.config.dryRun,
    };

    if (this.config.checksEnabled) {
      await this.publishCheck(result, context, redact, publishingResult);
    }

    if (this.config.issuesEnabled) {
      await this.publishIssuesForFindings(
        result,
        context,
        redact,
        publishingResult,
      );
    }

    return publishingResult;
  }

  private async publishCheck(
    result: QEResult,
    context: GitHubContext,
    redact: (text: string) => string,
    out: GitHubPublishingResult,
  ): Promise<void> {
    const conclusion = mapVerdictToConclusion(result.verdict);
    const summary = renderWorkflowSummary(result, redact);
    const title = `QE ${result.verdict} — ${result.confidence} confidence`;

    const findingsText =
      result.findings.length > 0
        ? result.findings
            .map((f) => `**${f.severity}** ${f.category}: ${redact(f.title)}`)
            .join("\n")
        : "No findings.";

    if (this.config.dryRun) {
      out.checkPublished = true;
      out.checkUrl = "(dry-run)";
      return;
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.client.createCheck({
          owner: context.repositoryOwner,
          repo: context.repositoryName,
          headSha: context.headSha ?? context.sha,
          name: "QE Agent",
          conclusion,
          title: redact(title),
          summary: redact(summary.substring(0, 65535)),
          text: redact(findingsText.substring(0, 65535)),
        });
        out.checkPublished = true;
        out.checkUrl = response.url;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof GitHubApiError && err.isRateLimit) {
          out.publishingWarnings.push(
            redact("Rate limited during check publication"),
          );
          break;
        }
        if (attempt < this.config.maxRetries) continue;
      }
    }

    out.publishingWarnings.push(
      redact(`Check publication failed: ${lastError?.message ?? "unknown"}`),
    );
  }

  private async publishIssuesForFindings(
    result: QEResult,
    context: GitHubContext,
    redact: (text: string) => string,
    out: GitHubPublishingResult,
  ): Promise<void> {
    const proposals = proposeIssues(
      result,
      context,
      this.config.issueEligibility,
    );

    out.issuesProposed = proposals.length;
    out.issuesSkippedIneligible = proposals.filter((p) => !p.eligible).length;

    const { created, skippedDuplicate, warnings } = await publishIssues(
      this.client,
      context,
      proposals,
      this.config.dryRun,
      redact,
    );

    out.issuesCreated = created;
    out.issuesSkippedDuplicate = skippedDuplicate;
    out.publishingWarnings.push(...warnings);
  }
}

function buildRedactor(knownSecrets: string[]): (text: string) => string {
  const meaningful = knownSecrets.filter((s) => s.length >= 4);
  if (meaningful.length === 0) return (t) => t;

  return (text: string) => {
    let result = text;
    for (const secret of meaningful) {
      while (result.includes(secret)) {
        result = result.replace(secret, "***");
      }
    }
    return result;
  };
}

export function validateResultForPublishing(json: unknown): QEResult {
  return QEResultSchema.parse(json);
}

export async function persistResult(
  result: QEResult,
  repoPath: string,
): Promise<string> {
  const absRepo = resolve(repoPath);
  const runDir = join(absRepo, ".qe", "runs", result.executionId);
  await mkdir(runDir, { recursive: true });
  const resultPath = join(runDir, "result.json");
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf-8");
  return resultPath;
}

export async function persistSummary(
  result: QEResult,
  repoPath: string,
  knownSecrets: string[] = [],
): Promise<string> {
  const redact = buildRedactor(knownSecrets);
  const summary = renderWorkflowSummary(result, redact);
  const absRepo = resolve(repoPath);
  const runDir = join(absRepo, ".qe", "runs", result.executionId);
  await mkdir(runDir, { recursive: true });
  const summaryPath = join(runDir, "summary.md");
  await writeFile(summaryPath, summary, "utf-8");
  return summaryPath;
}
