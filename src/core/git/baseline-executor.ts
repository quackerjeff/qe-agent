import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeRepository } from "../../repository/index.js";
import { ExecutionController } from "../../execution/index.js";
import { createExecutionEvidence } from "../../execution/index.js";
import type {
  CommandProposal,
  ExecutionContext,
} from "../../execution/index.js";
import type { Evidence, DiscoveredCommand } from "../../types/index.js";
import type { Logger } from "../../logging/index.js";
import { classifyWithBaseline } from "../reasoning/failure-investigator.js";

const execFileAsync = promisify(execFile);

export interface BaselineComparisonInput {
  repositoryPath: string;
  baselineRef: string;
  failedCommand: {
    executable: string;
    args: string[];
    workingDirectory: string;
    timeoutMs: number;
    purpose: string;
    actionType: string;
  };
  targetEvidence: Evidence;
  targetExitCode: number | null;
}

export interface BaselineComparisonOutput {
  classification: "INTRODUCED" | "PRE_EXISTING" | "UNKNOWN";
  baselineEvidence: Evidence;
  targetEvidenceId: string;
  baselineExitCode: number | null;
  targetExitCode: number | null;
}

export async function executeBaselineComparison(
  input: BaselineComparisonInput,
  controller: ExecutionController,
  logger?: Logger,
): Promise<BaselineComparisonOutput> {
  let worktreePath: string | undefined;

  try {
    worktreePath = await createWorktree(
      input.repositoryPath,
      input.baselineRef,
    );
    logger?.info("Created baseline worktree", {
      path: worktreePath,
      ref: input.baselineRef,
    });

    const baselineProfile = await analyzeRepository({
      targetPath: worktreePath,
    });

    const equivalentCmd = findEquivalentCommand(
      baselineProfile.commands,
      input.failedCommand,
    );

    if (!equivalentCmd) {
      logger?.info("No equivalent baseline command found", {
        original: `${input.failedCommand.executable} ${input.failedCommand.args.join(" ")}`,
      });

      const unknownEvidence: Evidence = {
        id: `ev-baseline-unavailable-${Date.now()}`,
        type: "COMMAND_RESULT",
        provenance: "not_verified",
        timestamp: new Date().toISOString(),
        source: "baseline-comparison",
        status: "INCONCLUSIVE",
        summary: `Baseline command not available at ${input.baselineRef}`,
      };

      return {
        classification: "UNKNOWN",
        baselineEvidence: unknownEvidence,
        targetEvidenceId: input.targetEvidence.id,
        baselineExitCode: null,
        targetExitCode: input.targetExitCode,
      };
    }

    const proposal: CommandProposal = {
      executable: equivalentCmd.executable!,
      args: equivalentCmd.args ?? [],
      workingDirectory: worktreePath,
      timeoutMs: input.failedCommand.timeoutMs,
      purpose: `Baseline comparison: ${input.failedCommand.purpose}`,
      mutability: "READ_ONLY",
      network: "ALLOWED",
    };

    const execCtx: ExecutionContext = {
      repositoryRoot: worktreePath,
      executionMode: "local",
      secrets: [],
      maxOutputBytes: 1_048_576,
    };

    const { result: baseResult, evidence: rawEvidence } =
      await controller.execute(proposal, execCtx);

    const categoryMap: Record<string, string> = {
      BUILD: "BUILD",
      TEST: "TEST",
      LINT: "LINT",
      TYPECHECK: "TYPECHECK",
      STATIC_ANALYSIS: "STATIC_ANALYSIS",
    };
    const cat = categoryMap[input.failedCommand.actionType];
    const baselineEvidence = cat
      ? createExecutionEvidence(baseResult, cat)
      : rawEvidence;

    const baselineStatus = baseResult.exitCode === 0 ? "PASS" : "FAIL";
    const targetStatus = input.targetExitCode === 0 ? "PASS" : "FAIL";
    const comparison = classifyWithBaseline(
      baselineStatus as "PASS" | "FAIL",
      targetStatus as "PASS" | "FAIL",
    );

    return {
      classification: comparison.classification as
        "INTRODUCED" | "PRE_EXISTING" | "UNKNOWN",
      baselineEvidence,
      targetEvidenceId: input.targetEvidence.id,
      baselineExitCode: baseResult.exitCode,
      targetExitCode: input.targetExitCode,
    };
  } finally {
    if (worktreePath) {
      await cleanupWorktree(input.repositoryPath, worktreePath, logger);
    }
  }
}

export async function createWorktree(
  repositoryPath: string,
  ref: string,
): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "qe-baseline-"));

  await execFileAsync("git", ["worktree", "add", "--detach", tempDir, ref], {
    cwd: repositoryPath,
    timeout: 30_000,
  });

  return tempDir;
}

export async function cleanupWorktree(
  repositoryPath: string,
  worktreePath: string,
  logger?: Logger,
): Promise<void> {
  try {
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", worktreePath],
      {
        cwd: repositoryPath,
        timeout: 15_000,
      },
    );
  } catch {
    logger?.warn("Failed to remove worktree via git, cleaning up directory", {
      path: worktreePath,
    });
    try {
      await rm(worktreePath, { recursive: true, force: true });
      await execFileAsync("git", ["worktree", "prune"], {
        cwd: repositoryPath,
        timeout: 15_000,
      });
    } catch {
      logger?.warn("Failed to clean up worktree directory", {
        path: worktreePath,
      });
    }
  }
}

function findEquivalentCommand(
  baselineCommands: DiscoveredCommand[],
  failedCommand: {
    executable: string;
    args: string[];
  },
): DiscoveredCommand | undefined {
  return baselineCommands.find(
    (cmd) =>
      cmd.executionSupport === "STRUCTURED" &&
      cmd.executable === failedCommand.executable &&
      arraysEqual(cmd.args ?? [], failedCommand.args),
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
