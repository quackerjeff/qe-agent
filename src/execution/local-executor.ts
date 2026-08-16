import { spawn } from "node:child_process";
import { createExecutionId } from "../logging/index.js";
import { redactSecrets, redactArgs } from "./secret-redactor.js";
import { BoundedBuffer } from "./bounded-buffer.js";
import type {
  Executor,
  CommandProposal,
  ExecutionContext,
  ExecutionResult,
  ExecutorType,
} from "./types.js";

const SAFE_ENV_VARS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "HOSTNAME",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "SYSTEMROOT",
  "COMSPEC",
  "WINDIR",
  "PROGRAMFILES",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "XDG_RUNTIME_DIR",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
]);

function buildEnvironment(
  proposal: CommandProposal,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};

  for (const key of SAFE_ENV_VARS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  if (proposal.environment) {
    for (const [key, val] of Object.entries(proposal.environment)) {
      env[key] = val;
    }
  }

  return env;
}

function buildSafeCommand(
  proposal: CommandProposal,
  secrets: string[],
): { executable: string; args: string[]; workingDirectory: string } {
  return {
    executable: redactSecrets(proposal.executable, secrets),
    args: redactArgs(proposal.args, secrets),
    workingDirectory: proposal.workingDirectory,
  };
}

export class LocalExecutor implements Executor {
  readonly type: ExecutorType = "local";

  async available(): Promise<boolean> {
    return true;
  }

  async execute(
    proposal: CommandProposal,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const executionId = createExecutionId();
    const startTime = new Date().toISOString();
    const env = buildEnvironment(proposal);
    const secrets = context.secrets;
    const safeCommand = buildSafeCommand(proposal, secrets);

    return new Promise<ExecutionResult>((resolve) => {
      let child;
      try {
        child = spawn(proposal.executable, proposal.args, {
          cwd: proposal.workingDirectory,
          env: env as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          detached: true,
        });
      } catch (err) {
        const endTime = new Date().toISOString();
        resolve({
          executionId,
          command: safeCommand,
          executor: "local",
          startTime,
          endTime,
          durationMs: 0,
          exitCode: null,
          terminationReason: "SPAWN_FAILED",
          stdout: "",
          stderr: redactSecrets(
            err instanceof Error ? err.message : "Failed to spawn process",
            secrets,
          ),
          timedOut: false,
          policyOutcome: "ALLOWED",
          truncated: { stdout: false, stderr: false },
          secretsRedacted: secrets.length > 0,
          networkPolicy: proposal.network,
          networkPolicyEnforced: false,
          purpose: proposal.purpose,
        });
        return;
      }

      const maxBytes = context.maxOutputBytes;
      const stdoutBuf = new BoundedBuffer(maxBytes);
      const stderrBuf = new BoundedBuffer(maxBytes);
      let timedOut = false;

      child.stdout.on("data", (chunk: Buffer) => stdoutBuf.append(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrBuf.append(chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid) {
            process.kill(-child.pid, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // already dead
          }
        }
      }, proposal.timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        const endTime = new Date().toISOString();
        const start = new Date(startTime).getTime();
        resolve({
          executionId,
          command: safeCommand,
          executor: "local",
          startTime,
          endTime,
          durationMs: new Date(endTime).getTime() - start,
          exitCode: null,
          terminationReason: "SPAWN_FAILED",
          stdout: "",
          stderr: redactSecrets(err.message, secrets),
          timedOut: false,
          policyOutcome: "ALLOWED",
          truncated: { stdout: false, stderr: false },
          secretsRedacted: secrets.length > 0,
          networkPolicy: proposal.network,
          networkPolicyEnforced: false,
          purpose: proposal.purpose,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const endTime = new Date().toISOString();
        const start = new Date(startTime).getTime();

        const stdoutResult = stdoutBuf.finish();
        const stderrResult = stderrBuf.finish();

        let stdout = stdoutResult.text;
        let stderr = stderrResult.text;

        if (secrets.length > 0) {
          stdout = redactSecrets(stdout, secrets);
          stderr = redactSecrets(stderr, secrets);
        }

        resolve({
          executionId,
          command: safeCommand,
          executor: "local",
          startTime,
          endTime,
          durationMs: new Date(endTime).getTime() - start,
          exitCode: code,
          terminationReason: timedOut ? "TIMED_OUT" : "COMPLETED",
          stdout,
          stderr,
          timedOut,
          policyOutcome: "ALLOWED",
          truncated: {
            stdout: stdoutResult.truncated,
            stderr: stderrResult.truncated,
          },
          secretsRedacted: secrets.length > 0,
          networkPolicy: proposal.network,
          networkPolicyEnforced: false,
          purpose: proposal.purpose,
        });
      });
    });
  }
}
