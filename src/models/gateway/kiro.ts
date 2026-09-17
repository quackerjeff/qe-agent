import { spawn } from "node:child_process";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "./types.js";
import { SchemaValidationError, ProviderTimeoutError } from "./types.js";
import { zodToJsonSchema } from "./schema-converter.js";
import { extractJsonContent } from "./openai.js";

/**
 * Kiro-backed Model Gateway (ADR-003 provider abstraction, ADR-013).
 *
 * Routes each bounded QE reasoning call through the real Kiro CLI in
 * headless mode (`kiro-cli chat --no-interactive --trust-all-tools`),
 * so when Kiro is the invocation harness, QE reasoning uses Kiro's own
 * configured model and authentication — not a separate provider
 * endpoint. The Kiro agent is instructed to answer with structured JSON
 * only; parsing tolerance (extractJsonContent) plus unchanged schema
 * validation keep invalid output out of the domain model.
 */

export interface KiroProviderConfig {
  /** Kiro CLI executable (default: kiro-cli, resolved from PATH). */
  executable?: string;
  /** Per-call timeout in milliseconds (default: 120s). */
  timeoutMs?: number;
}

/** Build the headless prompt for one structured reasoning call. */
export function buildKiroReasoningPrompt(
  objective: string,
  contextJson: string,
  schemaJson: string,
  constraints: string[],
): string {
  return [
    "You are a structured reasoning component of a Quality Engineering system.",
    "Answer with ONLY a single JSON object matching the provided schema.",
    "No prose, no markdown, no explanation — JSON only.",
    "",
    `## Objective\n${objective}`,
    "",
    `## Context\n${contextJson}`,
    "",
    `## Output schema (JSON Schema)\n${schemaJson}`,
    constraints.length > 0
      ? `\n## Constraints\n${constraints.map((c) => `- ${c}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export class KiroModelGateway implements ModelGateway {
  private readonly executable: string;
  private readonly timeoutMs: number;
  public readonly callLog: {
    role: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }[] = [];

  constructor(config: KiroProviderConfig = {}) {
    this.executable = config.executable ?? "kiro-cli";
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    const startedAt = new Date().toISOString();
    const start = Date.now();

    const schema = zodToJsonSchema(task.outputSchema);
    const prompt = buildKiroReasoningPrompt(
      task.objective,
      JSON.stringify(task.context),
      JSON.stringify(schema),
      task.constraints ?? [],
    );

    const stdout = await this.runHeadless(prompt, task.role);
    const durationMs = Date.now() - start;

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonContent(stdout));
    } catch {
      this.callLog.push({
        role: task.role,
        durationMs,
        success: false,
        error: "malformed JSON",
      });
      throw new SchemaValidationError(
        stdout.slice(0, 4096),
        `Kiro model returned malformed JSON for role "${task.role}"`,
      );
    }

    let validated: T;
    try {
      validated = task.outputSchema.parse(parsed);
    } catch (err) {
      if (err instanceof z.ZodError) {
        this.callLog.push({
          role: task.role,
          durationMs,
          success: false,
          error: "schema validation failed",
        });
        throw new SchemaValidationError(
          stdout.slice(0, 4096),
          err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
      }
      throw err;
    }

    this.callLog.push({ role: task.role, durationMs, success: true });

    return {
      data: validated,
      usage: {
        // Token usage is not reported by headless kiro-cli output;
        // zeros are honest (no fabricated usage numbers).
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      model: "kiro",
      provider: "kiro",
      durationMs,
      startedAt,
      retryCount: 0,
      promptVersion: task.promptVersion ?? "unknown",
    };
  }

  private runHeadless(prompt: string, role: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.executable,
        [
          "chat",
          "--no-interactive",
          "--trust-all-tools",
          "--output-format",
          "stream-json",
          prompt,
        ],
        { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
      );

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
      }, this.timeoutMs);

      proc.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
      proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(
          new SchemaValidationError(
            "",
            `Kiro CLI spawn failed for role "${role}": ${err.message}`,
          ),
        );
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (killed) {
          reject(new ProviderTimeoutError(this.timeoutMs, this.timeoutMs));
          return;
        }
        if (code !== 0) {
          reject(
            new SchemaValidationError(
              "",
              `Kiro CLI exited with code ${code} for role "${role}": ${Buffer.concat(stderrChunks).toString("utf-8").slice(0, 500)}`,
            ),
          );
          return;
        }
        resolve(this.extractStreamText(Buffer.concat(stdoutChunks).toString("utf-8")));
      });
    });
  }

  /**
   * stream-json output is JSON Lines of ACP events. The authoritative
   * answer is runFinished.data.finalText; agent_message_chunk events
   * are the fallback when the run was cut off before finishing.
   */
  private extractStreamText(raw: string): string {
    let finalText: string | undefined;
    const chunks: string[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          data?: {
            finalText?: string;
            status?: string;
            update?: {
              sessionUpdate?: string;
              content?: { type?: string; text?: string };
            };
          };
        };
        if (event.type === "runFinished" && typeof event.data?.finalText === "string") {
          finalText = event.data.finalText;
        }
        const update = event.data?.update;
        if (
          event.type === "sessionUpdate" &&
          update?.sessionUpdate === "agent_message_chunk" &&
          update.content?.type === "text" &&
          typeof update.content.text === "string"
        ) {
          chunks.push(update.content.text);
        }
      } catch {
        // not a JSON line (banner etc.) — skip
      }
    }

    if (finalText !== undefined && finalText.length > 0) return finalText;
    const joined = chunks.join("").trim();
    if (joined.length > 0) return joined;
    return raw.trim();
  }
}