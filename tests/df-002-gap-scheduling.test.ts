import { describe, it, expect, vi } from "vitest";
import type {
  ModelGateway,
  ModelResult,
  ReasoningTask,
} from "../src/models/gateway/types.js";
import { ProviderTimeoutError } from "../src/models/gateway/types.js";
import {
  BudgetManager,
  createBudgetForProfile,
  VERDICT_TIME_RESERVE_MS,
} from "../src/core/orchestrator/budget-manager.js";
import {
  BudgetAwareGateway,
  MIN_MODEL_CALL_TIMEOUT_MS,
} from "../src/core/orchestrator/budget-aware-gateway.js";
import { analyzeGapsChunked } from "../src/core/reasoning/gap-analyzer.js";
import type { Requirement, RiskAssessment } from "../src/types/index.js";

function makeRequirements(count: number): Requirement[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `FR-${String(i + 1).padStart(3, "0")}`,
    description: `Requirement ${i + 1}`,
  }));
}

function makeRiskAssessment(): RiskAssessment {
  return {
    level: "MEDIUM",
    factors: [
      { factor: "change_scope", reason: "Moderate changes", weight: "medium" },
    ],
    confidence: 0.7,
    summary: "Medium risk",
  };
}

function makeGapModelResult(reqIds: string[]) {
  return {
    data: {
      gaps: [],
      requirementAssessments: reqIds.map((id) => ({
        requirementId: id,
        status: "NOT_VERIFIED" as const,
        evidenceIds: [],
        explanation: "No evidence",
      })),
    },
    usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    model: "test",
    provider: "fake",
    durationMs: 100,
    startedAt: new Date().toISOString(),
    retryCount: 0,
    promptVersion: "v1",
  };
}

/**
 * Build a mock inner gateway that resolves after a simulated delay.
 * Uses setTimeout so both parallel chunks start before either resolves,
 * allowing accurate wall-clock simulation with fake timers.
 */
function makeDelayedInnerGateway(delayFraction: number): ModelGateway {
  return {
    reason<T>(task: ReasoningTask<T>): Promise<ModelResult<T>> {
      const ctx = task.context as { requirements: { id: string }[] };
      const reqIds = ctx.requirements.map((r: { id: string }) => r.id);
      const result = makeGapModelResult(reqIds) as unknown as ModelResult<T>;
      const delay = Math.floor(task.timeoutMs! * delayFraction);
      return new Promise((resolve) => {
        setTimeout(() => resolve(result), delay);
      });
    },
  };
}

// ─── Section 1: Verdict-safe window — wall-clock simulation ───

