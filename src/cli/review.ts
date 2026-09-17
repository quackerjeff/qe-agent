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
  QEResult,
  Requirement,
  ExecutionProfile,
} from "../types/index.js";
import { persistResult } from "../github/reporter.js";
import { getCiExitCode } from "../github/verdict.js";
import type { Verdict } from "../types/domain.js";
import { writeSafeResultOutput } from "./output-path.js";
import { createBrowserCapability } from "./browser-factory.js";

export interface ReviewCommandOptions {
  base?: string;
  target?: string;
  requirements?: string;
  requirement?: string[];
  repo?: string;
  profile?: string;
  json?: boolean;
  output?: string;
  ci?: boolean;
}

export async function runReview(
  options: ReviewCommandOptions,
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

  if (!options.base) {
    effectiveLogger.error("--base <ref> is required for change review");
    process.exit(1);
  }

  try {
    const { execFile: execFileCb } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFileCb);
    await execFileAsync("git", ["rev-parse", "--verify", options.base], {
      cwd: repoPath,
      timeout: 10_000,
    });
  } catch {
    const blockedResult: QEResult = {
      executionId: `blocked-${Date.now()}`,
      repository: {
        path: repoPath,
        name: repoPath.split("/").pop() ?? "repo",
      },
      target: options.target ?? "HEAD",
      profile: (options.profile ?? "standard") as ExecutionProfile,
      repositoryProfile: {
        root: repoPath,
        git: { detected: true },
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildSystems: [],
        testFrameworks: [],
        ciSystems: [],
        applications: [],
        documentation: [],
        commands: [],
        capabilities: [],
        confidence: 0,
      },
      riskAssessment: {
        level: "MEDIUM",
        factors: [],
        confidence: 0,
        summary: "Unable to assess — baseline unavailable",
      },
      validationPlan: {
        objectives: [],
        plannedActions: [],
        identifiedRisks: [],
        expectedCapabilities: [],
      },
      evidence: [],
      findings: [],
      requirements: [],
      remainingGaps: [
        {
          area: "baseline-comparison",
          description: `Baseline revision ${options.base} is not available locally`,
          reason:
            "Shallow clone or missing history prevents baseline comparison",
          risk: "CRITICAL" as const,
        },
      ],
      verdict: "BLOCKED",
      confidence: "HIGH",
      summary: `Baseline revision ${options.base} is not available locally — cannot perform change comparison`,
      recommendedNextActions: [
        "Fetch the required baseline history: git fetch origin <sha>",
        "Or use a full clone instead of a shallow clone",
      ],
      metrics: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 0,
        modelCalls: 0,
        commandsExecuted: 0,
        testsExecuted: 0,
        testsGenerated: 0,
        retries: 0,
        stateTransitions: 0,
      },
    };

    if (options.output) {
      const writeResult = await writeSafeResultOutput(
        repoPath,
        options.output,
        JSON.stringify(blockedResult, null, 2),
      );
      if (!writeResult.ok) {
        effectiveLogger.error(writeResult.error);
        process.exit(1);
      }
    }

    if (options.json) {
      console.log(JSON.stringify(blockedResult, null, 2));
    } else {
      console.log(formatQEReport(blockedResult));
    }

    process.exit(1);
  }

  const requirements: Requirement[] = [];
  if (options.requirements) {
    const parsed = await parseRequirementsFile(resolve(options.requirements));
    requirements.push(...parsed);
  }
  if (options.requirement) {
    requirements.push(...parseInlineRequirements(options.requirement));
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
    requirements: requirements.length > 0 ? requirements : undefined,
    baselineRef: options.base,
    targetRef: options.target,
    profile,
    mode: "change",
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
  } else if (options.ci) {
    await persistResult(result, repoPath);
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatQEReport(result));
  }

  if (options.ci) {
    const failOn = config.ci?.failOn ?? (["FAIL", "BLOCKED"] as Verdict[]);
    process.exit(getCiExitCode(result.verdict, failOn));
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
