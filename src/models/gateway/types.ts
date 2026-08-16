import { z } from "zod";

export interface ReasoningTask<T> {
  role: string;
  objective: string;
  context: Record<string, unknown>;
  outputSchema: z.ZodType<T>;
  constraints?: string[];
  maxTokens?: number;
}

export interface ModelResult<T> {
  data: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  durationMs: number;
}

export interface ModelGateway {
  reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>>;
}
