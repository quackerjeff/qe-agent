import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { access, constants } from "node:fs/promises";
import type { Logger } from "../logging/index.js";
import { loadConfig, getDefaultConfig } from "../config/index.js";
import {
  validateResultForPublishing,
  KiroReporter,
  SpawnKiroClient,
  persistKiroPrompt,
  type KiroContext,
  type KiroReporterConfig,
} from "../kiro/index.js";

/** Default kiro-cli executable name; resolved from PATH at run time. */
const DEFAULT_KIRO_EXECUTABLE = "kiro-cli";

export interface KiroPublishOptions {
  result: string;
  repo?: string;
  /** Kiro session ID to resume (--resume-id). */
  session?: string;
  /** Agent profile to use (--agent). */
  agent?: string;
  /** Extra per-run timeout in milliseconds. */
  timeoutMs?: number;
  /** Let the Kiro agent act on the verdict (--trust-all-tools). */
  trustAllTools?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/**
 * Verify the kiro-cli executable exists before attempting delivery so
 * the user gets an actionable error instead of a spawn ENOENT.
 */
async function resolveKiroExecutable(): Promise<string> {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (dir.length === 0) continue;
    const candidate = resolve(dir, DEFAULT_KIRO_EXECUTABLE);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not in this PATH entry — continue
    }
  }
  return DEFAULT_KIRO_EXECUTABLE;
}

export async function runKiroPublish(
  options: KiroPublishOptions,
  logger: Logger,
): Promise<void> {
  const repoPath = resolve(options.repo ?? process.cwd());

  let config = getDefaultConfig();
  try {
    const loaded = await loadConfig(repoPath);
    config = loaded.config;
  } catch {
    // No config — use defaults
  }

  const resultPath = resolve(options.result);
  const rel = relative(repoPath, resultPath);
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

  const dryRun = options.dryRun ?? config.kiro.dryRun;
  const trustAllTools = options.trustAllTools ?? config.kiro.trustAllTools;

  const context: KiroContext = {
    executable: await resolveKiroExecutable(),
    sessionId: options.session,
    agent: options.agent,
    // trustAllTools lets the Kiro agent act on the delivered verdict
    // (tools auto-approve in headless mode). Otherwise delivery is a
    // report: the Kiro agent may read the repository to interpret the
    // verdict but must not modify anything.
    trustAllTools,
    trustTools: trustAllTools ? undefined : ["read", "grep", "fs_read"],
    timeoutMs: options.timeoutMs,
  };

  const reporterConfig: KiroReporterConfig = {
    dryRun,
    maxRetries: 1,
  };

  const reporter = new KiroReporter(reporterConfig);

  let publishResult;
  if (dryRun) {
    // Dry-run reports what would be delivered; no CLI process is spawned.
    publishResult = await reporter.publish(qeResult, context, undefined, []);
  } else {
    const client = new SpawnKiroClient();
    publishResult = await reporter.publish(qeResult, context, client, []);
  }

  await persistKiroPrompt(qeResult, repoPath, []);

  if (options.json) {
    console.log(JSON.stringify(publishResult, null, 2));
  } else {
    logger.info(`Prompt delivered: ${publishResult.promptDelivered}`);
    logger.info(`Session: ${publishResult.sessionId ?? "(new session)"}`);
    if (publishResult.exitCode !== undefined) {
      logger.info(`Kiro CLI exit code: ${publishResult.exitCode}`);
    }
    if (publishResult.dryRun) {
      logger.info("(dry-run mode — no Kiro CLI run)");
    }
    for (const w of publishResult.warnings) {
      logger.warn(w);
    }
  }
}
