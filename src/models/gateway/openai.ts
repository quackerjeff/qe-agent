import OpenAI from "openai";
import { z } from "zod";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
  ProviderRateLimitInfo,
} from "./types.js";
import {
  SchemaValidationError,
  OutputTruncationError,
  RateLimitError,
  ProviderTimeoutError,
} from "./types.js";
import { zodToJsonSchema } from "./schema-converter.js";

export interface OpenAIProviderConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
}

export interface ModelCallRecord {
  role: string;
  provider: string;
  model: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  success: boolean;
  retryCount: number;
  error?: string;
}

export function supportsJsonSchemaMode(model: string): boolean {
  if (model.startsWith("gpt-4o")) return true;
  if (model.startsWith("o1")) return true;
  if (model.startsWith("o3")) return true;
  if (model.startsWith("o4")) return true;
  return false;
}

function sanitizeSchemaName(role: string): string {
  return role.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Extract structured JSON from real-world model output.
 *
 * Reasoning and local models frequently wrap or decorate JSON even when
 * asked not to. Supported formats, in order of preference:
 *  1. bare JSON (the historical contract)
 *  2. markdown code fences: ```json ... ``` or ``` ... ```
 *  3. legacy reasoning blocks: <think>...</think> outside the JSON
 *  4. JSON embedded in surrounding prose (first balanced object/array)
 *
 * This is tolerance in parsing only — schema validation still applies
 * unchanged afterward, so invalid structured output can never silently
 * enter the domain model.
 */
export function extractJsonContent(raw: string): string {
  const text = raw.trim();
  if (text.length === 0) return text;

  // 1. Bare JSON.
  if (text.startsWith("{") || text.startsWith("[")) return text;

  // 2. Markdown code fences.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) return fence[1].trim();

  // 3. Reasoning blocks before/after the JSON.
  const stripped = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
  if (stripped.startsWith("{") || stripped.startsWith("[")) return stripped;

  // 4. First balanced JSON object or array embedded in prose.
  const start = text.search(/[{[]/);
  if (start >= 0) {
    const open = text[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }

  return text;
}

export class OpenAIModelGateway implements ModelGateway {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature: number;
  public readonly callLog: ModelCallRecord[] = [];

  constructor(config: OpenAIProviderConfig) {
    this.model = config.model;
    this.temperature = config.temperature ?? 0.1;
    this.client = new OpenAI({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: config.baseURL,
      maxRetries: 0,
    });
  }

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    const startedAt = new Date().toISOString();
    const start = Date.now();

    try {
      const result = await this.attempt(task);
      const durationMs = Date.now() - start;

      const finalResult: ModelResult<T> = {
        ...result,
        provider: "openai",
        startedAt,
        retryCount: 0,
        promptVersion: task.promptVersion ?? "unknown",
      };

      this.callLog.push({
        role: task.role,
        provider: "openai",
        model: this.model,
        durationMs,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        success: true,
        retryCount: 0,
      });

      return finalResult;
    } catch (err) {
      const lastError = err instanceof Error ? err : new Error(String(err));
      const durationMs = Date.now() - start;

      const schemaErr =
        lastError instanceof SchemaValidationError ? lastError : undefined;

      this.callLog.push({
        role: task.role,
        provider: "openai",
        model: this.model,
        durationMs,
        promptTokens: schemaErr?.usage?.promptTokens ?? 0,
        completionTokens: schemaErr?.usage?.completionTokens ?? 0,
        totalTokens: schemaErr?.usage?.totalTokens ?? 0,
        success: false,
        retryCount: 0,
        error: lastError.message,
      });

      throw lastError;
    }
  }

  private async attempt<T>(
    task: ReasoningTask<T>,
  ): Promise<
    Omit<
      ModelResult<T>,
      "provider" | "startedAt" | "retryCount" | "promptVersion"
    >
  > {
    const jsonSchema = zodToJsonSchema(task.outputSchema);
    const systemPrompt = buildSystemPrompt(task, this.model, jsonSchema);
    const userPrompt = buildUserPrompt(task);

    const start = Date.now();

    const responseFormat = supportsJsonSchemaMode(this.model)
      ? {
          type: "json_schema" as const,
          json_schema: {
            name: sanitizeSchemaName(task.role),
            schema: jsonSchema,
            strict: false,
          },
        }
      : { type: "json_object" as const };

    const requestOptions: Record<string, unknown> = {};
    if (task.timeoutMs !== undefined && task.timeoutMs > 0) {
      requestOptions.signal = AbortSignal.timeout(task.timeoutMs);
    }

    let response: OpenAI.ChatCompletion;
    let rateLimitInfo: ProviderRateLimitInfo | undefined;
    try {
      const { data, response: httpResponse } =
        await this.client.chat.completions
          .create(
            {
              model: this.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              response_format: responseFormat,
              temperature: this.temperature,
              max_tokens: task.maxTokens ?? 2048,
            },
            requestOptions,
          )
          .withResponse();
      response = data;
      rateLimitInfo = extractRateLimitFromHeaders(httpResponse.headers);
    } catch (apiErr) {
      if (isOpenAI429(apiErr)) {
        throw new RateLimitError(
          extractRateLimitInfo(apiErr),
          apiErr instanceof Error ? apiErr.message : String(apiErr),
        );
      }
      if (isAbortTimeout(apiErr) && task.timeoutMs !== undefined) {
        throw new ProviderTimeoutError(task.timeoutMs, Date.now() - start);
      }
      throw apiErr;
    }

    const durationMs = Date.now() - start;
    const choice = response.choices[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;

    if (!content) {
      throw new Error("Empty response from model");
    }

    const cachedTokens =
      (
        response.usage as {
          prompt_tokens_details?: { cached_tokens?: number };
        }
      )?.prompt_tokens_details?.cached_tokens ?? 0;

    const usage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      cachedTokens: cachedTokens > 0 ? cachedTokens : undefined,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    const requestedMaxTokens = task.maxTokens ?? 2048;

    if (finishReason === "length") {
      throw new OutputTruncationError(
        content.slice(0, 4096),
        requestedMaxTokens,
        usage,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonContent(content));
    } catch {
      throw new SchemaValidationError(
        content.slice(0, 4096),
        `Model returned malformed JSON (finish_reason: ${finishReason ?? "unknown"})`,
        usage,
      );
    }

    let validated: T;
    try {
      validated = task.outputSchema.parse(parsed);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new SchemaValidationError(
          content.slice(0, 4096),
          err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          usage,
        );
      }
      throw err;
    }

    return {
      data: validated,
      usage,
      model: this.model,
      durationMs,
      rateLimitInfo,
    };
  }
}

export function isAbortTimeout(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "TimeoutError") return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name: string }).name;
    if (name === "AbortError" || name === "TimeoutError") return true;
    if (name === "APIUserAbortError") return true;
  }
  if (
    err instanceof Error &&
    (err.message.includes("timed out") ||
      err.message === "Request was aborted.")
  )
    return true;
  return false;
}

