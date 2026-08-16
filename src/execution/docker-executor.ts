import { execFile, spawn } from "node:child_process";
import { relative } from "node:path";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);
const DEFAULT_IMAGE = "node:20-slim";

export class DockerExecutor implements Executor {
  readonly type: ExecutorType = "docker";

  async available(): Promise<boolean> {
    try {
      await execFileAsync("docker", ["info"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async execute(
    proposal: CommandProposal,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const executionId = createExecutionId();
    const startTime = new Date().toISOString();
    const image = context.dockerImage ?? DEFAULT_IMAGE;
    const secrets = context.secrets;

    const isAvailable = await this.available();
    if (!isAvailable) {
      const endTime = new Date().toISOString();
      return {
        executionId,
        command: {
          executable: redactSecrets(proposal.executable, secrets),
          args: redactArgs(proposal.args, secrets),
          workingDirectory: proposal.workingDirectory,
        },
        executor: "docker",
        startTime,
        endTime,
        durationMs: 0,
        exitCode: null,
        terminationReason: "SPAWN_FAILED",
        stdout: "",
        stderr: "Docker is not available",
        timedOut: false,
        policyOutcome: "ALLOWED",
        truncated: { stdout: false, stderr: false },
        secretsRedacted: secrets.length > 0,
        networkPolicy: proposal.network,
        networkPolicyEnforced: false,
        purpose: proposal.purpose,
      };
    }

    const containerWorkdir = computeContainerWorkdir(
      proposal.workingDirectory,
      context.repositoryRoot,
    );

    const dockerArgs = [
      "run",
      "--rm",
      "-w",
      containerWorkdir,
      "-v",
      `${context.repositoryRoot}:/workspace:ro`,
    ];

    if (proposal.network === "NONE") {
      dockerArgs.push("--network", "none");
    }

    if (proposal.environment) {
      for (const [key, val] of Object.entries(proposal.environment)) {
        dockerArgs.push("-e", `${key}=${val}`);
      }
    }

    dockerArgs.push(image, proposal.executable, ...proposal.args);

    const safeCommand = {
      executable: redactSecrets(proposal.executable, secrets),
      args: redactArgs(proposal.args, secrets),
      workingDirectory: proposal.workingDirectory,
    };

    return new Promise<ExecutionResult>((resolve) => {
      const child = spawn("docker", dockerArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      const maxBytes = context.maxOutputBytes;
      const stdoutBuf = new BoundedBuffer(maxBytes);
      const stderrBuf = new BoundedBuffer(maxBytes);
      let timedOut = false;

      child.stdout.on("data", (chunk: Buffer) => stdoutBuf.append(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrBuf.append(chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // already dead
            }
          }, 2000);
        } catch {
          // already exited
        }
      }, proposal.timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        const endTime = new Date().toISOString();
        resolve({
          executionId,
          command: safeCommand,
          executor: "docker",
          startTime,
          endTime,
          durationMs:
            new Date(endTime).getTime() - new Date(startTime).getTime(),
          exitCode: null,
          terminationReason: "SPAWN_FAILED",
          stdout: "",
          stderr: redactSecrets(err.message, secrets),
          timedOut: false,
          policyOutcome: "ALLOWED",
          truncated: { stdout: false, stderr: false },
          secretsRedacted: secrets.length > 0,
          networkPolicy: proposal.network,
          networkPolicyEnforced: proposal.network === "NONE",
          purpose: proposal.purpose,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const endTime = new Date().toISOString();

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
          executor: "docker",
          startTime,
          endTime,
          durationMs:
            new Date(endTime).getTime() - new Date(startTime).getTime(),
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
          networkPolicyEnforced: proposal.network === "NONE",
          purpose: proposal.purpose,
        });
      });
    });
  }
}

export function computeContainerWorkdir(
  workingDirectory: string,
  repositoryRoot: string,
): string {
  const rel = relative(repositoryRoot, workingDirectory);
  if (!rel || rel === ".") return "/workspace";
  return `/workspace/${rel}`;
}
