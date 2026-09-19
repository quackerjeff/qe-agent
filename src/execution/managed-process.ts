import { spawn, type ChildProcess } from "node:child_process";
import { evaluatePolicy } from "./policy.js";
import { buildSafeEnvironment } from "./safe-env.js";
import { redactSecrets, redactArgs } from "./secret-redactor.js";
import { BoundedBuffer } from "./bounded-buffer.js";
import type {
  CommandProposal,
  ExecutionContext,
  PolicyResult,
} from "./types.js";

export class ManagedProcessDeniedError extends Error {
  readonly policyResult: PolicyResult;

  constructor(policyResult: PolicyResult, secrets: string[]) {
    super(
      `Policy denied managed process: ${redactSecrets(policyResult.reason, secrets)}`,
    );
    this.name = "ManagedProcessDeniedError";
    this.policyResult = policyResult;
  }
}

export interface ManagedProcessHandle {
  /** The spawned child process (detached process group leader). */
  proc: ChildProcess;
  /** Bounded tail of captured stderr for diagnostics. */
  stderrTail: () => string;
  /** SIGTERM the process group, then SIGKILL after a grace period. */
  killTree: (graceMs?: number) => Promise<void>;
}

/**
 * Canonical managed/long-lived process spawner shared by the
 * Execution Controller and every managed execution consumer.
 *
 * Enforcement order matches one-shot execution:
 * 1. command policy (evaluatePolicy — executable, working directory,
 *    timeout, mutability/network);
 * 2. filtered environment (shared allowlist);
 * 3. detached spawn (own process group) with bounded stderr capture.
 *
 * Lifecycle termination is owned by the returned handle's killTree,
 * which signals the entire process group — not just the leader.
 */
export function spawnManagedProcess(
  proposal: CommandProposal,
  context: ExecutionContext,
  options?: { maxStderrBytes?: number },
): ManagedProcessHandle {
  const policyResult = evaluatePolicy(proposal, context.repositoryRoot);
  if (policyResult.outcome !== "ALLOWED") {
    throw new ManagedProcessDeniedError(policyResult, context.secrets);
  }

  const safeExec = redactSecrets(proposal.executable, context.secrets);
  const safeArgs = redactArgs(proposal.args, context.secrets);

  let proc: ChildProcess;
  try {
    proc = spawn(proposal.executable, proposal.args, {
      cwd: proposal.workingDirectory,
      env: buildSafeEnvironment(proposal),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: true,
    });
  } catch (err) {
    throw new Error(
      `Failed to spawn managed process '${safeExec} ${safeArgs.join(" ")}': ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const maxBytes = options?.maxStderrBytes ?? context.maxOutputBytes;
  const stderrBuf = new BoundedBuffer(maxBytes);
  proc.stderr?.on("data", (chunk: Buffer) => stderrBuf.append(chunk));

  return {
    proc,
    stderrTail: () => stderrBuf.finish().text,
    killTree: (graceMs = 2000) => killProcessTree(proc, graceMs),
  };
}

/** Terminate a process tree: SIGTERM the group, then SIGKILL. */
export async function killProcessTree(
  proc: ChildProcess,
  graceMs = 2000,
): Promise<void> {
  if (!proc.pid) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already dead
    }
    return;
  }
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => {
      proc.once("exit", () => resolve(true));
    }),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), graceMs),
    ),
  ]);
  if (!exited) {
    try {
      if (proc.pid) process.kill(-proc.pid, "SIGKILL");
      else proc.kill("SIGKILL");
    } catch {
      // already dead
    }
  }
}
