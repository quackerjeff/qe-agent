import { describe, it, expect } from "vitest";
import {
  QERequestSchema,
  CapabilitySchema,
  EvidenceSchema,
  FindingSchema,
  RiskAssessmentSchema,
  ValidationPlanSchema,
  ExecutionBudgetSchema,
  ExecutionMetricsSchema,
  RequirementSchema,
  RequirementAssessmentSchema,
  QEResultSchema,
  PartialQEResultSchema,
  ChangeAnalysisSchema,
  RepositoryProfileSchema,
} from "../src/types/index.js";

describe("QERequest schema", () => {
  it("validates a minimal request", () => {
    const result = QERequestSchema.safeParse({
      repositoryPath: "/tmp/repo",
      profile: "standard",
      mode: "repository",
    });
    expect(result.success).toBe(true);
  });

  it("validates a change-mode request", () => {
    const result = QERequestSchema.safeParse({
      repositoryPath: "/tmp/repo",
      profile: "deep",
      mode: "change",
      baselineRef: "main",
      targetRef: "feature/auth",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty repositoryPath", () => {
    const result = QERequestSchema.safeParse({
      repositoryPath: "",
      profile: "standard",
      mode: "repository",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid profile", () => {
    const result = QERequestSchema.safeParse({
      repositoryPath: "/tmp/repo",
      profile: "turbo",
      mode: "repository",
    });
    expect(result.success).toBe(false);
  });
});

describe("Requirement schema", () => {
  it("validates a requirement with acceptance criteria", () => {
    const result = RequirementSchema.safeParse({
      id: "REQ-001",
      description: "Users can log in with email and password",
      acceptanceCriteria: [
        { id: "AC-001", description: "Valid credentials return a session" },
        { id: "AC-002", description: "Invalid credentials show an error" },
      ],
      priority: "high",
    });
    expect(result.success).toBe(true);
  });

  it("validates a minimal requirement", () => {
    const result = RequirementSchema.safeParse({
      id: "REQ-001",
      description: "Basic requirement",
    });
    expect(result.success).toBe(true);
  });
});

describe("RequirementAssessment schema", () => {
  it("validates an assessment", () => {
    const result = RequirementAssessmentSchema.safeParse({
      requirementId: "REQ-001",
      status: "VERIFIED",
      evidenceIds: ["ev-1", "ev-2"],
      explanation: "All acceptance criteria verified through test execution",
    });
    expect(result.success).toBe(true);
  });
});

describe("Capability schema", () => {
  it("validates a capability", () => {
    const result = CapabilitySchema.safeParse({
      id: "node.vitest",
      type: "test_runner",
      provider: "javascript",
      available: true,
      confidence: 0.95,
    });
    expect(result.success).toBe(true);
  });

  it("rejects confidence out of range", () => {
    const result = CapabilitySchema.safeParse({
      id: "node.vitest",
      type: "test_runner",
      provider: "javascript",
      available: true,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("Evidence schema", () => {
  it("validates evidence", () => {
    const result = EvidenceSchema.safeParse({
      id: "ev-001",
      type: "TEST_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "vitest",
      status: "PASS",
      summary: "All 42 tests passed",
    });
    expect(result.success).toBe(true);
  });

  it("validates evidence with artifacts", () => {
    const result = EvidenceSchema.safeParse({
      id: "ev-002",
      type: "SCREENSHOT",
      provenance: "observed",
      timestamp: new Date().toISOString(),
      source: "playwright",
      status: "OBSERVED",
      summary: "Login page screenshot",
      artifacts: [{ path: "screenshots/login.png", type: "image/png" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("Finding schema", () => {
  it("validates a finding", () => {
    const result = FindingSchema.safeParse({
      id: "f-001",
      category: "DEFECT",
      severity: "HIGH",
      confidence: 0.85,
      title: "Auth bypass via empty password",
      description: "Login endpoint accepts empty password for existing users",
      evidenceIds: ["ev-001"],
      affectedFiles: ["src/auth/login.ts"],
      reproduction: {
        steps: ["POST /login with empty password", "Observe 200 response"],
        command: "curl -X POST ...",
      },
      proposedRemediation: "Add password length validation",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = FindingSchema.safeParse({
      id: "f-001",
      category: "DEFECT",
    });
    expect(result.success).toBe(false);
  });
});

describe("RiskAssessment schema", () => {
  it("validates a risk assessment", () => {
    const result = RiskAssessmentSchema.safeParse({
      level: "HIGH",
      factors: [
        {
          factor: "authorization",
          reason: "Shared auth middleware changed",
          weight: "high",
        },
      ],
      confidence: 0.91,
      summary: "High risk due to authorization changes",
    });
    expect(result.success).toBe(true);
  });
});

describe("ValidationPlan schema", () => {
  it("validates a validation plan", () => {
    const result = ValidationPlanSchema.safeParse({
      objectives: [{ id: "obj-1", description: "Verify auth flow" }],
      plannedActions: [
        {
          id: "act-1",
          type: "TEST",
          purpose: "Run auth unit tests",
          priority: 1,
        },
      ],
      identifiedRisks: ["Auth bypass risk"],
      expectedCapabilities: ["node.vitest"],
    });
    expect(result.success).toBe(true);
  });
});

describe("ChangeAnalysis schema", () => {
  it("validates a change analysis", () => {
    const result = ChangeAnalysisSchema.safeParse({
      summary: "Modified auth middleware",
      changedFiles: [
        { path: "src/auth/middleware.ts", changeType: "modified" },
        { path: "src/auth/utils.ts", changeType: "added" },
      ],
      affectedComponents: [{ name: "auth", impact: "Direct modification" }],
      behaviorChanges: [
        { description: "Session validation changed", risk: "HIGH" },
      ],
      potentialBlastRadius: [
        { area: "All API endpoints", reason: "Shared middleware" },
      ],
      unknowns: ["Impact on third-party integrations"],
    });
    expect(result.success).toBe(true);
  });
});

describe("ExecutionBudget schema", () => {
  it("validates a budget", () => {
    const result = ExecutionBudgetSchema.safeParse({
      maxDurationMs: 1200000,
      maxModelCalls: 50,
      maxRetries: 3,
      maxGeneratedTests: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative duration", () => {
    const result = ExecutionBudgetSchema.safeParse({
      maxDurationMs: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("ExecutionMetrics schema", () => {
  it("validates metrics", () => {
    const result = ExecutionMetricsSchema.safeParse({
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 5000,
      modelCalls: 3,
      commandsExecuted: 5,
      testsExecuted: 42,
      testsGenerated: 2,
      retries: 1,
      stateTransitions: 8,
    });
    expect(result.success).toBe(true);
  });
});

describe("RepositoryProfile schema", () => {
  it("validates a repository profile", () => {
    const result = RepositoryProfileSchema.safeParse({
      root: "/tmp/repo",
      git: { detected: true, root: "/tmp/repo", branch: "main" },
      languages: [
        {
          id: "typescript",
          name: "TypeScript",
          category: "language",
          version: "5.5",
          confidence: 0.95,
          evidence: [
            {
              source: "tsconfig.json",
              reason: "TypeScript configuration file",
            },
          ],
        },
      ],
      frameworks: [],
      packageManagers: [
        {
          id: "npm",
          name: "npm",
          category: "packageManager",
          confidence: 0.99,
          evidence: [
            {
              source: "package-lock.json",
              reason: "npm lockfile detected",
            },
          ],
        },
      ],
      buildSystems: [],
      testFrameworks: [
        {
          id: "vitest",
          name: "Vitest",
          category: "testFramework",
          confidence: 0.9,
          evidence: [
            {
              source: "vitest.config.ts",
              reason: "Vitest configuration file",
            },
          ],
        },
      ],
      ciSystems: [],
      applications: [],
      documentation: [{ path: "README.md", type: "readme" }],
      commands: [
        {
          id: "test",
          name: "test",
          category: "TEST",
          command: "npm test",
          source: "package.json",
          confidence: 0.95,
        },
      ],
      capabilities: [
        {
          id: "node.vitest",
          type: "test_runner",
          provider: "javascript",
          available: true,
          confidence: 0.9,
        },
      ],
      confidence: 0.85,
    });
    expect(result.success).toBe(true);
  });
});

function makeRepositoryProfile() {
  return {
    root: "/tmp/repo",
    git: { detected: false },
    languages: [
      {
        id: "typescript",
        name: "TypeScript",
        category: "language" as const,
        confidence: 0.95,
        evidence: [
          { source: "tsconfig.json", reason: "TypeScript configuration file" },
        ],
      },
    ],
    frameworks: [],
    packageManagers: [],
    buildSystems: [],
    testFrameworks: [],
    ciSystems: [],
    applications: [],
    documentation: [],
    commands: [],
    capabilities: [],
    confidence: 0.85,
  };
}

function makeRiskAssessment() {
  return {
    level: "LOW" as const,
    factors: [],
    confidence: 0.9,
    summary: "Low risk change",
  };
}

function makeValidationPlan() {
  return {
    objectives: [{ id: "obj-1", description: "Validate change" }],
    plannedActions: [],
    identifiedRisks: [],
    expectedCapabilities: [],
  };
}

function makeMetrics() {
  return {
    startTime: new Date().toISOString(),
    modelCalls: 0,
    commandsExecuted: 0,
    testsExecuted: 0,
    testsGenerated: 0,
    retries: 0,
    stateTransitions: 0,
  };
}

describe("QEResult schema (canonical completed result)", () => {
  it("validates a complete result with all required fields", () => {
    const result = QEResultSchema.safeParse({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      repository: { path: "/tmp/repo", name: "my-project" },
      target: "abc123",
      profile: "standard",
      repositoryProfile: makeRepositoryProfile(),
      riskAssessment: makeRiskAssessment(),
      validationPlan: makeValidationPlan(),
      evidence: [],
      findings: [],
      requirements: [],
      remainingGaps: [],
      verdict: "PASS",
      confidence: "HIGH",
      summary: "All validation passed",
      recommendedNextActions: [],
      metrics: makeMetrics(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects PASS result missing repositoryProfile", () => {
    const result = QEResultSchema.safeParse({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      repository: { path: "/tmp/repo" },
      target: "abc123",
      profile: "standard",
      riskAssessment: makeRiskAssessment(),
      validationPlan: makeValidationPlan(),
      evidence: [],
      findings: [],
      requirements: [],
      remainingGaps: [],
      verdict: "PASS",
      confidence: "HIGH",
      summary: "All validation passed",
      recommendedNextActions: [],
      metrics: makeMetrics(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects PASS result missing riskAssessment", () => {
    const result = QEResultSchema.safeParse({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      repository: { path: "/tmp/repo" },
      target: "abc123",
      profile: "standard",
      repositoryProfile: makeRepositoryProfile(),
      validationPlan: makeValidationPlan(),
      evidence: [],
      findings: [],
      requirements: [],
      remainingGaps: [],
      verdict: "PASS",
      confidence: "HIGH",
      summary: "All validation passed",
      recommendedNextActions: [],
      metrics: makeMetrics(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects PASS result missing validationPlan", () => {
    const result = QEResultSchema.safeParse({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      repository: { path: "/tmp/repo" },
      target: "abc123",
      profile: "standard",
      repositoryProfile: makeRepositoryProfile(),
      riskAssessment: makeRiskAssessment(),
      evidence: [],
      findings: [],
      requirements: [],
      remainingGaps: [],
      verdict: "PASS",
      confidence: "HIGH",
      summary: "All validation passed",
      recommendedNextActions: [],
      metrics: makeMetrics(),
    });
    expect(result.success).toBe(false);
  });

  it("allows optional changeAnalysis", () => {
    const result = QEResultSchema.safeParse({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      repository: { path: "/tmp/repo" },
      target: "abc123",
      profile: "standard",
      repositoryProfile: makeRepositoryProfile(),
      riskAssessment: makeRiskAssessment(),
      validationPlan: makeValidationPlan(),
      evidence: [],
      findings: [],
      requirements: [],
      remainingGaps: [],
      verdict: "PASS",
      confidence: "HIGH",
      summary: "All validation passed",
      recommendedNextActions: [],
      metrics: makeMetrics(),
    });
    expect(result.success).toBe(true);
  });

  it("allows optional baseline", () => {
    const result = QEResultSchema.safeParse({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      repository: { path: "/tmp/repo" },
      baseline: "main",
      target: "abc123",
      profile: "standard",
      repositoryProfile: makeRepositoryProfile(),
      riskAssessment: makeRiskAssessment(),
      validationPlan: makeValidationPlan(),
      evidence: [],
      findings: [],
      requirements: [],
      remainingGaps: [],
      verdict: "FAIL",
      confidence: "HIGH",
      summary: "Defect found",
      recommendedNextActions: ["Fix the defect"],
      metrics: makeMetrics(),
    });
    expect(result.success).toBe(true);
  });
});

describe("PartialQEResult schema (in-progress state)", () => {
  it("accepts a result with missing repositoryProfile, riskAssessment, validationPlan", () => {
    const result = PartialQEResultSchema.safeParse({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      repository: { path: "/tmp/repo" },
      target: "abc123",
      profile: "standard",
      evidence: [],
      findings: [],
      requirements: [],
      remainingGaps: [],
      metrics: makeMetrics(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts a result without verdict or confidence", () => {
    const result = PartialQEResultSchema.safeParse({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      repository: { path: "/tmp/repo" },
      target: "abc123",
      profile: "standard",
      evidence: [],
      findings: [],
      requirements: [],
      remainingGaps: [],
      metrics: makeMetrics(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdict).toBeUndefined();
      expect(result.data.confidence).toBeUndefined();
    }
  });
});
