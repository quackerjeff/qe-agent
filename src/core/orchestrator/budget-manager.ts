import type { ExecutionBudget } from "../../types/index.js";

// Time reserved for mandatory verdict formation (model call + overhead).
// Conservative fixed value: accounts for one model round-trip (~15s) plus
// network/processing overhead (~5s).
export const VERDICT_TIME_RESERVE_MS = 20_000;

// Minimum headroom beyond verdict reserve for optional executions.
// Prevents starting commands that are guaranteed to time out.
export const MIN_OPTIONAL_EXECUTION_MS = 15_000;

// Minimum useful wall-clock for an optional model call.
// Based on observed provider round-trip latency: gpt-4o-mini 12–18s,
// gpt-4o 15–25s for structured output. 20s covers the common case
// while avoiding starvation of the subsequent verdict call.
export const MIN_OPTIONAL_MODEL_CALL_MS = 20_000;

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
  private _callDeadlineReserveMs = 0;
  private _reservedModelCalls = 0;
  private _verdictReserved = 0;

  constructor(public readonly budget: ExecutionBudget) {
    this.startTime = Date.now();
  }

  get callDeadlineReserveMs(): number {
    return this._callDeadlineReserveMs;
  }

  set callDeadlineReserveMs(value: number) {
    this._callDeadlineReserveMs = Math.max(0, value);
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

  get reservedModelCalls(): number {
    return this._reservedModelCalls;
  }

  get verdictReserved(): number {
    return this._verdictReserved;
  }

  reserveVerdictCall(): void {
    if (this._verdictReserved > 0) return;
    if (this.budget.maxModelCalls === undefined) {
      this._verdictReserved = 1;
      return;
    }
    const available =
      this.budget.maxModelCalls -
      this._modelCalls -
      this._reservedModelCalls -
      this._verdictReserved;
    if (available > 0) {
      this._verdictReserved = 1;
    }
  }

  releaseVerdictReservation(): void {
    this._verdictReserved = 0;
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

  reserveModelCalls(n: number): number {
    if (this.budget.maxModelCalls === undefined) return n;
    const available =
      this.budget.maxModelCalls -
      this._modelCalls -
      this._reservedModelCalls -
      this._verdictReserved;
    const toReserve = Math.max(0, Math.min(n, available));
    this._reservedModelCalls += toReserve;
    return toReserve;
  }

  consumeReservation(): void {
    if (this._reservedModelCalls > 0) {
      this._reservedModelCalls--;
      this._modelCalls++;
    }
  }

  releaseReservation(): void {
    if (this._reservedModelCalls > 0) {
      this._reservedModelCalls--;
    }
  }

  tryReserveRetry(): boolean {
    if (this.remainingMs <= 0) return false;
    if (
      this.budget.maxRetries !== undefined &&
      this._retries >= this.budget.maxRetries
    ) {
      return false;
    }
    this._retries++;
    return true;
  }

  canAffordModelCall(): boolean {
    if (this.remainingMs <= 0) return false;
    if (
      this.budget.maxModelCalls !== undefined &&
      this._modelCalls + this._reservedModelCalls + this._verdictReserved >=
        this.budget.maxModelCalls
    ) {
      return false;
    }
    return true;
  }

  canAffordOptionalModelCall(reservedCalls: number = 1): boolean {
    const availableForOptional = this.remainingMs - VERDICT_TIME_RESERVE_MS;
    if (availableForOptional < MIN_OPTIONAL_MODEL_CALL_MS) return false;
    if (this.budget.maxModelCalls !== undefined) {
      const remaining =
        this.budget.maxModelCalls -
        this._modelCalls -
        this._reservedModelCalls -
        this._verdictReserved;
      if (remaining <= reservedCalls) return false;
    }
    return true;
  }

  canAffordExecution(estimatedMs?: number): boolean {
    if (this.remainingMs <= 0) return false;
    if (estimatedMs !== undefined && estimatedMs > this.remainingMs)
      return false;
    return true;
  }

  canAffordOptionalExecution(estimatedMs?: number): boolean {
    const available = this.remainingMs - VERDICT_TIME_RESERVE_MS;
    if (available <= 0) return false;
    const required = estimatedMs ?? MIN_OPTIONAL_EXECUTION_MS;
    if (required > available) return false;
    return true;
  }

  optionalExecutionTimeoutMs(requestedMs: number): number {
    const available = this.remainingMs - VERDICT_TIME_RESERVE_MS;
    if (available < MIN_OPTIONAL_EXECUTION_MS) return 0;
    return Math.min(requestedMs, available);
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
        ? Math.max(
            0,
            this.budget.maxModelCalls -
              this._modelCalls -
              this._reservedModelCalls -
              this._verdictReserved,
          )
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
  const profileDefaults: Record<
    string,
    { maxModelCalls: number; maxDurationMs: number }
  > = {
    quick: { maxModelCalls: 6, maxDurationMs: 120_000 },
    standard: { maxModelCalls: 12, maxDurationMs: 600_000 },
    deep: { maxModelCalls: 24, maxDurationMs: 1_200_000 },
  };
  const defaults = profileDefaults[profile];

  const budgets: Record<string, ExecutionBudget> = {
    quick: {
      maxDurationMs: defaults.maxDurationMs,
      maxModelCalls: configMaxModelCalls ?? defaults.maxModelCalls,
      maxRetries: 1,
      maxGeneratedTests: 1,
      maxBrowserScenarios: 1,
      maxBrowserActions: 10,
      maxBrowserDurationMs: 30_000,
      maxScreenshots: 2,
    },
    standard: {
      maxDurationMs: defaults.maxDurationMs,
      maxModelCalls: configMaxModelCalls ?? defaults.maxModelCalls,
      maxRetries: 2,
      maxGeneratedTests: 3,
      maxBrowserScenarios: 3,
      maxBrowserActions: 30,
      maxBrowserDurationMs: 120_000,
      maxScreenshots: 5,
    },
    deep: {
      maxDurationMs: defaults.maxDurationMs,
      maxModelCalls: configMaxModelCalls ?? defaults.maxModelCalls,
      maxRetries: 3,
      maxGeneratedTests: 8,
      maxBrowserScenarios: 8,
      maxBrowserActions: 80,
      maxBrowserDurationMs: 300_000,
      maxScreenshots: 10,
    },
  };
  return budgets[profile];
}