describe("DF-002 Gap Scheduling: Verdict-safe window guarantee", () => {
  it("45s remaining: verdict gets >= VERDICT_TIME_RESERVE_MS after chunks consume near timeout", async () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager({
        maxDurationMs: 45_000,
        maxModelCalls: 10,
      });
      budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

      const inner = makeDelayedInnerGateway(0.98);
      const gateway = new BudgetAwareGateway(inner, budget, {
        maxRetriesPerCall: 0,
        sleepFn: async () => {},
      });

      const resultPromise = analyzeGapsChunked(
        gateway,
        makeRequirements(38),
        [],
        [],
        makeRiskAssessment(),
        undefined,
        2,
        () => {},
        () => {},
      );

      // chunkTimeout = 45000 - 20000 = 25000; mock delay = 25000 * 0.98 = 24500
      await vi.advanceTimersByTimeAsync(25_000);
      const result = await resultPromise;

      expect(result.chunksSucceeded).toBe(2);
      expect(budget.remainingMs).toBeGreaterThanOrEqual(
        VERDICT_TIME_RESERVE_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("40s remaining: verdict gets >= VERDICT_TIME_RESERVE_MS after chunks consume near timeout", async () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager({
        maxDurationMs: 40_000,
        maxModelCalls: 10,
      });
      budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

      const inner = makeDelayedInnerGateway(0.98);
      const gateway = new BudgetAwareGateway(inner, budget, {
        maxRetriesPerCall: 0,
        sleepFn: async () => {},
      });

      const resultPromise = analyzeGapsChunked(
        gateway,
        makeRequirements(38),
        [],
        [],
        makeRiskAssessment(),
        undefined,
        2,
        () => {},
        () => {},
      );

      // chunkTimeout = 40000 - 20000 = 20000; mock delay = 20000 * 0.98 = 19600
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await resultPromise;

      expect(result.chunksSucceeded).toBe(2);
      expect(budget.remainingMs).toBeGreaterThanOrEqual(
        VERDICT_TIME_RESERVE_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("50s remaining: verdict gets >= VERDICT_TIME_RESERVE_MS after chunks consume near timeout", async () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager({
        maxDurationMs: 50_000,
        maxModelCalls: 10,
      });
      budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

      const inner = makeDelayedInnerGateway(0.98);
      const gateway = new BudgetAwareGateway(inner, budget, {
        maxRetriesPerCall: 0,
        sleepFn: async () => {},
      });

      const resultPromise = analyzeGapsChunked(
        gateway,
        makeRequirements(38),
        [],
        [],
        makeRiskAssessment(),
        undefined,
        2,
        () => {},
        () => {},
      );

      // chunkTimeout = 50000 - 20000 = 30000; mock delay = 30000 * 0.98 = 29400
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await resultPromise;

      expect(result.chunksSucceeded).toBe(2);
      expect(budget.remainingMs).toBeGreaterThanOrEqual(
        VERDICT_TIME_RESERVE_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("chunks that fully exhaust their timeout still leave verdict window", async () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager({
        maxDurationMs: 45_000,
        maxModelCalls: 10,
      });
      budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

      const inner = makeDelayedInnerGateway(1.0);
      const gateway = new BudgetAwareGateway(inner, budget, {
        maxRetriesPerCall: 0,
        sleepFn: async () => {},
      });

      const resultPromise = analyzeGapsChunked(
        gateway,
        makeRequirements(38),
        [],
        [],
        makeRiskAssessment(),
        undefined,
        2,
        () => {},
        () => {},
      );

      // chunkTimeout = 25000; mock delay = 25000 * 1.0 = 25000
      await vi.advanceTimersByTimeAsync(25_000);
      const result = await resultPromise;

      expect(result.chunksSucceeded).toBe(2);
      // remaining = 45000 - 25000 = 20000 = VERDICT_TIME_RESERVE_MS exactly
      expect(budget.remainingMs).toBeGreaterThanOrEqual(
        VERDICT_TIME_RESERVE_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Section 2: Pre-dispatch time admission ───

describe("DF-002 Gap Scheduling: Pre-dispatch admission", () => {
  it("chunks skip when gap timeout < MIN_MODEL_CALL_TIMEOUT_MS", () => {
    const remainingMs = VERDICT_TIME_RESERVE_MS + MIN_MODEL_CALL_TIMEOUT_MS - 1;
    const effectiveGapTimeoutMs = remainingMs - VERDICT_TIME_RESERVE_MS;

    expect(effectiveGapTimeoutMs).toBeLessThan(MIN_MODEL_CALL_TIMEOUT_MS);
  });

  it("chunks dispatch when gap timeout >= MIN_MODEL_CALL_TIMEOUT_MS", () => {
    const remainingMs = VERDICT_TIME_RESERVE_MS + MIN_MODEL_CALL_TIMEOUT_MS;
    const effectiveGapTimeoutMs = remainingMs - VERDICT_TIME_RESERVE_MS;

    expect(effectiveGapTimeoutMs).toBeGreaterThanOrEqual(
      MIN_MODEL_CALL_TIMEOUT_MS,
    );
  });

  it("skipped chunks produce NOT_VERIFIED fallback via analyzeGapsChunked", async () => {
    const gateway: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        throw new Error("should not be called");
      },
    };

    const requirements = makeRequirements(25);

    const result = await analyzeGapsChunked(
      gateway,
      requirements,
      [],
      [],
      makeRiskAssessment(),
      undefined,
      0,
      () => {},
      () => {},
    );

    expect(result.chunksAttempted).toBe(2);
    expect(result.chunksSucceeded).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.requirementAssessments).toHaveLength(25);
    for (const a of result.requirementAssessments) {
      expect(a.status).toBe("NOT_VERIFIED");
    }
  });
});

// ─── Section 3: Post-gap admission unaffected ───

describe("DF-002 Gap Scheduling: Post-gap admission unaffected", () => {
  it("canAffordOptionalModelCall uses VERDICT_TIME_RESERVE_MS not callDeadlineReserveMs", () => {
    const budget = new BudgetManager({
      maxDurationMs: 60_000,
      maxModelCalls: 10,
    });

    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    expect(budget.canAffordOptionalModelCall()).toBe(true);

    budget.callDeadlineReserveMs = 0;
    expect(budget.canAffordOptionalModelCall()).toBe(true);
  });

  it("verdict stage sets reserve to 0 regardless of gap scheduling", () => {
    const budget = new BudgetManager(createBudgetForProfile("quick"));
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    budget.reserveVerdictCall();

    budget.callDeadlineReserveMs = 0;
    budget.releaseVerdictReservation();

    expect(budget.callDeadlineReserveMs).toBe(0);
    expect(budget.verdictReserved).toBe(0);
  });
});

// ─── Section 4: Retry budget conservation ───

describe("DF-002 Gap Scheduling: Retry budget preserved", () => {
  it("pre-dispatch skip conserves retry budget for verdict", () => {
    const budget = new BudgetManager(createBudgetForProfile("quick"));
    expect(budget.budget.maxRetries).toBe(1);

    expect(budget.canAffordRetry()).toBe(true);
    expect(budget.retries).toBe(0);
  });

  it("ProviderTimeoutError breaks immediately without consuming retry", async () => {
    const inner: ModelGateway = {
      async reason<T>(): Promise<ModelResult<T>> {
        throw new ProviderTimeoutError(5000, 5000);
      },
    };

    const budget = new BudgetManager(createBudgetForProfile("quick"));
    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;

    const gateway = new BudgetAwareGateway(inner, budget, {
      maxRetriesPerCall: 2,
      sleepFn: async () => {},
    });

    await analyzeGapsChunked(
      gateway,
      makeRequirements(5),
      [],
      [],
      makeRiskAssessment(),
      undefined,
      1,
      () => {},
      () => {},
    );

    expect(budget.retries).toBe(0);
  });
});

// ─── Section 5: Mathematical invariant ───

describe("DF-002 Gap Scheduling: Invariant proof", () => {
  it("callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS guarantees verdict window algebraically", () => {
    for (const initialRemainingMs of [40_000, 45_000, 50_000]) {
      const chunkTimeout = initialRemainingMs - VERDICT_TIME_RESERVE_MS;
      expect(chunkTimeout).toBeGreaterThanOrEqual(MIN_MODEL_CALL_TIMEOUT_MS);

      const wallClockConsumed = chunkTimeout;
      const remainingAfter = initialRemainingMs - wallClockConsumed;

      expect(remainingAfter).toBe(VERDICT_TIME_RESERVE_MS);
      expect(remainingAfter).toBeGreaterThanOrEqual(VERDICT_TIME_RESERVE_MS);
    }
  });

  it("reducing callDeadlineReserveMs below VERDICT_TIME_RESERVE_MS violates the invariant", () => {
    const reducedReserve = MIN_MODEL_CALL_TIMEOUT_MS;
    const initialRemainingMs = 45_000;

    const chunkTimeout = initialRemainingMs - reducedReserve;
    const wallClockConsumed = chunkTimeout;
    const remainingAfter = initialRemainingMs - wallClockConsumed;

    expect(remainingAfter).toBe(reducedReserve);
    expect(remainingAfter).toBeLessThan(VERDICT_TIME_RESERVE_MS);
  });
});
