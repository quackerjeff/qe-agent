import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
  ProviderRateLimitInfo,
} from "../../models/gateway/types.js";
import {
  SchemaValidationError,
  OutputTruncationError,
  RateLimitError,
  ProviderTimeoutError,
} from "../../models/gateway/types.js";
import { zodToJsonSchema } from "../../models/gateway/schema-converter.js";
import type { BudgetManager } from "./budget-manager.js";
import type {
  ModelCallMetadata,
  AIUsageTelemetry,
  AILimitStatus,
  AIContextBreakdown,
  ThroughputAction,
  ThroughputLimitClassification,
} from "../../types/index.js";
import type { ProviderAttemptDiagnostic } from "./diagnostics.js";

export const DEFAULT_MAX_RESPONSE_TOKENS = 2048;
export const MINIMUM_OUTPUT_RESERVATION = 512;
export const MIN_MODEL_CALL_TIMEOUT_MS = 5_000;
const DEFAULT_TPM_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5_000;

export class OversizedRequestError extends Error {
  constructor(
    public readonly estimatedDemand: number,
    public readonly modelLimit: number,
  ) {
    super(
      `Context exceeds available model throughput: estimated ${estimatedDemand} tokens, limit ${modelLimit}`,
    );
    this.name = "OversizedRequestError";
  }
}

export class ThroughputExceededError extends Error {
  constructor(
    public readonly estimatedDemand: number,
    public readonly availableCapacity: number | undefined,
    public readonly tpmLimit: number | undefined,
    public readonly classification: ThroughputLimitClassification,
  ) {
    super(
      `Request exceeds available throughput: estimated ${estimatedDemand} tokens` +
        (availableCapacity !== undefined
          ? `, available ${availableCapacity}`
          : "") +
        (tpmLimit !== undefined ? `, TPM limit ${tpmLimit}` : ""),
    );
    this.name = "ThroughputExceededError";
  }
}

