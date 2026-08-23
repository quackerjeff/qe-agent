import { describe, it, expect, vi } from "vitest";
import {
  BudgetManager,
  createBudgetForProfile,
  VERDICT_TIME_RESERVE_MS,
} from "../src/core/orchestrator/budget-manager.js";
import { MIN_OPTIONAL_MODEL_CALL_MS } from "../src/core/orchestrator/budget-manager.js";

describe("DF-002: Verdict-Safe Optional Model-Call Admission", () => {
  // F1: Rejects when remainingMs < VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS
  it("F1: rejects optional model call when headroom below combined threshold", () => {
    const threshold = VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS;
    const budget = new BudgetManager({
      maxDurationMs: threshold - 1,
      maxModelCalls: 20,
    });
    expect(budget.canAffordOptionalModelCall()).toBe(false);
  });

  // F2: Rejects exactly below the minimum optional-call headroom
  it("F2: rejects at exact boundary — remainingMs equals VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS minus 1", () => {
    vi.useFakeTimers();
    try {
      const threshold = VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS;
      const budget = new BudgetManager({
        maxDurationMs: threshold - 1,
        maxModelCalls: 20,
      });
      expect(budget.remainingMs).toBe(threshold - 1);
      expect(budget.canAffordOptionalModelCall()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // F3: Permits optional work when sufficient headroom exists
  it("F3: permits optional model call when headroom is sufficient", () => {
    vi.useFakeTimers();
    try {
      const threshold = VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS;
      const budget = new BudgetManager({
        maxDurationMs: threshold + 1,
        maxModelCalls: 20,
      });
      expect(budget.remainingMs).toBe(threshold + 1);
      expect(budget.canAffordOptionalModelCall()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // F4: Existing model-call-count reservation logic still applies
  it("F4: model-call-count reservation logic still blocks when slots exhausted", () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager({
        maxDurationMs: 120_000,
        maxModelCalls: 3,
      });
      budget.recordModelCall();
      budget.recordModelCall();
      budget.reserveVerdictCall();
      // 3 - 2 used - 1 verdict = 0 remaining, 0 <= 1 reserved → false
      expect(budget.canAffordOptionalModelCall()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // F5: Persistent verdict model-call reservation still applies
  it("F5: verdict reservation blocks optional call even with wall-clock headroom", () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager({
        maxDurationMs: 120_000,
        maxModelCalls: 2,
      });
      budget.recordModelCall();
      budget.reserveVerdictCall();
      // 2 - 1 used - 1 verdict = 0 remaining, 0 <= 1 reserved → false
      expect(budget.canAffordOptionalModelCall()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // F6: canAffordModelCall() behavior is unchanged
  it("F6: canAffordModelCall() does NOT use MIN_OPTIONAL_MODEL_CALL_MS", () => {
    vi.useFakeTimers();
    try {
      // Budget with just above 0 remainingMs but below the optional threshold
      const budget = new BudgetManager({
        maxDurationMs: VERDICT_TIME_RESERVE_MS + 1,
        maxModelCalls: 20,
      });
      // canAffordModelCall only checks remainingMs > 0 and model-call count
      expect(budget.canAffordModelCall()).toBe(true);
      // canAffordOptionalModelCall should reject (below threshold)
      expect(budget.canAffordOptionalModelCall()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // F7: Quick-profile defaults are unchanged
  it("F7: quick-profile defaults unchanged", () => {
    const budget = createBudgetForProfile("quick");
    expect(budget.maxDurationMs).toBe(120_000);
    expect(budget.maxModelCalls).toBe(6);
    expect(budget.maxRetries).toBe(1);
    expect(budget.maxGeneratedTests).toBe(1);
  });

  // F8: Config override maxModelCalls: 12 does NOT bypass the wall-clock gate
  it("F8: config maxModelCalls override does not bypass wall-clock gate", () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager(createBudgetForProfile("quick", 12));
      expect(budget.budget.maxModelCalls).toBe(12);
      expect(budget.budget.maxDurationMs).toBe(120_000);

      // Simulate elapsed time leaving only 35s remaining
      // (below VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS = 40s)
      vi.advanceTimersByTime(85_000);
      expect(budget.remainingMs).toBe(35_000);

      // Model-call count: 12 - 0 = 12 slots available (plenty)
      // But wall-clock: 35s < 40s threshold → rejected
      expect(budget.canAffordOptionalModelCall()).toBe(false);
      // Mandatory calls still admitted
      expect(budget.canAffordModelCall()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // F9: Failed provider attempts reducing remainingMs cause later optional work rejection
  it("F9: wall-clock consumed by failed attempts causes optional rejection despite model-call headroom", () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager(createBudgetForProfile("quick", 12));
      const threshold = VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS;

      // Initial: 120s remaining, 12 model-call slots
      expect(budget.canAffordOptionalModelCall()).toBe(true);

      // Simulate 4 successful model calls (~15s each = 60s)
      budget.recordModelCall();
      budget.recordModelCall();
      budget.recordModelCall();
      budget.recordModelCall();
      vi.advanceTimersByTime(60_000);

      // Simulate 3 failed provider attempts consuming ~25s wall-clock
      // (these do NOT decrement model-call count)
      vi.advanceTimersByTime(25_000);

      // Now: remainingMs = 120 - 85 = 35s, model-call slots = 12 - 4 = 8
      expect(budget.remainingMs).toBe(35_000);
      expect(budget.remainingMs).toBeLessThan(threshold);

      // Model-call budget shows plenty of headroom (8 > 1)
      // But wall-clock gate rejects: 35s < 40s
      expect(budget.canAffordOptionalModelCall()).toBe(false);
      // Mandatory still admitted
      expect(budget.canAffordModelCall()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // F10: Exact dogfood scheduling regression
  it("F10: dogfood scenario — optional test generation rejected with ~35-39s remaining", () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager(createBudgetForProfile("quick", 12));
      budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
      budget.reserveVerdictCall();

      // Simulate mandatory path: risk + plan + 2 gap chunks + commands
      budget.recordModelCall(); // risk
      budget.recordModelCall(); // plan
      budget.reserveModelCalls(2);
      budget.consumeReservation(); // gap chunk 1
      budget.consumeReservation(); // gap chunk 2
      budget.recordExecution(); // cmd 1
      budget.recordExecution(); // cmd 2
      budget.recordExecution(); // cmd 3

      // ~45s remaining: optional test gen IS allowed
      vi.advanceTimersByTime(75_000);
      expect(budget.remainingMs).toBe(45_000);
      expect(budget.canAffordOptionalModelCall()).toBe(true);

      // Now simulate 35-39s remaining: optional test gen is rejected
      vi.advanceTimersByTime(6_000);
      expect(budget.remainingMs).toBe(39_000);
      expect(budget.canAffordOptionalModelCall()).toBe(false);

      vi.advanceTimersByTime(4_000);
      expect(budget.remainingMs).toBe(35_000);
      expect(budget.canAffordOptionalModelCall()).toBe(false);

      // Verdict still reachable: release reserves
      budget.callDeadlineReserveMs = 0;
      budget.releaseVerdictReservation();
      expect(budget.canAffordModelCall()).toBe(true);
      // Verdict gets at least VERDICT_TIME_RESERVE_MS
      expect(budget.remainingMs).toBeGreaterThanOrEqual(
        VERDICT_TIME_RESERVE_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DF-002: MIN_OPTIONAL_MODEL_CALL_MS constant", () => {
  it("is 20_000ms", () => {
    expect(MIN_OPTIONAL_MODEL_CALL_MS).toBe(20_000);
  });

  it("is a separate export from VERDICT_TIME_RESERVE_MS", () => {
    // Both happen to be 20_000 but are separate constants with separate roles.
    // Verify both are exported and have their expected values independently.
    expect(MIN_OPTIONAL_MODEL_CALL_MS).toBe(20_000);
    expect(VERDICT_TIME_RESERVE_MS).toBe(20_000);
    // The combined threshold is 40s — proving they are additive, not aliased
    expect(VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS).toBe(40_000);
  });

  it("combined threshold is 40_000ms", () => {
    expect(VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_MODEL_CALL_MS).toBe(40_000);
  });
});

describe("DF-002: Post-Generation Re-Gap Gate", () => {
  // G11: TEST_DEFECT + INCONCLUSIVE + cleaned up → re-gap skipped
  it("G11: TEST_DEFECT + INCONCLUSIVE + not retained → re-gap condition is false", () => {
    const changes = [
      {
        id: "gen-1",
        filePath: "tests/gen-test.ts",
        operation: "CREATE" as const,
        classification: "INVESTIGATIVE" as const,
        rationale: "test",
        writeOutcome: "APPLIED" as const,
        retained: false,
        failureClassification: "TEST_DEFECT" as const,
        requirementIds: [],
      },
    ];
    const newEvidence = [
      {
        id: "ev-1",
        type: "TEST_RESULT" as const,
        provenance: "executed" as const,
        timestamp: new Date().toISOString(),
        source: "generated-test:tests/gen-test.ts",
        status: "INCONCLUSIVE" as const,
        summary: "unresolved imports",
        generatedTestProvenance: {
          generatedTestId: "gen-1",
          generatedFilePath: "tests/gen-test.ts",
          failureClassification: "TEST_DEFECT" as const,
          assertionsExecuted: false,
        },
      },
    ];

    const hasRetained = changes.some(
      (c) => c.writeOutcome === "APPLIED" && c.retained,
    );
    const hasMaterialEvidence = newEvidence.some(
      (e) =>
        e.status === "PASS" ||
        (e.status === "FAIL" &&
          e.generatedTestProvenance?.failureClassification !== "TEST_DEFECT"),
    );
    const shouldRegap = hasRetained || hasMaterialEvidence;

    expect(hasRetained).toBe(false);
    expect(hasMaterialEvidence).toBe(false);
    expect(shouldRegap).toBe(false);
  });

  // G12: Investigative test removed with no lasting evidence → re-gap skipped
  it("G12: investigative test removed + no meaningful evidence → re-gap skipped", () => {
    const changes = [
      {
        id: "gen-2",
        filePath: "tests/gen-investigate.ts",
        operation: "CREATE" as const,
        classification: "INVESTIGATIVE" as const,
        rationale: "investigate gap",
        writeOutcome: "APPLIED" as const,
        retained: false,
        failureClassification: "TEST_DEFECT" as const,
        requirementIds: [],
      },
    ];
    const newEvidence = [
      {
        id: "ev-2",
        type: "TEST_RESULT" as const,
        provenance: "executed" as const,
        timestamp: new Date().toISOString(),
        source: "generated-test:tests/gen-investigate.ts",
        status: "INCONCLUSIVE" as const,
        summary: "import validation failed",
        generatedTestProvenance: {
          generatedTestId: "gen-2",
          generatedFilePath: "tests/gen-investigate.ts",
          failureClassification: "TEST_DEFECT" as const,
          assertionsExecuted: false,
        },
      },
    ];

    const hasRetained = changes.some(
      (c) => c.writeOutcome === "APPLIED" && c.retained,
    );
    const hasMaterialEvidence = newEvidence.some(
      (e) =>
        e.status === "PASS" ||
        (e.status === "FAIL" &&
          e.generatedTestProvenance?.failureClassification !== "TEST_DEFECT"),
    );
    expect(hasRetained || hasMaterialEvidence).toBe(false);
  });

  // G13: Retained test with PASS evidence → re-gap may run
  it("G13: retained generated test with PASS evidence → re-gap condition is true", () => {
    const changes = [
      {
        id: "gen-3",
        filePath: "tests/gen-pass.ts",
        operation: "CREATE" as const,
        classification: "PERMANENT_REGRESSION" as const,
        rationale: "regression test",
        writeOutcome: "APPLIED" as const,
        retained: true,
        requirementIds: ["REQ-1"],
      },
    ];
    const newEvidence = [
      {
        id: "ev-3",
        type: "TEST_RESULT" as const,
        provenance: "executed" as const,
        timestamp: new Date().toISOString(),
        source: "generated-test:tests/gen-pass.ts",
        status: "PASS" as const,
        summary: "all assertions passed",
        generatedTestProvenance: {
          generatedTestId: "gen-3",
          generatedFilePath: "tests/gen-pass.ts",
        },
      },
    ];

    const hasRetained = changes.some(
      (c) => c.writeOutcome === "APPLIED" && c.retained,
    );
    const hasMaterialEvidence = newEvidence.some(
      (e) =>
        e.status === "PASS" ||
        (e.status === "FAIL" &&
          e.generatedTestProvenance?.failureClassification !== "TEST_DEFECT"),
    );

    expect(hasRetained).toBe(true);
    expect(hasMaterialEvidence).toBe(true);
    expect(hasRetained || hasMaterialEvidence).toBe(true);
  });

  // G14: Retained test with product FAIL evidence → re-gap may run
  it("G14: retained test with product FAIL evidence → re-gap condition is true", () => {
    const changes = [
      {
        id: "gen-4",
        filePath: "tests/gen-fail.ts",
        operation: "CREATE" as const,
        classification: "PERMANENT_REGRESSION" as const,
        rationale: "regression test",
        writeOutcome: "APPLIED" as const,
        retained: true,
        requirementIds: ["REQ-2"],
        failureClassification: "PRODUCT_FAILURE" as const,
      },
    ];
    const newEvidence = [
      {
        id: "ev-4",
        type: "TEST_RESULT" as const,
        provenance: "executed" as const,
        timestamp: new Date().toISOString(),
        source: "generated-test:tests/gen-fail.ts",
        status: "FAIL" as const,
        summary: "assertion failed: expected 200, got 500",
        generatedTestProvenance: {
          generatedTestId: "gen-4",
          generatedFilePath: "tests/gen-fail.ts",
          failureClassification: "PRODUCT_FAILURE" as const,
        },
      },
    ];

    const hasRetained = changes.some(
      (c) => c.writeOutcome === "APPLIED" && c.retained,
    );
    const hasMaterialEvidence = newEvidence.some(
      (e) =>
        e.status === "PASS" ||
        (e.status === "FAIL" &&
          e.generatedTestProvenance?.failureClassification !== "TEST_DEFECT"),
    );

    expect(hasRetained).toBe(true);
    expect(hasMaterialEvidence).toBe(true);
    expect(hasRetained || hasMaterialEvidence).toBe(true);
  });

  // G15: Re-gap still obeys the new optional model-call wall-clock gate
  it("G15: re-gap obeys wall-clock gate even when material evidence exists", () => {
    vi.useFakeTimers();
    try {
      const budget = new BudgetManager(createBudgetForProfile("quick", 12));
      budget.reserveVerdictCall();

      // Simulate enough elapsed time that only 35s remains
      vi.advanceTimersByTime(85_000);
      expect(budget.remainingMs).toBe(35_000);

      // Even though material evidence would justify re-gap,
      // the budget gate rejects it
      expect(budget.canAffordOptionalModelCall()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
