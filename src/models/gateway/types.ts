import { z } from "zod";

export interface ReasoningTask<T> {
  role: string;
  objective: string;
  context: Record<string, unknown>;
  outputSchema: z.ZodType<T>;
  constraints?: string[];
  maxTokens?: number;
  timeoutMs?: number;
  promptVersion?: string;
  validateResult?: (data: T) => void;
}

export interface ProviderRateLimitInfo {
  tokenLimitPerMinute?: number;
  remainingTokens?: number;
  resetAtMs?: number;
  retryAfterMs?: number;
  observedAt: number;
}

export interface ModelResult<T> {
  data: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  durationMs: number;
  startedAt: string;
  retryCount: number;
  promptVersion: string;
  rateLimitInfo?: ProviderRateLimitInfo;
}

export interface ModelGateway {
  reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>>;
}

export class ProviderTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly elapsedMs: number,
  ) {
    super(
      `Provider call timed out after ${elapsedMs}ms (timeout: ${timeoutMs}ms)`,
    );
    this.name = "ProviderTimeoutError";
  }
}

export class RateLimitError extends Error {
  constructor(
    public readonly rateLimitInfo?: ProviderRateLimitInfo,
    message?: string,
  ) {
    super(message ?? "Rate limit exceeded");
    this.name = "RateLimitError";
  }
}

export class SchemaValidationError extends Error {
  constructor(
    public readonly rawResponse: string,
    public readonly validationErrors: string,
    public readonly usage?: {
      promptTokens: number;
      completionTokens: number;
      cachedTokens?: number;
      totalTokens: number;
    },
  ) {
    super(`Model output failed schema validation: ${validationErrors}`);
    this.name = "SchemaValidationError";
  }
}

export class OutputTruncationError extends SchemaValidationError {
  constructor(
    rawResponse: string,
    public readonly maxTokens: number,
    usage?: {
      promptTokens: number;
      completionTokens: number;
      cachedTokens?: number;
      totalTokens: number;
    },
  ) {
    super(
      rawResponse,
      `Output truncated: model hit max_tokens limit (${maxTokens}). Response was cut off mid-generation.`,
      usage,
    );
    this.name = "OutputTruncationError";
  }
}
