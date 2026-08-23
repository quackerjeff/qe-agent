import type { ModelGateway, ModelResult, ReasoningTask } from "./types.js";

export type FakeResponseProvider = <T>(task: ReasoningTask<T>) => T | undefined;

export interface FakeUsageConfig {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
}

export class FakeModelGateway implements ModelGateway {
  public calls: ReasoningTask<unknown>[] = [];

  constructor(
    private responseProvider?: FakeResponseProvider,
    private usageConfig?: FakeUsageConfig,
  ) {}

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    this.calls.push(task as ReasoningTask<unknown>);

    const data = this.responseProvider?.(task);
    if (data === undefined) {
      throw new Error(
        `FakeModelGateway: no response configured for role="${task.role}"`,
      );
    }

    const parsed = task.outputSchema.parse(data);
    const prompt = this.usageConfig?.promptTokens ?? 0;
    const completion = this.usageConfig?.completionTokens ?? 0;
    const cached = this.usageConfig?.cachedTokens;

    return {
      data: parsed,
      usage: {
        promptTokens: prompt,
        completionTokens: completion,
        cachedTokens: cached,
        totalTokens: prompt + completion,
      },
      model: "fake",
      provider: "fake",
      durationMs: 0,
      startedAt: new Date().toISOString(),
      retryCount: 0,
      promptVersion: task.promptVersion ?? "unknown",
    };
  }
}