export interface BudgetAwareGatewayOptions {
  maxRetriesPerCall?: number;
  modelTokenLimit?: number;
  tpmLimit?: number;
  tpmWindowMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

interface DispatchRecord {
  timestamp: number;
  actualTokens: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BudgetAwareGateway implements ModelGateway {
  public readonly callMetadata: ModelCallMetadata[] = [];
  public readonly diagnosticAttempts: ProviderAttemptDiagnostic[] = [];

  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCachedTokens = 0;
  private maxResponseTokensSeen = 0;
  private totalEstimatedDemand = 0;
  private _limitStatus: AILimitStatus = "OK";
  private _limitClassification?: ThroughputLimitClassification;
  private _contextBreakdown: AIContextBreakdown[] = [];
  private _throughputActions: ThroughputAction[] = [];
  private readonly maxRetriesPerCall: number;
  private readonly modelTokenLimit?: number;
  private readonly tpmLimit?: number;
  private readonly tpmWindowMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly dispatchRecords: DispatchRecord[] = [];
  private latestRateLimitInfo?: ProviderRateLimitInfo;
  private _pendingTpmDemand = 0;

  constructor(
    private readonly inner: ModelGateway,
    private readonly budget: BudgetManager,
    options?: BudgetAwareGatewayOptions | number,
  ) {
    if (typeof options === "number") {
      this.maxRetriesPerCall = options;
      this.tpmWindowMs = DEFAULT_TPM_WINDOW_MS;
      this.sleepFn = defaultSleep;
    } else {
      this.maxRetriesPerCall = options?.maxRetriesPerCall ?? 2;
      this.modelTokenLimit = options?.modelTokenLimit;
      this.tpmLimit = options?.tpmLimit;
      this.tpmWindowMs = options?.tpmWindowMs ?? DEFAULT_TPM_WINDOW_MS;
      this.sleepFn = options?.sleepFn ?? defaultSleep;
    }
  }

  private get effectiveTpmLimit(): number | undefined {
    return this.latestRateLimitInfo?.tokenLimitPerMinute ?? this.tpmLimit;
  }

  async reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
    let lastError: Error | undefined;
    let retryCount = 0;

    let maxResponse = task.maxTokens ?? DEFAULT_MAX_RESPONSE_TOKENS;
    if (maxResponse > this.maxResponseTokensSeen) {
      this.maxResponseTokensSeen = maxResponse;
    }

    const contextEstimate = estimateTaskTokens(task);
    this._contextBreakdown = buildContextBreakdown(task);
    let estimatedDemand = contextEstimate + maxResponse;

    this.totalEstimatedDemand += estimatedDemand;

    let effectiveTask = task;

    // Phase 1: Context-window admission
    if (this.modelTokenLimit && estimatedDemand > this.modelTokenLimit) {
      const availableForContext = this.modelTokenLimit - maxResponse;
      const reduced = reduceTaskContext(task, availableForContext);
      if (reduced) {
        effectiveTask = reduced;
        this._limitStatus = "REDUCED";
        this._limitClassification = "CONTEXT_WINDOW_EXCEEDED";
        estimatedDemand = estimateTaskTokens(effectiveTask) + maxResponse;
      } else {
        this._limitStatus = "BLOCKED";
        this._limitClassification = "CONTEXT_WINDOW_EXCEEDED";
        throw new OversizedRequestError(estimatedDemand, this.modelTokenLimit);
      }
    }

    // Phase 2: Throughput admission
    let pendingTpmReservation = 0;
    if (this.effectiveTpmLimit !== undefined) {
      const admission = await this.admitForThroughput(
        effectiveTask,
        maxResponse,
        estimatedDemand,
      );
      effectiveTask = admission.task;
      maxResponse = admission.maxResponse;
      estimatedDemand = admission.estimatedDemand;
      pendingTpmReservation = estimatedDemand;
    }

    // Phase 3: Dispatch with retry loop
    // Retries are bounded by the retry budget (maxRetries), not the logical
    // model-call budget (maxModelCalls). The orchestrator records one
    // recordModelCall() per logical reasoning stage; the gateway only records
    // recordRetry() for provider-level recovery attempts.
    try {
      for (let attempt = 0; attempt <= this.maxRetriesPerCall; attempt++) {
        if (attempt > 0) {
          if (!this.budget.tryReserveRetry()) {
            this.diagnosticAttempts.push({
              role: task.role,
              attemptIndex: attempt,
              timeoutMs: 0,
              remainingMs: this.budget.remainingMs,
              callDeadlineReserveMs: this.budget.callDeadlineReserveMs,
              startedAt: new Date().toISOString(),
              durationMs: 0,
              success: false,
              errorClass: "RetryBudgetExhausted",
              retryAttempted: true,
              retryAdmitted: false,
            });
            break;
          }
        }

        const callTimeoutMs = Math.max(
          0,
          this.budget.remainingMs - this.budget.callDeadlineReserveMs,
        );
        const diagRemainingMs = this.budget.remainingMs;
        const diagDeadlineReserveMs = this.budget.callDeadlineReserveMs;
        if (callTimeoutMs < MIN_MODEL_CALL_TIMEOUT_MS) {
          this.diagnosticAttempts.push({
            role: task.role,
            attemptIndex: attempt,
            timeoutMs: callTimeoutMs,
            remainingMs: diagRemainingMs,
            callDeadlineReserveMs: diagDeadlineReserveMs,
            startedAt: new Date().toISOString(),
            durationMs: 0,
            success: false,
            errorClass: "InsufficientTimeout",
            retryAttempted: attempt > 0,
            retryAdmitted: attempt > 0 ? true : undefined,
          });
          throw lastError ?? new ProviderTimeoutError(callTimeoutMs, 0);
        }

        const timedTask = { ...effectiveTask, timeoutMs: callTimeoutMs };

        const startedAt = new Date().toISOString();
        const start = Date.now();

        try {
          const result = await this.inner.reason(timedTask);
          const durationMs = Date.now() - start;

          if (effectiveTask.validateResult) {
            try {
              effectiveTask.validateResult(result.data);
            } catch (validationErr) {
              if (validationErr instanceof SchemaValidationError) {
                throw new SchemaValidationError(
                  validationErr.rawResponse,
                  validationErr.validationErrors,
                  validationErr.usage ?? result.usage,
                );
              }
              throw validationErr;
            }
          }

          const cached = result.usage.cachedTokens ?? 0;

          this.totalInputTokens += result.usage.promptTokens;
          this.totalOutputTokens += result.usage.completionTokens;
          this.totalCachedTokens += cached;

          this.recordDispatch(
            Date.now(),
            result.usage.promptTokens + result.usage.completionTokens,
          );

          if (result.rateLimitInfo) {
            this.latestRateLimitInfo = result.rateLimitInfo;
          }

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
            cachedTokens: cached > 0 ? cached : undefined,
            totalTokens: result.usage.totalTokens,
          });

          this.diagnosticAttempts.push({
            role: task.role,
            attemptIndex: attempt,
            timeoutMs: callTimeoutMs,
            remainingMs: diagRemainingMs,
            callDeadlineReserveMs: diagDeadlineReserveMs,
            startedAt,
            durationMs,
            success: true,
            finishReason: "stop",
            inputTokens: result.usage.promptTokens,
            outputTokens: result.usage.completionTokens,
            cachedTokens: result.usage.cachedTokens,
            retryAttempted: attempt > 0,
            retryAdmitted: attempt > 0 ? true : undefined,
          });

          return result;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const durationMs = Date.now() - start;

          if (lastError instanceof ProviderTimeoutError) {
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
            this.diagnosticAttempts.push({
              role: task.role,
              attemptIndex: attempt,
              timeoutMs: callTimeoutMs,
              remainingMs: diagRemainingMs,
              callDeadlineReserveMs: diagDeadlineReserveMs,
              startedAt,
              durationMs,
              success: false,
              errorClass: "ProviderTimeoutError",
              errorMessage: lastError.message.slice(0, 500),
              retryAttempted: attempt > 0,
              retryAdmitted: attempt > 0 ? true : undefined,
            });
            break;
          }

          const schemaErr =
            lastError instanceof SchemaValidationError ? lastError : undefined;
          const rateLimitErr =
            lastError instanceof RateLimitError ? lastError : undefined;
          let breakAfterRecording = false;

          if (schemaErr?.usage) {
            this.totalInputTokens += schemaErr.usage.promptTokens;
            this.totalOutputTokens += schemaErr.usage.completionTokens;
            this.totalCachedTokens += schemaErr.usage.cachedTokens ?? 0;
            this.recordDispatch(
              Date.now(),
              schemaErr.usage.promptTokens + schemaErr.usage.completionTokens,
            );
          }

          const isRateLimit =
            rateLimitErr !== undefined || isRateLimitError(lastError);

          if (isRateLimit) {
            if (rateLimitErr?.rateLimitInfo) {
              this.latestRateLimitInfo = rateLimitErr.rateLimitInfo;
            }

            if (this._limitStatus === "OK" || this._limitStatus === "REDUCED") {
              this._limitStatus = "DEGRADED";
            }
            if (!this._limitClassification) {
              const info = rateLimitErr?.rateLimitInfo;
              if (
                info?.tokenLimitPerMinute !== undefined &&
                info?.remainingTokens !== undefined
              ) {
                this._limitClassification =
                  estimatedDemand > info.tokenLimitPerMinute
                    ? "THROUGHPUT_REQUEST_TOO_LARGE"
                    : "THROUGHPUT_TEMPORARILY_EXHAUSTED";
              } else {
                this._limitClassification = "RATE_LIMIT_UNKNOWN";
              }
            }

            if (attempt < this.maxRetriesPerCall) {
              const waitMs = rateLimitErr
                ? this.calculateRetryWait(rateLimitErr)
                : DEFAULT_RATE_LIMIT_BACKOFF_MS;

              if (waitMs > this.budget.remainingMs) {
                this._throughputActions.push({
                  action: "BLOCKED",
                  reason: `Rate limit wait (${waitMs}ms) exceeds time budget (${this.budget.remainingMs}ms remaining)`,
                });
                breakAfterRecording = true;
              } else if (waitMs > 0) {
                this._throughputActions.push({
                  action: "DEFERRED",
                  reason: `Waiting ${waitMs}ms after rate limit before retry`,
                  waitMs,
                });
                await this.sleepFn(waitMs);
              }

              if (
                !breakAfterRecording &&
                this.effectiveTpmLimit !== undefined
              ) {
                const available = this.getAvailableThroughput();
                if (available !== undefined && estimatedDemand > available) {
                  this._pendingTpmDemand -= pendingTpmReservation;
                  pendingTpmReservation = 0;
                  try {
                    const readmission = await this.admitForThroughput(
                      effectiveTask,
                      maxResponse,
                      estimatedDemand,
                    );
                    effectiveTask = readmission.task;
                    maxResponse = readmission.maxResponse;
                    estimatedDemand = readmission.estimatedDemand;
                    pendingTpmReservation = estimatedDemand;
                  } catch (admitErr) {
                    if (admitErr instanceof ThroughputExceededError) {
                      lastError = admitErr;
                      breakAfterRecording = true;
                    } else {
                      throw admitErr;
                    }
                  }
                }
              }
            }
          }

          this.callMetadata.push({
            role: task.role,
            provider: "unknown",
            model: "unknown",
            promptVersion: task.promptVersion ?? "unknown",
            startedAt,
            durationMs,
            success: false,
            retryCount: attempt,
            inputTokens: schemaErr?.usage?.promptTokens,
            outputTokens: schemaErr?.usage?.completionTokens,
            cachedTokens: schemaErr?.usage?.cachedTokens,
            totalTokens: schemaErr?.usage?.totalTokens,
          });

          this.diagnosticAttempts.push({
            role: task.role,
            attemptIndex: attempt,
            timeoutMs: callTimeoutMs,
            remainingMs: diagRemainingMs,
            callDeadlineReserveMs: diagDeadlineReserveMs,
            startedAt,
            durationMs,
            success: false,
            errorClass: lastError.constructor.name,
            errorMessage: lastError.message.slice(0, 500),
            finishReason:
              lastError instanceof OutputTruncationError ? "length" : undefined,
            inputTokens: schemaErr?.usage?.promptTokens,
            outputTokens: schemaErr?.usage?.completionTokens,
            cachedTokens: schemaErr?.usage?.cachedTokens,
            retryAttempted: attempt > 0,
            retryAdmitted: attempt > 0 ? true : undefined,
          });

          if (schemaErr && attempt < this.maxRetriesPerCall) {
            if (schemaErr instanceof OutputTruncationError) {
              const currentMax =
                effectiveTask.maxTokens ?? DEFAULT_MAX_RESPONSE_TOKENS;
              const increased = Math.min(currentMax * 2, 16384);
              if (increased > currentMax) {
                effectiveTask = { ...effectiveTask, maxTokens: increased };
              }
            } else {
              effectiveTask = buildRepairTask(task, schemaErr);
            }
          }

          retryCount++;

          if (breakAfterRecording) break;
        }
      }

