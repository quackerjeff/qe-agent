import { analyzeRepository } from "../repository/index.js";
import { renderReport } from "../repository/report.js";
import type { Logger } from "../logging/index.js";

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

  if (options.json) {
    console.log(JSON.stringify(profile, null, 2));
  } else {
    console.log(renderReport(profile));
  }
}
