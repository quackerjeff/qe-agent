import type { ExecutionBudget } from "../../types/index.js";

export interface BudgetSnapshot {
  elapsedMs: number;
  modelCalls: number;
  executionAttempts: number;
  retries: number;
  remainingMs: number;
  remainingModelCalls: number | null;
  exhausted: boolean;
  exhaustionReason: string | null;
}

export class BudgetManager {
  private readonly startTime: number;
  private _modelCalls = 0;
  private _executionAttempts = 0;
  private _retries = 0;

  constructor(private readonly budget: ExecutionBudget) {
    this.startTime = Date.now();
  }

  get modelCalls(): number {
    return this._modelCalls;
  }

  get executionAttempts(): number {
    return this._executionAttempts;
  }

  get retries(): number {
    return this._retries;
  }

  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  get remainingMs(): number {
    return Math.max(0, this.budget.maxDurationMs - this.elapsedMs);
  }

  get exhausted(): boolean {
    return this.snapshot().exhausted;
  }

  recordModelCall(): void {
    this._modelCalls++;
  }

  recordExecution(): void {
    this._executionAttempts++;
  }

  recordRetry(): void {
    this._retries++;
  }

  canAffordModelCall(): boolean {
    if (this.remainingMs <= 0) return false;
    if (
      this.budget.maxModelCalls !== undefined &&
      this._modelCalls >= this.budget.maxModelCalls
    ) {
      return false;
    }
    return true;
  }

  canAffordExecution(estimatedMs?: number): boolean {
    if (this.remainingMs <= 0) return false;
    if (estimatedMs !== undefined && estimatedMs > this.remainingMs)
      return false;
    return true;
  }

  canAffordRetry(): boolean {
    if (this.remainingMs <= 0) return false;
    if (
      this.budget.maxRetries !== undefined &&
      this._retries >= this.budget.maxRetries
    ) {
      return false;
    }
    return true;
  }

  snapshot(): BudgetSnapshot {
    const elapsed = this.elapsedMs;
    const remaining = Math.max(0, this.budget.maxDurationMs - elapsed);
    const remainingModelCalls =
      this.budget.maxModelCalls !== undefined
        ? Math.max(0, this.budget.maxModelCalls - this._modelCalls)
        : null;

    let exhaustionReason: string | null = null;
    if (remaining <= 0) {
      exhaustionReason = "Time budget exhausted";
    } else if (remainingModelCalls !== null && remainingModelCalls <= 0) {
      exhaustionReason = "Model call budget exhausted";
    } else if (
      this.budget.maxRetries !== undefined &&
      this._retries >= this.budget.maxRetries
    ) {
      exhaustionReason = "Retry budget exhausted";
    }

    return {
      elapsedMs: elapsed,
      modelCalls: this._modelCalls,
      executionAttempts: this._executionAttempts,
      retries: this._retries,
      remainingMs: remaining,
      remainingModelCalls,
      exhausted: exhaustionReason !== null,
      exhaustionReason,
    };
  }
}

export function createBudgetForProfile(
  profile: "quick" | "standard" | "deep",
  configMaxModelCalls?: number,
): ExecutionBudget {
  const budgets: Record<string, ExecutionBudget> = {
    quick: {
      maxDurationMs: 120_000,
      maxModelCalls: configMaxModelCalls ?? 6,
      maxRetries: 1,
    },
    standard: {
      maxDurationMs: 600_000,
      maxModelCalls: configMaxModelCalls ?? 12,
      maxRetries: 2,
    },
    deep: {
      maxDurationMs: 1_200_000,
      maxModelCalls: configMaxModelCalls ?? 24,
      maxRetries: 3,
    },
  };
  return budgets[profile];
}
