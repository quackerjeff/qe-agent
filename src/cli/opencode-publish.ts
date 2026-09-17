import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { Logger } from "../logging/index.js";
import { loadConfig, getDefaultConfig } from "../config/index.js";
import {
  validateResultForPublishing,
  OpenCodeReporter,
  FakeOpenCodeClient,
  HttpOpenCodeClient,
  parseOpenCodeContext,
  getOpenCodeServerPassword,
  ProcessEnvironmentSource,
  isOpenCodeHarness,
  persistSessionMessage,
  type OpenCodeReporterConfig,
  type OpenCodeClient,
  type EnvironmentSource,
} from "../opencode/index.js";

export interface OpenCodePublishOptions {
  result: string;
  repo?: string;
  session?: string;
  dryRun?: boolean;
  json?: boolean;
}

export async function runOpenCodePublish(
  options: OpenCodePublishOptions,
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

  const dryRun = options.dryRun ?? config.opencode.dryRun;

  const env: EnvironmentSource = new ProcessEnvironmentSource();
  let context = parseOpenCodeContext(env);

  if (options.session) {
    context = {
      serverUrl: env.get("OPENCODE_SERVER_URL") ?? "http://127.0.0.1:4096",
      sessionId: options.session,
      username: env.get("OPENCODE_SERVER_USERNAME"),
      password: getOpenCodeServerPassword(env),
    };
  }

  if (!context && !dryRun) {
    logger.error(
      "No OpenCode session target. Pass --session <id>, set QE_OPENCODE_SESSION_ID, " +
        "or use --dry-run.",
    );
    process.exit(1);
  }

  const effectiveContext = context ?? {
    serverUrl: "http://127.0.0.1:4096",
    sessionId: "dry-run",
  };

  const password = getOpenCodeServerPassword(env);
  const knownSecrets = password ? [password] : [];

  const reporterConfig: OpenCodeReporterConfig = {
    messageEnabled: config.opencode.messageEnabled,
    toastEnabled: config.opencode.toastEnabled,
    dryRun,
    maxRetries: 2,
  };

  let client: OpenCodeClient;
  if (dryRun) {
    client = new FakeOpenCodeClient();
  } else {
    client = new HttpOpenCodeClient(
      effectiveContext.serverUrl,
      {
        username: effectiveContext.username,
        password: effectiveContext.password,
      },
      undefined,
    );
  }

  const reporter = new OpenCodeReporter(client, reporterConfig);

  const publishResult = await reporter.publish(
    qeResult,
    effectiveContext,
    knownSecrets,
  );

  await persistSessionMessage(qeResult, repoPath, knownSecrets);

  if (options.json) {
    console.log(JSON.stringify(publishResult, null, 2));
  } else {
    logger.info(`Message delivered: ${publishResult.messageDelivered}`);
    logger.info(`Session: ${publishResult.sessionId}`);
    if (publishResult.dryRun) {
      logger.info("(dry-run mode — no remote writes)");
    }
    for (const w of publishResult.warnings) {
      logger.warn(w);
    }
  }

  if (isOpenCodeHarness(env)) {
    logger.info("Running inside OpenCode harness context detected.");
  }
}