function isOpenAI429(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    return (err as { status: number }).status === 429;
  }
  return false;
}

function extractRateLimitInfo(err: unknown): ProviderRateLimitInfo | undefined {
  const now = Date.now();
  const apiErr = err as {
    headers?: { get?: (name: string) => string | null } & Record<
      string,
      unknown
    >;
    message?: string;
    error?: { message?: string };
  };

  let tokenLimit: number | undefined;
  let remaining: number | undefined;
  let resetAtMs: number | undefined;
  let retryAfterMs: number | undefined;

  const headers = apiErr.headers;
  if (headers && typeof headers.get === "function") {
    const limitStr = headers.get("x-ratelimit-limit-tokens");
    if (limitStr) tokenLimit = parseInt(limitStr, 10);

    const remainStr = headers.get("x-ratelimit-remaining-tokens");
    if (remainStr) remaining = parseInt(remainStr, 10);

    const resetStr = headers.get("x-ratelimit-reset-tokens");
    if (resetStr) resetAtMs = now + parseResetDuration(resetStr);

    const retryMsStr = headers.get("retry-after-ms");
    if (retryMsStr) {
      retryAfterMs = parseFloat(retryMsStr);
    } else {
      const retryStr = headers.get("retry-after");
      if (retryStr) retryAfterMs = parseFloat(retryStr) * 1000;
    }
  }

  const msg =
    apiErr.error?.message ?? (err instanceof Error ? err.message : "");
  if (!tokenLimit) {
    const m = msg.match(/Limit\s+(\d+)/i);
    if (m) tokenLimit = parseInt(m[1], 10);
  }
  if (remaining === undefined) {
    const usedMatch = msg.match(/Used\s+(\d+)/i);
    if (usedMatch && tokenLimit) {
      remaining = tokenLimit - parseInt(usedMatch[1], 10);
    }
  }

  if (retryAfterMs === undefined) {
    const retryMatch = msg.match(/try again in (\d+(?:\.\d+)?)s/i);
    if (retryMatch) retryAfterMs = parseFloat(retryMatch[1]) * 1000;
  }

  if (
    tokenLimit === undefined &&
    remaining === undefined &&
    resetAtMs === undefined &&
    retryAfterMs === undefined
  ) {
    return { observedAt: now };
  }

  return {
    tokenLimitPerMinute: tokenLimit,
    remainingTokens:
      remaining !== undefined ? Math.max(0, remaining) : undefined,
    resetAtMs,
    retryAfterMs,
    observedAt: now,
  };
}