      throw lastError ?? new Error("Model call failed after retries");
    } finally {
      this._pendingTpmDemand -= pendingTpmReservation;
    }
  }

  private async admitForThroughput<T>(
    task: ReasoningTask<T>,
    maxResponse: number,
    estimatedDemand: number,
  ): Promise<{
    task: ReasoningTask<T>;
    maxResponse: number;
    estimatedDemand: number;
  }> {
    const rawAvailable = this.getAvailableThroughput();
    const available =
      rawAvailable !== undefined
        ? Math.max(0, rawAvailable - this._pendingTpmDemand)
        : undefined;

    if (available === undefined || estimatedDemand <= available) {
      this._pendingTpmDemand += estimatedDemand;
      return { task, maxResponse, estimatedDemand };
    }

    let effectiveTask = task;
    let effectiveMaxResponse = maxResponse;
    let effectiveDemand = estimatedDemand;

    // Strategy A: Right-size output reservation
    if (effectiveMaxResponse > MINIMUM_OUTPUT_RESERVATION) {
      const contextEstimate = estimateTaskTokens(effectiveTask);
      const fittingMaxResponse = Math.max(
        MINIMUM_OUTPUT_RESERVATION,
        available - contextEstimate,
      );
      if (
        fittingMaxResponse < effectiveMaxResponse &&
        fittingMaxResponse >= MINIMUM_OUTPUT_RESERVATION
      ) {
        const newDemand = contextEstimate + fittingMaxResponse;
        this._throughputActions.push({
          action: "RIGHT_SIZED_OUTPUT",
          reason: `Output reservation reduced from ${effectiveMaxResponse} to ${fittingMaxResponse} to fit throughput`,
          originalDemand: effectiveDemand,
          adjustedDemand: newDemand,
        });
        effectiveMaxResponse = fittingMaxResponse;
        effectiveTask = { ...effectiveTask, maxTokens: fittingMaxResponse };
        effectiveDemand = newDemand;
        if (this._limitStatus === "OK" || this._limitStatus === "REDUCED") {
          this._limitStatus = "DEGRADED";
        }
      }
    }

    if (effectiveDemand <= available) {
      this._pendingTpmDemand += effectiveDemand;
      return {
        task: effectiveTask,
        maxResponse: effectiveMaxResponse,
        estimatedDemand: effectiveDemand,
      };
    }

    // Strategy B: Reduce context for throughput
    const availableForContext = available - effectiveMaxResponse;
    if (availableForContext > 0) {
      const reduced = reduceTaskContext(effectiveTask, availableForContext);
      if (reduced) {
        const newContextEstimate = estimateTaskTokens(reduced);
        const newDemand = newContextEstimate + effectiveMaxResponse;
        this._throughputActions.push({
          action: "REDUCED_CONTEXT",
          reason: "Context reduced to fit throughput capacity",
          originalDemand: effectiveDemand,
          adjustedDemand: newDemand,
        });
        effectiveTask = reduced;
        effectiveDemand = newDemand;
        if (this._limitStatus === "OK" || this._limitStatus === "REDUCED") {
          this._limitStatus = "DEGRADED";
        }
      }
    }

    if (effectiveDemand <= available) {
      this._pendingTpmDemand += effectiveDemand;
      return {
        task: effectiveTask,
        maxResponse: effectiveMaxResponse,
        estimatedDemand: effectiveDemand,
      };
    }

    // Strategy C: Defer (only if demand fits in the full TPM budget)
    if (effectiveDemand <= (this.effectiveTpmLimit ?? Infinity)) {
      const deferMs = this.calculateDeferMs(effectiveDemand);
      if (
        deferMs !== undefined &&
        deferMs > 0 &&
        deferMs <= this.budget.remainingMs
      ) {
        this._throughputActions.push({
          action: "DEFERRED",
          reason: `Waiting ${deferMs}ms for throughput capacity to recover`,
          waitMs: deferMs,
        });
        await this.sleepFn(deferMs);
        if (this._limitStatus === "OK" || this._limitStatus === "REDUCED") {
          this._limitStatus = "DEGRADED";
        }

        const newRawAvailable = this.getAvailableThroughput();
        const newAvailable =
          newRawAvailable !== undefined
            ? Math.max(0, newRawAvailable - this._pendingTpmDemand)
            : undefined;
        if (newAvailable !== undefined && effectiveDemand <= newAvailable) {
          this._pendingTpmDemand += effectiveDemand;
          return {
            task: effectiveTask,
            maxResponse: effectiveMaxResponse,
            estimatedDemand: effectiveDemand,
          };
        }
      }
    }

    // Strategy D: Block
    const classification: ThroughputLimitClassification =
      effectiveDemand > (this.effectiveTpmLimit ?? Infinity)
        ? "THROUGHPUT_REQUEST_TOO_LARGE"
        : "THROUGHPUT_TEMPORARILY_EXHAUSTED";

    this._throughputActions.push({
      action: "BLOCKED",
      reason: `Request (${effectiveDemand} tokens) exceeds available throughput (${available} remaining, TPM limit ${this.effectiveTpmLimit})`,
      originalDemand: estimatedDemand,
    });
    this._limitStatus = "BLOCKED";
    this._limitClassification = classification;
    throw new ThroughputExceededError(
      effectiveDemand,
      available,
      this.effectiveTpmLimit,
      classification,
    );
  }

  private getAvailableThroughput(): number | undefined {
    const limit = this.effectiveTpmLimit;
    if (limit === undefined) return undefined;

    const now = Date.now();
    const windowStart = now - this.tpmWindowMs;

    const consumedInWindow = this.dispatchRecords
      .filter((r) => r.timestamp >= windowStart)
      .reduce((sum, r) => sum + r.actualTokens, 0);

    let available = limit - consumedInWindow;

    if (
      this.latestRateLimitInfo?.remainingTokens !== undefined &&
      this.latestRateLimitInfo.observedAt >= windowStart
    ) {
      available = Math.min(available, this.latestRateLimitInfo.remainingTokens);
    }

    return Math.max(0, available);
  }

  private calculateDeferMs(neededDemand: number): number | undefined {
    if (this.latestRateLimitInfo?.retryAfterMs) {
      return this.latestRateLimitInfo.retryAfterMs;
    }
    if (this.latestRateLimitInfo?.resetAtMs) {
      const wait = this.latestRateLimitInfo.resetAtMs - Date.now();
      if (wait > 0) return wait;
    }

    const limit = this.effectiveTpmLimit;
    if (limit === undefined) return undefined;

    const now = Date.now();
    const windowStart = now - this.tpmWindowMs;
    const records = this.dispatchRecords
      .filter((r) => r.timestamp >= windowStart)
      .sort((a, b) => a.timestamp - b.timestamp);

    const consumed = records.reduce((s, r) => s + r.actualTokens, 0);
    const deficit = neededDemand - (limit - consumed);
    if (deficit <= 0) return 0;

    let freedSoFar = 0;
    for (const r of records) {
      const ageOutTime = r.timestamp + this.tpmWindowMs;
      freedSoFar += r.actualTokens;
      if (freedSoFar >= deficit) {
        return Math.max(0, ageOutTime - now + 100);
      }
    }

    return undefined;
  }

  private calculateRetryWait(err: RateLimitError): number {
    if (err.rateLimitInfo?.retryAfterMs) {
      return err.rateLimitInfo.retryAfterMs;
    }
    if (err.rateLimitInfo?.resetAtMs) {
      const wait = err.rateLimitInfo.resetAtMs - Date.now();
      if (wait > 0) return wait;
    }
    return DEFAULT_RATE_LIMIT_BACKOFF_MS;
  }

  private recordDispatch(timestamp: number, actualTokens: number): void {
    this.dispatchRecords.push({ timestamp, actualTokens });
  }

  aggregateUsage(): AIUsageTelemetry {
    const totalCalls = this.callMetadata.length;
    const successfulCalls = this.callMetadata.filter((c) => c.success).length;
    const failedCalls = totalCalls - successfulCalls;

    return {
      modelCalls: totalCalls,
      successfulModelCalls: successfulCalls,
      failedModelCalls: failedCalls,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      cachedTokens: this.totalCachedTokens,
      maxResponseTokens:
        this.maxResponseTokensSeen > 0 ? this.maxResponseTokensSeen : undefined,
      estimatedTpmDemand:
        this.totalEstimatedDemand > 0 ? this.totalEstimatedDemand : undefined,
      modelLimit: this.modelTokenLimit,
      throughputLimit: this.effectiveTpmLimit,
      throughputActions:
        this._throughputActions.length > 0
          ? this._throughputActions
          : undefined,
      limitClassification: this._limitClassification,
      contextBreakdown:
        this._contextBreakdown.length > 0 ? this._contextBreakdown : undefined,
      limitStatus: this._limitStatus,
    };
  }
}

