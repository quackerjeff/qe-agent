import { resolve } from "node:path";
import type { Logger } from "../logging/index.js";
import { createLogger, StderrLogSink } from "../logging/index.js";
import { loadConfig, getDefaultConfig } from "../config/index.js";
import { ExecutionController } from "../execution/index.js";
import { analyzeRepository } from "../repository/index.js";
import type { CommandProposal, ExecutionContext } from "../execution/index.js";

export interface ExecCommandOptions {
  command?: string;
  arg?: string[];
  commandId?: string;
  secret?: string[];
  env?: string[];
  repo?: string;
  timeout?: string;
  mode?: string;
  json?: boolean;
}

export async function runExec(
  options: ExecCommandOptions,
  logger: Logger,
): Promise<void> {
  const effectiveLogger = options.json
    ? createLogger("INFO", new StderrLogSink())
    : logger;

  const repoPath = resolve(options.repo ?? process.cwd());

  let config = getDefaultConfig();
  try {
    const loaded = await loadConfig(repoPath);
    config = loaded.config;
  } catch {
    // No config file or invalid — use defaults
  }

  const executionMode = validateMode(options.mode ?? config.execution.mode);
  const timeoutMs = options.timeout
    ? parseInt(options.timeout, 10) * 1000
    : config.execution.commandTimeoutSeconds * 1000;
  const maxOutputBytes = config.execution.maxOutputBytes;

  const environment: Record<string, string> = {};
  if (options.env) {
    for (const entry of options.env) {
      const eqIdx = entry.indexOf("=");
      if (eqIdx > 0) {
        environment[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
      }
    }
  }

  let proposal: CommandProposal;

  if (options.commandId) {
    const profile = await analyzeRepository({
      targetPath: repoPath,
      pathSource: options.repo ? "explicit" : "inferred",
    });
    const discovered = profile.commands.find((c) => c.id === options.commandId);
    if (!discovered) {
      effectiveLogger.error(`Command ID '${options.commandId}' not found`);
      effectiveLogger.info(
        `Available: ${profile.commands.map((c) => c.id).join(", ")}`,
      );
      process.exit(1);
    }

    if (discovered.executionSupport !== "STRUCTURED") {
      effectiveLogger.error(
        `Command '${discovered.id}' is DISCOVERED_ONLY and cannot be safely executed. Use --command and --arg to supply a structured command.`,
      );
      process.exit(1);
    }

    if (!discovered.executable) {
      effectiveLogger.error(
        `Command '${discovered.id}' has no structured executable. Use --command and --arg instead.`,
      );
      process.exit(1);
    }

    proposal = {
      executable: discovered.executable,
      args: discovered.args ?? [],
      workingDirectory: profile.root,
      timeoutMs,
      purpose: `Execute discovered command: ${discovered.name}`,
      mutability: "READ_ONLY",
      network: "ALLOWED",
      environment:
        Object.keys(environment).length > 0 ? environment : undefined,
    };
  } else if (options.command) {
    proposal = {
      executable: options.command,
      args: options.arg ?? [],
      workingDirectory: repoPath,
      timeoutMs,
      purpose: `Manual execution: ${options.command}`,
      mutability: "READ_ONLY",
      network: "ALLOWED",
      environment:
        Object.keys(environment).length > 0 ? environment : undefined,
    };
  } else {
    effectiveLogger.error("Provide --command or --command-id");
    process.exit(1);
  }

  const context: ExecutionContext = {
    repositoryRoot: repoPath,
    executionMode,
    secrets: options.secret ?? [],
    maxOutputBytes,
  };

  const controller = new ExecutionController({ logger: effectiveLogger });
  const { result, evidence } = await controller.execute(proposal, context);

  if (options.json) {
    console.log(JSON.stringify({ result, evidence }, null, 2));
  } else {
    console.log(`Execution ID: ${result.executionId}`);
    console.log(
      `Command:      ${result.command.executable} ${result.command.args.join(" ")}`,
    );
    console.log(`Executor:     ${result.executor}`);
    console.log(`Exit Code:    ${result.exitCode}`);
    console.log(`Duration:     ${result.durationMs}ms`);
    console.log(`Termination:  ${result.terminationReason}`);
    console.log(`Evidence:     ${evidence.id} (${evidence.status})`);
    if (result.stdout) {
      console.log(`\n--- stdout ---\n${result.stdout}`);
    }
    if (result.stderr) {
      console.log(`\n--- stderr ---\n${result.stderr}`);
    }
  }

  if (result.exitCode !== 0 && result.terminationReason === "COMPLETED") {
    process.exit(result.exitCode ?? 1);
  }
  if (result.terminationReason !== "COMPLETED") {
    process.exit(1);
  }
}

function validateMode(mode: string): "local" | "docker" | "auto" {
  if (mode === "local" || mode === "docker" || mode === "auto") return mode;
  throw new Error(
    `Invalid execution mode '${mode}'. Must be local, docker, or auto.`,
  );
}
