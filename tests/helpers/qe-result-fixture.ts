import type { QEResult, Finding } from "../../src/types/index.js";

/**
 * Shared QEResult/Finding test fixtures for integration tests
 * (GitHub publishing, OpenCode publishing).
 */

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    category: "DEFECT",
    severity: "HIGH",
    confidence: 0.9,
    title: "Null pointer in handler",
    description: "The handler does not check for null input",
    evidenceIds: ["ev-1"],
    affectedFiles: ["src/handler.ts"],
    ...overrides,
  };
}

export function makeResult(
  overrides: Partial<QEResult> = {},
  defaults: { executionId?: string } = {},
): QEResult {
  return {
    executionId: defaults.executionId ?? "exec-test-001",
    repository: { path: "/repo", name: "test-repo" },
    target: "abc123",
    profile: "standard",
    repositoryProfile: {
      root: "/repo",
      git: { detected: true },
      languages: [],
      frameworks: [],
      packageManagers: [],
      buildSystems: [],
      testFrameworks: [],
      ciSystems: [],
      applications: [],
      documentation: [],
      commands: [],
      capabilities: [],
      confidence: 0.9,
    },
    riskAssessment: {
      level: "MEDIUM",
      factors: [],
      confidence: 0.8,
      summary: "Medium risk change",
    },
    validationPlan: {
      objectives: [{ id: "obj-1", description: "Validate change" }],
      plannedActions: [],
      identifiedRisks: [],
      expectedCapabilities: [],
    },
    evidence: [
      {
        id: "ev-1",
        type: "TEST_RESULT",
        provenance: "executed",
        timestamp: new Date().toISOString(),
        source: "vitest",
        status: "PASS",
        summary: "All tests passed",
      },
    ],
    findings: [],
    requirements: [],
    remainingGaps: [],
    verdict: "PASS",
    confidence: "HIGH",
    summary: "All validations passed",
    recommendedNextActions: [],
    metrics: {
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 5000,
      modelCalls: 4,
      commandsExecuted: 3,
      testsExecuted: 10,
      testsGenerated: 0,
      retries: 0,
      stateTransitions: 8,
    },
    ...overrides,
  };
}
