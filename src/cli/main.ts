#!/usr/bin/env node

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createLogger } from "../logging/index.js";
import { runInit } from "./init.js";
import { runAnalyze } from "./analyze.js";

async function getVersion(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkgPath = join(__dirname, "..", "..", "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const version = await getVersion();
  const program = new Command();

  program
    .name("qe")
    .description("QE Agent — Autonomous Quality Engineering")
    .version(version);

  program
    .command("init")
    .description("Initialize QE configuration for the current repository")
    .action(async () => {
      const logger = createLogger("INFO");
      try {
        await runInit(process.cwd(), logger);
      } catch (err) {
        logger.error(
          err instanceof Error ? err.message : "Initialization failed",
        );
        process.exit(1);
      }
    });

  program
    .command("analyze")
    .description("Analyze repository structure and QE capabilities")
    .option("--repo <path>", "Path to repository (default: current directory)")
    .option("--json", "Output analysis as JSON")
    .action(async (opts) => {
      const logger = createLogger("INFO");
      try {
        await runAnalyze(opts, logger);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : "Analysis failed");
        process.exit(1);
      }
    });

  program
    .command("test")
    .description("Execute repository quality validation")
    .action(() => {
      console.error("qe test: not yet implemented");
      process.exit(1);
    });

  program
    .command("verify")
    .description("Validate requirements against the current repository")
    .action(() => {
      console.error("qe verify: not yet implemented");
      process.exit(1);
    });

  program
    .command("review")
    .description("Evaluate changes against a baseline revision")
    .action(() => {
      console.error("qe review: not yet implemented");
      process.exit(1);
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
