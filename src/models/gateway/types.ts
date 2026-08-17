import { z } from "zod";

export interface ReasoningTask<T> {
  role: string;
  objective: string;
  context: Record<string, unknown>;
  outputSchema: z.ZodType<T>;
  constraints?: string[];
  maxTokens?: number;
  promptVersion?: string;
}

export interface ModelResult<T> {
  data: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  durationMs: number;
  startedAt: string;
  retryCount: number;
  promptVersion: string;
}

export interface ModelGateway {
  reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>>;
}
