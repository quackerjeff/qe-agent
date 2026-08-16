import type { ModelGateway, ModelResult, ReasoningTask } from "./types.js";

export type FakeResponseProvider = <T>(task: ReasoningTask<T>) => T | undefined;

export class FakeModelGateway implements ModelGateway {
  public calls: ReasoningTask<unknown>[] = [];

  constructor(private responseProvider?: FakeResponseProvider) {}

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    this.calls.push(task as ReasoningTask<unknown>);

    const data = this.responseProvider?.(task);
    if (data === undefined) {
      throw new Error(
        `FakeModelGateway: no response configured for role="${task.role}"`,
      );
    }

    const parsed = task.outputSchema.parse(data);

    return {
      data: parsed,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      model: "fake",
      durationMs: 0,
    };
  }
}
