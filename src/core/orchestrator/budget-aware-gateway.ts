import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../../models/gateway/types.js";
import type { BudgetManager } from "./budget-manager.js";
import type { ModelCallMetadata } from "../../types/index.js";

export class BudgetAwareGateway implements ModelGateway {
  public readonly callMetadata: ModelCallMetadata[] = [];

  constructor(
    private readonly inner: ModelGateway,
    private readonly budget: BudgetManager,
    private readonly maxRetriesPerCall: number = 2,
  ) {}

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    let lastError: Error | undefined;
    let retryCount = 0;

    for (let attempt = 0; attempt <= this.maxRetriesPerCall; attempt++) {
      if (attempt > 0) {
        if (!this.budget.canAffordRetry()) break;
        this.budget.recordRetry();
        this.budget.recordModelCall();
      }

      const startedAt = new Date().toISOString();
      const start = Date.now();

      try {
        const result = await this.inner.reason(task);
        const durationMs = Date.now() - start;

        this.callMetadata.push({
          role: task.role,
          provider: result.provider,
          model: result.model,
          promptVersion: result.promptVersion,
          startedAt,
          durationMs,
          success: true,
          retryCount,
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        });

        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const durationMs = Date.now() - start;

        this.callMetadata.push({
          role: task.role,
          provider: "unknown",
          model: "unknown",
          promptVersion: task.promptVersion ?? "unknown",
          startedAt,
          durationMs,
          success: false,
          retryCount: attempt,
        });

        retryCount++;
      }
    }

    throw lastError ?? new Error("Model call failed after retries");
  }
}
