#!/usr/bin/env node

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createLogger } from "../logging/index.js";
import { runInit } from "./init.js";
import { runAnalyze } from "./analyze.js";
import { runExec } from "./exec.js";
import { runVerify } from "./verify.js";
import { runReview } from "./review.js";
import { runGitHubPublish } from "./github-publish.js";
import { runOpenCodePublish } from "./opencode-publish.js";
import { runKiroPublish } from "./kiro-publish.js";

/**
 * Load a git-ignored .env file (KEY=VALUE lines) from the repository root
 * so that addresses, keys, and model names never need to be committed
 * (see AGENTS.md security rules). Existing environment variables always
 * take precedence. No dependency — plain parsing of simple KEY=VALUE lines.
 */
async function loadLocalEnv(): Promise<void> {
  const cwd = process.cwd();
  const envPath = join(cwd, ".env");
  try {
    const text = await readFile(envPath, "utf-8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // No .env file — nothing to do
  }
}

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
  await loadLocalEnv();
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
    .command("exec")
    .description("Execute a command through the Execution Controller")
    .option("--command <executable>", "Executable to run")
    .option("--arg <arg...>", "Arguments to pass")
    .option("--command-id <id>", "Run a discovered command by ID")
    .option("--secret <value...>", "Secret values to redact from output")
    .option("--env <KEY=VALUE...>", "Environment variables for the command")
    .option("--repo <path>", "Repository path (default: cwd)")
    .option("--timeout <seconds>", "Command timeout in seconds")
    .option("--mode <mode>", "Execution mode: local, docker, auto")
    .option("--json", "Output result as JSON")
    .action(async (opts) => {
      const logger = createLogger("INFO");
      try {
        await runExec(opts, logger);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : "Execution failed");
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
    .description("Run QE reasoning against supplied requirements")
    .option("--requirements <file>", "Requirements file (Markdown)")
    .option("--requirement <text...>", "Inline requirement(s)")
    .option("--repo <path>", "Repository path (default: cwd)")
    .option("--profile <profile>", "Execution profile: quick, standard, deep")
    .option("--json", "Output result as JSON")
    .option("--output <path>", "Write QE result JSON to file")
    .action(async (opts) => {
      const logger = createLogger("INFO");
      try {
        await runVerify(opts, logger);
      } catch (err) {
        logger.error(
          err instanceof Error ? err.message : "Verification failed",
        );
        process.exit(1);
      }
    });

  program
    .command("review")
    .description("Run QE reasoning against a Git baseline")
    .option("--base <ref>", "Baseline Git ref (required)")
    .option("--target <ref>", "Target Git ref (default: HEAD)")
    .option("--requirements <file>", "Requirements file (Markdown)")
    .option("--requirement <text...>", "Inline requirement(s)")
    .option("--repo <path>", "Repository path (default: cwd)")
    .option("--profile <profile>", "Execution profile: quick, standard, deep")
    .option("--json", "Output result as JSON")
    .option("--output <path>", "Write QE result JSON to file")
    .option("--ci", "CI mode: persist result and use configured exit codes")
    .action(async (opts) => {
      const logger = createLogger("INFO");
      try {
        await runReview(opts, logger);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : "Review failed");
        process.exit(1);
      }
    });

  const github = program
    .command("github")
    .description("GitHub integration commands");

  github
    .command("publish")
    .description("Publish QE result to GitHub")
    .requiredOption("--result <path>", "Path to QE result JSON file")
    .option("--repo <path>", "Repository path (default: cwd)")
    .option("--dry-run", "Preview publishing without remote writes")
    .option("--json", "Output publishing result as JSON")
    .action(async (opts) => {
      const logger = createLogger("INFO");
      try {
        await runGitHubPublish(opts, logger);
      } catch (err) {
        logger.error(
          err instanceof Error ? err.message : "GitHub publish failed",
        );
        process.exit(1);
      }
    });

  const opencode = program
    .command("opencode")
    .description("OpenCode harness integration commands");

  opencode
    .command("publish")
    .description("Publish QE result to an OpenCode session")
    .requiredOption("--result <path>", "Path to QE result JSON file")
    .option("--repo <path>", "Repository path (default: cwd)")
    .option("--session <id>", "OpenCode session ID to deliver into")
    .option("--dry-run", "Preview delivery without sending")
    .option("--json", "Output publishing result as JSON")
    .action(async (opts) => {
      const logger = createLogger("INFO");
      try {
        await runOpenCodePublish(opts, logger);
      } catch (err) {
        logger.error(
          err instanceof Error ? err.message : "OpenCode publish failed",
        );
        process.exit(1);
      }
    });

  const kiro = program
    .command("kiro")
    .description("Kiro harness integration commands");

  kiro
    .command("publish")
    .description("Publish QE result to Kiro via a headless CLI run")
    .requiredOption("--result <path>", "Path to QE result JSON file")
    .option("--repo <path>", "Repository path (default: cwd)")
    .option("--session <id>", "Kiro session ID to resume")
    .option("--agent <name>", "Kiro agent profile to use")
    .option(
      "--trust-all-tools",
      "Let the Kiro agent act on the verdict (auto-approve tools)",
    )
    .option("--timeout <ms>", "Kiro CLI run timeout in milliseconds")
    .option("--dry-run", "Preview delivery without running Kiro CLI")
    .option("--json", "Output publishing result as JSON")
    .action(async (opts) => {
      const logger = createLogger("INFO");
      try {
        await runKiroPublish(
          {
            ...opts,
            timeoutMs: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
          },
          logger,
        );
      } catch (err) {
        logger.error(
          err instanceof Error ? err.message : "Kiro publish failed",
        );
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
