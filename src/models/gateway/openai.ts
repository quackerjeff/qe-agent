import OpenAI from "openai";
import type { ModelGateway, ModelResult, ReasoningTask } from "./types.js";

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

      this.callLog.push({
        role: task.role,
        provider: "openai",
        model: this.model,
        durationMs,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
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
    const systemPrompt = buildSystemPrompt(task);
    const userPrompt = buildUserPrompt(task);

    const start = Date.now();

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: this.temperature,
      max_tokens: task.maxTokens ?? 4096,
    });

    const durationMs = Date.now() - start;
    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from model");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Model returned invalid JSON: ${content.slice(0, 200)}`);
    }

    const validated = task.outputSchema.parse(parsed);

    return {
      data: validated,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      model: this.model,
      durationMs,
    };
  }
}

function buildSystemPrompt<T>(task: ReasoningTask<T>): string {
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