function extractRateLimitFromHeaders(
  headers: Headers,
): ProviderRateLimitInfo | undefined {
  const now = Date.now();

  let tokenLimit: number | undefined;
  let remaining: number | undefined;
  let resetAtMs: number | undefined;

  const limitStr = headers.get("x-ratelimit-limit-tokens");
  if (limitStr) tokenLimit = parseInt(limitStr, 10);

  const remainStr = headers.get("x-ratelimit-remaining-tokens");
  if (remainStr) remaining = parseInt(remainStr, 10);

  const resetStr = headers.get("x-ratelimit-reset-tokens");
  if (resetStr) resetAtMs = now + parseResetDuration(resetStr);

  if (
    tokenLimit === undefined &&
    remaining === undefined &&
    resetAtMs === undefined
  ) {
    return undefined;
  }

  return {
    tokenLimitPerMinute: tokenLimit,
    remainingTokens:
      remaining !== undefined ? Math.max(0, remaining) : undefined,
    resetAtMs,
    observedAt: now,
  };
}

function parseResetDuration(value: string): number {
  let ms = 0;
  const minuteMatch = value.match(/(\d+)m(?!s)/);
  if (minuteMatch) ms += parseInt(minuteMatch[1], 10) * 60_000;
  const secondMatch = value.match(/(\d+(?:\.\d+)?)s/);
  if (secondMatch) ms += parseFloat(secondMatch[1]) * 1000;
  const msMatch = value.match(/(\d+)ms/);
  if (msMatch) ms += parseInt(msMatch[1], 10);
  return ms || 1000;
}

function buildSystemPrompt<T>(
  task: ReasoningTask<T>,
  model: string,
  jsonSchema: Record<string, unknown>,
): string {
  const parts: string[] = [
    `You are a ${task.role}.`,
    "",
    `Objective: ${task.objective}`,
  ];

  if (task.constraints && task.constraints.length > 0) {
    parts.push("");
    parts.push("Constraints:");
    for (const c of task.constraints) {
      parts.push(`- ${c}`);
    }
  }

  parts.push("");
  parts.push(
    "You MUST respond with valid JSON matching the required schema. Do not include any text outside the JSON object.",
  );

  if (!supportsJsonSchemaMode(model)) {
    parts.push("");
    parts.push("Required output JSON Schema:");
    parts.push("```json");
    parts.push(JSON.stringify(jsonSchema, null, 2));
    parts.push("```");
  }

  return parts.join("\n");
}

function buildUserPrompt<T>(task: ReasoningTask<T>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(task.context)) {
    parts.push(`## ${key}`);
    parts.push("");
    if (typeof value === "string") {
      parts.push(value);
    } else {
      parts.push(JSON.stringify(value, null, 2));
    }
    parts.push("");
  }

  return parts.join("\n");
}