function buildRepairTask<T>(
  original: ReasoningTask<T>,
  error: SchemaValidationError,
): ReasoningTask<T> {
  const jsonSchema = zodToJsonSchema(original.outputSchema);
  return {
    ...original,
    context: {
      ...original.context,
      _schemaRepair: {
        previousResponse: error.rawResponse,
        validationErrors: error.validationErrors,
        expectedSchema: jsonSchema,
        instruction:
          "Your previous response did not match the required output schema. " +
          "Correct the response to fix the validation errors listed above. " +
          "Return only the corrected JSON.",
      },
    },
  };
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateTaskTokens<T>(task: ReasoningTask<T>): number {
  let total = 0;
  total += estimateTokens(task.role ?? "");
  total += estimateTokens(task.objective ?? "");
  if (task.constraints) {
    for (const c of task.constraints) {
      total += estimateTokens(c ?? "");
    }
  }
  for (const value of Object.values(task.context)) {
    if (value == null) continue;
    if (typeof value === "string") {
      total += estimateTokens(value);
    } else {
      total += estimateTokens(JSON.stringify(value));
    }
  }
  return total;
}

function buildContextBreakdown<T>(
  task: ReasoningTask<T>,
): AIContextBreakdown[] {
  const breakdown: AIContextBreakdown[] = [];
  let metadataTokens =
    estimateTokens(task.role) + estimateTokens(task.objective);
  if (task.constraints) {
    for (const c of task.constraints) {
      metadataTokens += estimateTokens(c);
    }
  }
  if (metadataTokens > 0) {
    breakdown.push({ category: "metadata", estimatedTokens: metadataTokens });
  }
  for (const [key, value] of Object.entries(task.context)) {
    if (value == null) continue;
    const tokens =
      typeof value === "string"
        ? estimateTokens(value)
        : estimateTokens(JSON.stringify(value));
    breakdown.push({ category: key, estimatedTokens: tokens });
  }
  return breakdown;
}

export function reduceTaskContext<T>(
  task: ReasoningTask<T>,
  availableTokens: number,
): ReasoningTask<T> | null {
  if (availableTokens <= 0) return null;

  const metadataTokens =
    estimateTokens(task.role) +
    estimateTokens(task.objective) +
    (task.constraints?.reduce((s, c) => s + estimateTokens(c), 0) ?? 0);

  const contextBudget = availableTokens - metadataTokens;
  if (contextBudget <= 0) return null;

  const currentContextTokens = estimateTaskTokens(task) - metadataTokens;
  if (currentContextTokens <= contextBudget) return task;

  const ratio = contextBudget / currentContextTokens;
  if (ratio < 0.3) return null;

  const newContext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task.context)) {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    const targetLen = Math.floor(str.length * ratio);
    newContext[key] = str.slice(0, targetLen);
  }

  return { ...task, context: newContext };
}

function isRateLimitError(err: Error): boolean {
  if (err instanceof RateLimitError) return true;
  const msg = err.message.toLowerCase();
  return msg.includes("429") || msg.includes("rate limit");
}
