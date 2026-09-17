import { spawn } from "node:child_process";
import { z } from "zod";
import type { ModelGateway, ModelResult, ReasoningTask } from "./types.js";
import { SchemaValidationError, ProviderTimeoutError } from "./types.js";
import { zodToJsonSchema } from "./schema-converter.js";
import { extractJsonContent } from "./openai.js";

/**
 * OpenCode-backed Model Gateway (ADR-003 provider abstraction, ADR-011).
 *
 * Routes each bounded QE reasoning call through the real OpenCode CLI in
 * headless mode (`opencode run --format json`), so when OpenCode is the
 * invocation harness, QE reasoning uses OpenCode's own configured model
 * and authentication (its providers/models config) — not a separate
 * provider endpoint. The same JSON-only instruction set and parsing
 * tolerance (extractJsonContent) plus unchanged schema validation keep
 * invalid output out of the domain model. Symmetric with the Kiro
 * provider gateway.
 */

export interface OpenCodeProviderConfig {
  /** OpenCode CLI executable (default: opencode, resolved from PATH). */
  executable?: string;
  /** Per-call timeout in milliseconds (default: 120s). */
  timeoutMs?: number;
}

/** Build the headless prompt for one structured reasoning call. */
export function buildOpenCodeReasoningPrompt(
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

export class OpenCodeModelGateway implements ModelGateway {
  private readonly executable: string;
  private readonly timeoutMs: number;
  public readonly callLog: {
    role: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }[] = [];

  constructor(config: OpenCodeProviderConfig = {}) {
    this.executable = config.executable ?? "opencode";
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    const startedAt = new Date().toISOString();
    const start = Date.now();

    const schema = zodToJsonSchema(task.outputSchema);
    const prompt = buildOpenCodeReasoningPrompt(
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
        `OpenCode model returned malformed JSON for role "${task.role}"`,
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
        // Headless opencode run events do not expose a stable usage
        // payload; zeros are honest (no fabricated usage numbers).
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      model: "opencode",
      provider: "opencode",
      durationMs,
      startedAt,
      retryCount: 0,
      promptVersion: task.promptVersion ?? "unknown",
    };
  }

  private runHeadless(prompt: string, role: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.executable, ["run", "--format", "json", prompt], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

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
            `OpenCode CLI spawn failed for role "${role}": ${err.message}`,
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
              `OpenCode CLI exited with code ${code} for role "${role}": ${Buffer.concat(stderrChunks).toString("utf-8").slice(0, 500)}`,
            ),
          );
          return;
        }
        resolve(
          this.extractRunText(Buffer.concat(stdoutChunks).toString("utf-8")),
        );
      });
    });
  }

  /**
   * `opencode run --format json` emits JSON Lines of raw events. The
   * authoritative answer text is extracted from assistant message parts
   * across update/message events.
   */
  private extractRunText(raw: string): string {
    const texts: string[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          part?: { type?: string; text?: string };
          info?: { part?: { type?: string; text?: string } };
          message?: {
            role?: string;
            content?: { type?: string; text?: string }[];
          };
          data?: {
            part?: { type?: string; text?: string };
            message?: {
              role?: string;
              content?: { type?: string; text?: string }[];
            };
          };
        };

        // Common shapes across opencode versions: top-level part, or
        // part/info nested under data. Collect assistant text parts.
        const partSources = [event.part, event.info?.part, event.data?.part];
        for (const part of partSources) {
          if (part?.type === "text" && typeof part.text === "string") {
            texts.push(part.text);
          }
        }
        for (const msg of [event.message, event.data?.message]) {
          if (msg?.role === "assistant") {
            for (const part of msg.content ?? []) {
              if (part.type === "text" && typeof part.text === "string") {
                texts.push(part.text);
              }
            }
          }
        }
      } catch {
        // not a JSON line — skip
      }
    }
    const joined = texts.join("").trim();
    return joined.length > 0 ? joined : raw.trim();
  }
}
