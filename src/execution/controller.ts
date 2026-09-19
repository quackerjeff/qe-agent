import { createExecutionId } from "../logging/index.js";
import type { Evidence } from "../types/index.js";
import type { Logger } from "../logging/index.js";
import { evaluatePolicy } from "./policy.js";
import {
  spawnManagedProcess,
  type ManagedProcessHandle,
} from "./managed-process.js";
import { createExecutionEvidence } from "./evidence-factory.js";
import { redactSecrets, redactArgs } from "./secret-redactor.js";
import type { EvidenceStore } from "./evidence-store.js";
import { InMemoryEvidenceStore } from "./evidence-store.js";
import { LocalExecutor } from "./local-executor.js";
import { DockerExecutor } from "./docker-executor.js";
import type {
  CommandProposal,
  ExecutionContext,
  ExecutionResult,
  ExecutionMode,
  Executor,
} from "./types.js";

export interface ExecutionControllerOptions {
  evidenceStore?: EvidenceStore;
  logger?: Logger;
}

export class ExecutionController {
  private readonly localExecutor = new LocalExecutor();
  private readonly dockerExecutor = new DockerExecutor();
  private readonly evidenceStore: EvidenceStore;
  private readonly logger?: Logger;

  constructor(options?: ExecutionControllerOptions) {
    this.evidenceStore = options?.evidenceStore ?? new InMemoryEvidenceStore();
    this.logger = options?.logger;
  }

  async execute(
    proposal: CommandProposal,
    context: ExecutionContext,
  ): Promise<{ result: ExecutionResult; evidence: Evidence }> {
    const secrets = context.secrets;
    const safeExec = redactSecrets(proposal.executable, secrets);
    const safeArgs = redactArgs(proposal.args, secrets);

    this.logger?.info(`Executing: ${safeExec} ${safeArgs.join(" ")}`, {
      purpose: proposal.purpose,
      executor: context.executionMode,
    });

    const policyResult = evaluatePolicy(proposal, context.repositoryRoot);

    if (policyResult.outcome !== "ALLOWED") {
      this.logger?.warn(
        `Policy denied: ${redactSecrets(policyResult.reason, secrets)}`,
      );

      const result = createDeniedResult(proposal, policyResult.reason, secrets);
      const evidence = createExecutionEvidence(result);
      await this.evidenceStore.add(evidence);

      return { result, evidence };
    }

    const executor = await this.selectExecutor(context.executionMode);

    if (!executor) {
      this.logger?.warn(
        "Docker execution mode selected but Docker is not available",
      );

      const result = createUnavailableResult(proposal, secrets);
      const evidence = createExecutionEvidence(result);
      await this.evidenceStore.add(evidence);

      return { result, evidence };
    }

    this.logger?.debug(`Using ${executor.type} executor`, {
      executionMode: context.executionMode,
    });

    const result = await executor.execute(proposal, context);

    this.logger?.info(
      `Completed: exit=${result.exitCode} duration=${result.durationMs}ms reason=${result.terminationReason}`,
      { executionId: result.executionId },
    );

    const evidence = createExecutionEvidence(result);
    await this.evidenceStore.add(evidence);

    return { result, evidence };
  }

  /**
   * Spawn a managed long-lived process (e.g. the Playwright MCP
   * server) through the canonical Execution Controller.
   *
   * This is the managed counterpart to execute(): the same command
   * policy, filtered environment, bounded output, and process-group
   * lifecycle enforcement apply — implemented once in
   * `spawnManagedProcess` beneath both paths so policy cannot drift.
   * Denials are recorded as evidence and surfaced as thrown errors
   * (fail closed); the caller owns the returned handle and must
   * terminate it via `killTree()` (see McpPlaywrightAdapter.cleanup).
   */
  async spawnManaged(
    proposal: CommandProposal,
    context: ExecutionContext,
  ): Promise<ManagedProcessHandle> {
    const secrets = context.secrets;
    const safeExec = redactSecrets(proposal.executable, secrets);
    const safeArgs = redactArgs(proposal.args, secrets);

    this.logger?.info(
      `Spawning managed process: ${safeExec} ${safeArgs.join(" ")}`,
      {
        purpose: proposal.purpose,
      },
    );

    let handle: ManagedProcessHandle;
    try {
      handle = spawnManagedProcess(proposal, context);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger?.warn(
        `Managed process denied/failed: ${redactSecrets(reason, secrets)}`,
      );
      const result = createDeniedResult(proposal, reason, secrets);
      const evidence = createExecutionEvidence(result);
      await this.evidenceStore.add(evidence);
      throw err;
    }

    this.logger?.debug(`Managed process started (pid=${handle.proc.pid})`, {
      purpose: proposal.purpose,
    });

    return handle;
  }

  getEvidenceStore(): EvidenceStore {
    return this.evidenceStore;
  }

  private async selectExecutor(mode: ExecutionMode): Promise<Executor | null> {
    switch (mode) {
      case "local":
        return this.localExecutor;
      case "docker": {
        const available = await this.dockerExecutor.available();
        if (!available) return null;
        return this.dockerExecutor;
      }
      case "auto": {
        const dockerAvailable = await this.dockerExecutor.available();
        return dockerAvailable ? this.dockerExecutor : this.localExecutor;
      }
    }
  }
}

function createDeniedResult(
  proposal: CommandProposal,
  reason: string,
  secrets: string[],
): ExecutionResult {
  const now = new Date().toISOString();
  return {
    executionId: createExecutionId(),
    command: {
      executable: redactSecrets(proposal.executable, secrets),
      args: redactArgs(proposal.args, secrets),
      workingDirectory: proposal.workingDirectory,
    },
    executor: "local",
    startTime: now,
    endTime: now,
    durationMs: 0,
    exitCode: null,
    terminationReason: "POLICY_DENIED",
    stdout: "",
    stderr: redactSecrets(`Policy denied: ${reason}`, secrets),
    timedOut: false,
    policyOutcome: "DENIED",
    truncated: { stdout: false, stderr: false },
    secretsRedacted: secrets.length > 0,
    networkPolicy: proposal.network,
    networkPolicyEnforced: false,
    purpose: proposal.purpose,
  };
}

function createUnavailableResult(
  proposal: CommandProposal,
  secrets: string[],
): ExecutionResult {
  const now = new Date().toISOString();
  return {
    executionId: createExecutionId(),
    command: {
      executable: redactSecrets(proposal.executable, secrets),
      args: redactArgs(proposal.args, secrets),
      workingDirectory: proposal.workingDirectory,
    },
    executor: "docker",
    startTime: now,
    endTime: now,
    durationMs: 0,
    exitCode: null,
    terminationReason: "SPAWN_FAILED",
    stdout: "",
    stderr: "Docker execution mode selected but Docker is not available",
    timedOut: false,
    policyOutcome: "ALLOWED",
    truncated: { stdout: false, stderr: false },
    secretsRedacted: secrets.length > 0,
    networkPolicy: proposal.network,
    networkPolicyEnforced: false,
    purpose: proposal.purpose,
  };
}
