import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { Logger } from "../logging/index.js";
import { loadConfig, getDefaultConfig } from "../config/index.js";
import {
  validateResultForPublishing,
  GitHubReporter,
  FakeGitHubClient,
  HttpGitHubClient,
  parseGitHubContext,
  getGitHubToken,
  ProcessEnvironmentSource,
  FakeEnvironmentSource,
  isGitHubActions,
  persistSummary,
  writeStepSummary,
  type GitHubReporterConfig,
  type GitHubClient,
  type EnvironmentSource,
} from "../github/index.js";

export interface GitHubPublishOptions {
  result: string;
  repo?: string;
  dryRun?: boolean;
  json?: boolean;
}

export async function runGitHubPublish(
  options: GitHubPublishOptions,
  logger: Logger,
): Promise<void> {
  const repoPath = resolve(options.repo ?? process.cwd());

  let config = getDefaultConfig();
  try {
    config = await loadConfig(repoPath);
  } catch {
    // No config — use defaults
  }

  const resultPath = resolve(options.result);

  const absRepo = resolve(repoPath);
  const rel = relative(absRepo, resultPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    logger.error("Result file must be within the repository directory");
    process.exit(1);
  }

  let rawJson: unknown;
  try {
    const text = await readFile(resultPath, "utf-8");
    rawJson = JSON.parse(text);
  } catch (err) {
    logger.error(
      `Failed to read result file: ${err instanceof Error ? err.message : "unknown"}`,
    );
    process.exit(1);
  }

  let qeResult;
  try {
    qeResult = validateResultForPublishing(rawJson);
  } catch (err) {
    logger.error(
      `Invalid QEResult: ${err instanceof Error ? err.message : "schema validation failed"}`,
    );
    process.exit(1);
  }

  const dryRun = options.dryRun ?? config.github.dryRun;

  const env: EnvironmentSource = new ProcessEnvironmentSource();
  const context = parseGitHubContext(env);

  if (!context && !dryRun) {
    logger.error(
      "Not running in GitHub Actions and --dry-run not specified. " +
        "Set GITHUB_* environment variables or use --dry-run.",
    );
    process.exit(1);
  }

  const effectiveContext =
    context ??
    parseGitHubContext(
      new FakeEnvironmentSource({
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "local/dry-run",
        GITHUB_EVENT_NAME: "push",
        GITHUB_RUN_ID: "0",
        GITHUB_WORKFLOW: "dry-run",
        GITHUB_SHA: qeResult.target,
        GITHUB_REF: "refs/heads/dry-run",
      }),
    )!;

  const token = getGitHubToken(env);
  const knownSecrets = token ? [token] : [];

  const reporterConfig: GitHubReporterConfig = {
    checksEnabled: config.github.checks.enabled,
    issuesEnabled: config.github.issues.enabled,
    issueEligibility: {
      minimumSeverity: config.github.issues.minimumSeverity,
      minimumConfidence: config.github.issues.minimumConfidence,
    },
    dryRun,
    maxRetries: 2,
  };

  let client: GitHubClient;
  if (dryRun) {
    client = new FakeGitHubClient();
  } else if (!token) {
    const enabledFeatures: string[] = [];
    if (reporterConfig.checksEnabled) enabledFeatures.push("checks");
    if (reporterConfig.issuesEnabled) enabledFeatures.push("issues");
    if (enabledFeatures.length > 0) {
      logger.error(
        `GITHUB_TOKEN is required for publishing ${enabledFeatures.join(" and ")}. ` +
          "Set the token or use --dry-run.",
      );
      process.exit(1);
    }
    client = new FakeGitHubClient();
  } else {
    client = new HttpGitHubClient(token, effectiveContext.apiUrl);
  }

  const reporter = new GitHubReporter(client, reporterConfig);

  const publishResult = await reporter.publish(
    qeResult,
    effectiveContext,
    knownSecrets,
  );

  const buildRedactor = (secrets: string[]) => {
    const meaningful = secrets.filter((s) => s.length >= 4);
    if (meaningful.length === 0) return (t: string) => t;
    return (text: string) => {
      let r = text;
      for (const s of meaningful) {
        while (r.includes(s)) r = r.replace(s, "***");
      }
      return r;
    };
  };

  if (isGitHubActions(env)) {
    const summaryPath = env.get("GITHUB_STEP_SUMMARY");
    const summaryResult = await writeStepSummary(
      qeResult,
      summaryPath,
      buildRedactor(knownSecrets),
    );
    if (!summaryResult.written && summaryResult.error) {
      logger.warn(`Step summary: ${summaryResult.error}`);
    }
  }

  await persistSummary(qeResult, repoPath, knownSecrets);

  if (options.json) {
    console.log(JSON.stringify(publishResult, null, 2));
  } else {
    logger.info(`Check published: ${publishResult.checkPublished}`);
    if (publishResult.checkUrl) {
      logger.info(`Check URL: ${publishResult.checkUrl}`);
    }
    logger.info(`Issues proposed: ${publishResult.issuesProposed}`);
    logger.info(`Issues created: ${publishResult.issuesCreated}`);
    logger.info(
      `Issues skipped (duplicate): ${publishResult.issuesSkippedDuplicate}`,
    );
    logger.info(
      `Issues skipped (ineligible): ${publishResult.issuesSkippedIneligible}`,
    );
    if (publishResult.dryRun) {
      logger.info("(dry-run mode — no remote writes)");
    }
    for (const w of publishResult.publishingWarnings) {
      logger.warn(w);
    }
  }
}
