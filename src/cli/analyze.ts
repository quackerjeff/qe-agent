import { analyzeRepository } from "../repository/index.js";
import { renderReport } from "../repository/report.js";
import type { Logger } from "../logging/index.js";
import type { AIUsageTelemetry, AnalysisResult } from "../types/index.js";

export const ZERO_AI_USAGE: AIUsageTelemetry = {
  modelCalls: 0,
  successfulModelCalls: 0,
  failedModelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  limitStatus: "OK",
};

export interface AnalyzeCommandOptions {
  repo?: string;
  json?: boolean;
}

export async function runAnalyze(
  options: AnalyzeCommandOptions,
  logger: Logger,
): Promise<void> {
  const targetPath = options.repo ?? process.cwd();

  if (!options.json) {
    logger.info(`Analyzing repository at ${targetPath}...`);
  } else {
    process.stderr.write(`Analyzing repository at ${targetPath}...\n`);
  }

  const profile = await analyzeRepository({ targetPath });

  const result: AnalysisResult = {
    repositoryProfile: profile,
    aiUsage: ZERO_AI_USAGE,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const report = renderReport(profile);
    console.log(report);
    console.log("AI Usage");
    console.log("--------");
    console.log("No model calls (static analysis only)");
    console.log("");
  }
}
