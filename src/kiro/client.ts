import { spawn } from "node:child_process";
import type {
  KiroPromptRequest,
  KiroPromptResponse,
  KiroContext,
} from "./types.js";
import {
  KIRO_EXIT_SUCCESS,
  KIRO_EXIT_MCP_STARTUP_FAILURE,
  KIRO_EXIT_FAILURE,
} from "./types.js";

export interface KiroClient {
  runPrompt(request: KiroPromptRequest): Promise<KiroPromptResponse>;
}

export class KiroCliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "KiroCliError";
  }
}

/**
 * Build the argv for a headless Kiro CLI run per the documented flags
 * (https://kiro.dev/docs/cli/headless/):
 *   kiro-cli chat --no-interactive [--trust-tools=a,b | --trust-all-tools]
 *                 [--resume-id <id>] [--agent <name>] [--require-mcp-startup]
 *                 [--output-format stream-json] "<prompt>"
 * Exported as a pure function for deterministic testing of flag construction.
 */
export function buildKiroChatArgs(request: KiroPromptRequest): {
  cmd: string;
  args: string[];
} {
  const ctx: KiroContext = request.context;
  const args: string[] = ["chat", "--no-interactive"];

  if (ctx.trustAllTools) {
    args.push("--trust-all-tools");
  } else if (ctx.trustTools && ctx.trustTools.length > 0) {
    args.push(`--trust-tools=${ctx.trustTools.join(",")}`);
  }

  if (ctx.sessionId) args.push("--resume-id", ctx.sessionId);
  if (ctx.agent) args.push("--agent", ctx.agent);
  if (ctx.requireMcpStartup) args.push("--require-mcp-startup");

  args.push("--output-format", "stream-json");
  args.push(request.prompt);
  return { cmd: ctx.executable, args };
}

/** Runs the real Kiro CLI as a child process (headless mode). */
export class SpawnKiroClient implements KiroClient {
  constructor(private readonly defaultTimeoutMs = 600_000) {}

  async runPrompt(request: KiroPromptRequest): Promise<KiroPromptResponse> {
    const { cmd, args } = buildKiroChatArgs(request);
    const timeoutMs = request.context.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
      }, timeoutMs);

      proc.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
      proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(new KiroCliError(err.message, KIRO_EXIT_FAILURE));
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (killed) {
          reject(
            new KiroCliError(
              `Kiro CLI timed out after ${timeoutMs}ms`,
              KIRO_EXIT_FAILURE,
            ),
          );
          return;
        }
        const exitCode = code ?? KIRO_EXIT_FAILURE;
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          exitCode,
          // Exit 3 (MCP startup failure, --require-mcp-startup) is a
          // documented distinct outcome; the delivery itself completed.
          ok:
            exitCode === KIRO_EXIT_SUCCESS ||
            exitCode === KIRO_EXIT_MCP_STARTUP_FAILURE,
        });
      });
    });
  }
}
