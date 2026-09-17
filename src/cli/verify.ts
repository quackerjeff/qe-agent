import { resolve } from "node:path";
import type { Logger } from "../logging/index.js";
import { createLogger, StderrLogSink } from "../logging/index.js";
import { loadConfig, getDefaultConfig } from "../config/index.js";
import { QEOrchestrator } from "../core/orchestrator/index.js";
import { formatQEReport } from "../core/orchestrator/index.js";
import {
  createModelGateway,
  resolveModelTokenLimit,
  resolveModelTpmLimit,
} from "./gateway-factory.js";
import {
  parseRequirementsFile,
  parseInlineRequirements,
} from "./requirements-parser.js";
import type {
  QERequest,
  Requirement,
  ExecutionProfile,
} from "../types/index.js";
import { writeSafeResultOutput } from "./output-path.js";
import { createBrowserCapability } from "./browser-factory.js";

export interface VerifyCommandOptions {
  requirements?: string;
  requirement?: string[];
  repo?: string;
  profile?: string;
  json?: boolean;
  output?: string;
}

export async function runVerify(
  options: VerifyCommandOptions,
  logger: Logger,
): Promise<void> {
  const effectiveLogger = options.json
    ? createLogger("INFO", new StderrLogSink())
    : logger;

  const repoPath = resolve(options.repo ?? process.cwd());

  let config = getDefaultConfig();
  let explicitMaxModelCalls: number | undefined;
  try {
    const loaded = await loadConfig(repoPath);
    config = loaded.config;
    explicitMaxModelCalls = loaded.explicitMaxModelCalls;
  } catch {
    // No config — use defaults
  }

  const requirements: Requirement[] = [];
  if (options.requirements) {
    const parsed = await parseRequirementsFile(resolve(options.requirements));
    requirements.push(...parsed);
  }
  if (options.requirement) {
    requirements.push(...parseInlineRequirements(options.requirement));
  }

  if (requirements.length === 0) {
    effectiveLogger.error(
      "No requirements provided. Use --requirements <file> or --requirement <text>",
    );
    process.exit(1);
  }

  const profile = validateProfile(options.profile ?? config.profile);

  const gateway = createModelGateway(config);

  const orchestrator = new QEOrchestrator({
    gateway,
    logger: effectiveLogger,
    maxModelCalls: explicitMaxModelCalls,
    modelTokenLimit: resolveModelTokenLimit(config),
    tpmLimit: resolveModelTpmLimit(config),
    browserCapability: createBrowserCapability(config),
    browserConfig: {
      enabled: config.browser.enabled,
      baseUrl: config.browser.baseUrl,
      allowedOrigins: config.browser.allowedOrigins,
      headless: config.browser.headless,
    },
    memoryConfig: {
      enabled: config.memory.enabled,
      historySummaries: config.memory.historySummaries,
    },
  });

  const request: QERequest = {
    repositoryPath: repoPath,
    requirements,
    profile,
    mode: "repository",
  };

  const result = await orchestrator.run(request);

  if (options.output) {
    const writeResult = await writeSafeResultOutput(
      repoPath,
      options.output,
      JSON.stringify(result, null, 2),
    );
    if (!writeResult.ok) {
      effectiveLogger.error(writeResult.error);
      process.exit(1);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatQEReport(result));
  }

  if (result.verdict === "FAIL" || result.verdict === "BLOCKED") {
    process.exit(1);
  }
}

function validateProfile(profile: string): ExecutionProfile {
  if (profile === "quick" || profile === "standard" || profile === "deep") {
    return profile;
  }
  throw new Error(
    `Invalid profile '${profile}'. Must be quick, standard, or deep.`,
  );
}
