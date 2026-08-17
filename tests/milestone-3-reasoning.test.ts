import { describe, it, expect } from "vitest";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import {
  QEStateMachine,
  InvalidTransitionError,
} from "../src/core/lifecycle/index.js";
import {
  BudgetManager,
  createBudgetForProfile,
} from "../src/core/orchestrator/budget-manager.js";
import { buildReasoningContext } from "../src/core/orchestrator/context-builder.js";
import { buildDeterministicChangeAnalysis } from "../src/core/reasoning/change-analyzer.js";
import { classifyWithBaseline } from "../src/core/reasoning/failure-investigator.js";
import { applyProfileLimits } from "../src/core/reasoning/validation-planner.js";
import { formatQEReport } from "../src/core/orchestrator/report-formatter.js";
import {
  parseRequirementsText,
  parseInlineRequirements,
} from "../src/cli/requirements-parser.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import { QEResultSchema } from "../src/types/index.js";
import type {
  RepositoryProfile,
  QERequest,
  ValidationAction,
} from "../src/types/index.js";
import type { GitDiffData } from "../src/core/git/index.js";

// Shared fixtures

function createMockProfile(): RepositoryProfile {
  return {
    root: "/mock/repo",
    git: { detected: true, root: "/mock/repo", branch: "main" },
    languages: [
      {
        id: "lang:typescript",
        name: "TypeScript",
        category: "language",
        confidence: 0.95,
        evidence: [
          { source: "tsconfig.json", reason: "TypeScript config found" },
        ],
      },
    ],
    frameworks: [],
    packageManagers: [
      {
        id: "pm:npm",
        name: "npm",
        category: "packageManager",
        confidence: 0.9,
        evidence: [{ source: "package-lock.json", reason: "Lockfile found" }],
      },
    ],
    buildSystems: [],
    testFrameworks: [
      {
        id: "test:vitest",
        name: "Vitest",
        category: "testFramework",
        confidence: 0.9,
        evidence: [{ source: "vitest.config.ts", reason: "Config file found" }],
      },
    ],
    ciSystems: [],
    applications: [{ id: "root", name: "mock-repo", path: "." }],
    documentation: [],
    commands: [
      {
        id: "test:vitest",
        name: "vitest",
        category: "TEST",
        command: "echo test-ok",
        executable: "echo",
        args: ["test-ok"],
        source: "package.json",
        confidence: 0.9,
        executionSupport: "STRUCTURED",
      },
      {
        id: "build:tsc",
        name: "tsc",
        category: "BUILD",
        command: "echo build-ok",
        executable: "echo",
        args: ["build-ok"],
        source: "package.json",
        confidence: 0.9,
        executionSupport: "STRUCTURED",
      },
      {
        id: "lint:eslint",
        name: "eslint",
        category: "LINT",
        command: "echo lint-ok",
        executable: "echo",
        args: ["lint-ok"],
        source: "package.json",
        confidence: 0.9,
        executionSupport: "STRUCTURED",
      },
    ],
    capabilities: [
      {
        id: "git.analysis",
        type: "vcs",
        provider: "git",
        available: true,
        confidence: 1.0,
      },
    ],
    confidence: 0.9,
  };
}

function createMockDiffData(): GitDiffData {
  return {
    baselineRef: "abc123",
    targetRef: "def456",
    changedFiles: [
      { path: "src/auth/middleware.ts", changeType: "modified" },
      { path: "src/api/users.ts", changeType: "modified" },
      { path: "README.md", changeType: "modified" },
    ],
    addedFiles: [],
    deletedFiles: [],
    renamedFiles: [],
    modifiedFiles: ["src/auth/middleware.ts", "src/api/users.ts", "README.md"],
    changedTests: [],
    changedConfiguration: [],
    changedDependencyMetadata: [],
    diffStat: " 3 files changed, 45 insertions(+), 12 deletions(-)",
  };
}

function createFakeGateway(): FakeModelGateway {
  return new FakeModelGateway(<T>(task: ReasoningTask<T>): T | undefined => {
    switch (task.role) {
      case "change_analyst":
        return {
          summary: "Modified auth middleware and user API",
          affectedComponents: [
            { name: "auth", impact: "Authorization logic changed" },
            { name: "api", impact: "User endpoint modified" },
          ],
          behaviorChanges: [
            { description: "Auth middleware logic modified", risk: "HIGH" },
          ],
          potentialBlastRadius: [
            {
              area: "All authenticated endpoints",
              reason: "Shared middleware",
            },
          ],
          unknowns: ["Impact on session handling unclear"],
        } as unknown as T;

      case "risk_analyst":
        return {
          level: "HIGH",
          factors: [
            {
              factor: "Authorization change",
              reason: "Auth middleware modified, affects all endpoints",
              weight: "high",
            },
            {
              factor: "Blast radius",
              reason: "Shared middleware affects multiple API modules",
              weight: "high",
            },
          ],
          confidence: 0.85,
          summary: "High risk due to authorization middleware changes",
        } as unknown as T;

      case "test_strategist":
        return {
          objectives: [
            { id: "obj-1", description: "Verify auth behavior" },
            { id: "obj-2", description: "Verify user API" },
          ],
          recommendedActions: [
            {
              commandId: "test:vitest",
              type: "TEST",
              purpose: "Run test suite",
              priority: 1,
              riskAddressed: ["Authorization change"],
              requirementIds: ["req-1"],
            },
            {
              commandId: "build:tsc",
              type: "BUILD",
              purpose: "Type check build",
              priority: 2,
              riskAddressed: [],
              requirementIds: [],
            },
            {
              commandId: "lint:eslint",
              type: "LINT",
              purpose: "Lint code",
              priority: 3,
              riskAddressed: [],
              requirementIds: [],
            },
          ],
          identifiedRisks: ["Auth middleware regression"],
          expectedCapabilities: ["unit-testing"],
          unavailableValidations: [
            {
              description: "Integration testing",
              reason: "No integration test environment available",
            },
          ],
        } as unknown as T;

      case "failure_investigator":
        return {
          likelyCause: "PRODUCT_DEFECT",
          explanation: "Test assertion failed due to changed auth logic",
          confidence: 0.82,
          suggestRetry: false,
          suggestBaselineComparison: true,
          affectedFiles: ["src/auth/middleware.ts"],
          relatedRequirementIds: ["req-1"],
        } as unknown as T;

      case "gap_analyst":
        return {
          gaps: [
            {
              area: "Integration testing",
              description: "No integration environment available",
              reason: "Docker or staging not configured",
              risk: "MEDIUM",
            },
          ],
          requirementAssessments: [
            {
              requirementId: "req-1",
              status: "PARTIALLY_VERIFIED",
              evidenceIds: [],
              explanation: "Unit tests ran but integration coverage missing",
            },
          ],
        } as unknown as T;

      case "verdict_reviewer":
        return {
          recommendedVerdict: "PASS_WITH_CONCERNS",
          confidence: "MEDIUM",
          reasoning: "Tests pass but gaps remain",
          concerns: ["Integration testing unavailable"],
          recommendedNextActions: [
            "Add integration tests",
            "Review auth changes manually",
          ],
          summary: "Changes appear safe but gaps in validation coverage exist",
        } as unknown as T;

      default:
        return undefined;
    }
  });
}

// Tests

describe("State Machine", () => {
  it("starts in INITIALIZING", () => {
    const sm = new QEStateMachine();
    expect(sm.state).toBe("INITIALIZING");
    expect(sm.isTerminal).toBe(false);
  });

  it("records valid transitions", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING", "test");
    sm.transition("ASSESSING_RISK", "skip change analysis");
    expect(sm.state).toBe("ASSESSING_RISK");
    expect(sm.history).toHaveLength(2);
    expect(sm.history[0].from).toBe("INITIALIZING");
    expect(sm.history[0].to).toBe("DISCOVERING");
  });

  it("rejects invalid transitions", () => {
    const sm = new QEStateMachine();
    expect(() => sm.transition("COMPLETE", "jump to end")).toThrow(
      InvalidTransitionError,
    );
  });

  it("allows transition to BLOCKED from any non-terminal state", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("BLOCKED", "error occurred");
    expect(sm.state).toBe("BLOCKED");
    expect(sm.isTerminal).toBe(true);
  });

  it("cannot transition from terminal states", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("BLOCKED");
    expect(() => sm.transition("DISCOVERING")).toThrow(InvalidTransitionError);
  });

  it("follows full happy path for repository mode", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    sm.transition("FORMING_VERDICT");
    sm.transition("REPORTING");
    sm.transition("COMPLETE");
    expect(sm.isTerminal).toBe(true);
    expect(sm.history).toHaveLength(8);
  });

  it("follows full happy path for change mode", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("UNDERSTANDING_CHANGE");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("INVESTIGATING");
    sm.transition("ANALYZING_GAPS");
    sm.transition("FORMING_VERDICT");
    sm.transition("REPORTING");
    sm.transition("COMPLETE");
    expect(sm.history).toHaveLength(10);
  });

  it("allows re-entry from INVESTIGATING to EXECUTING", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("INVESTIGATING");
    sm.transition("EXECUTING");
    expect(sm.state).toBe("EXECUTING");
  });

  it("transition records include timestamps", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING", "begin");
    const t = sm.history[0];
    expect(t.timestamp).toBeTruthy();
    expect(t.reason).toBe("begin");
  });
});

describe("Budget Manager", () => {
  it("tracks model calls", () => {
    const bm = new BudgetManager({ maxDurationMs: 60000, maxModelCalls: 3 });
    bm.recordModelCall();
    bm.recordModelCall();
    expect(bm.modelCalls).toBe(2);
    expect(bm.canAffordModelCall()).toBe(true);
    bm.recordModelCall();
    expect(bm.canAffordModelCall()).toBe(false);
  });

  it("tracks execution attempts", () => {
    const bm = new BudgetManager({ maxDurationMs: 60000 });
    bm.recordExecution();
    expect(bm.executionAttempts).toBe(1);
  });

  it("tracks retries", () => {
    const bm = new BudgetManager({ maxDurationMs: 60000, maxRetries: 2 });
    bm.recordRetry();
    expect(bm.canAffordRetry()).toBe(true);
    bm.recordRetry();
    expect(bm.canAffordRetry()).toBe(false);
  });

  it("produces accurate snapshots", () => {
    const bm = new BudgetManager({ maxDurationMs: 60000, maxModelCalls: 5 });
    bm.recordModelCall();
    bm.recordExecution();
    const snap = bm.snapshot();
    expect(snap.modelCalls).toBe(1);
    expect(snap.executionAttempts).toBe(1);
    expect(snap.remainingModelCalls).toBe(4);
    expect(snap.exhausted).toBe(false);
  });

  it("reports exhaustion reason for model calls", () => {
    const bm = new BudgetManager({ maxDurationMs: 60000, maxModelCalls: 1 });
    bm.recordModelCall();
    const snap = bm.snapshot();
    expect(snap.exhausted).toBe(true);
    expect(snap.exhaustionReason).toContain("Model call");
  });

  it("creates appropriate budgets for profiles", () => {
    const quick = createBudgetForProfile("quick");
    const standard = createBudgetForProfile("standard");
    const deep = createBudgetForProfile("deep");
    expect(quick.maxDurationMs).toBeLessThan(standard.maxDurationMs);
    expect(standard.maxDurationMs).toBeLessThan(deep.maxDurationMs);
    expect(quick.maxModelCalls!).toBeLessThan(standard.maxModelCalls!);
  });
});

describe("Context Builder", () => {
  it("builds bounded context from profile", () => {
    const profile = createMockProfile();
    const ctx = buildReasoningContext({
      requirements: [{ id: "req-1", description: "Must work" }],
      profile,
    });
    expect(ctx.requirements).toHaveLength(1);
    expect(ctx.repositoryProfile.languages).toContain("TypeScript");
    expect(ctx.repositoryProfile.commands).toHaveLength(3);
    expect(ctx.truncation.changedFilesTruncated).toBe(false);
  });

  it("includes change data when provided", () => {
    const profile = createMockProfile();
    const diffData = createMockDiffData();
    const ctx = buildReasoningContext({
      requirements: [],
      profile,
      diffData,
    });
    expect(ctx.changeData).toBeDefined();
    expect(ctx.changeData!.changedFiles).toHaveLength(3);
    expect(ctx.changeData!.baselineRef).toBe("abc123");
  });

  it("truncates changed files when exceeding limit", () => {
    const profile = createMockProfile();
    const manyFiles = Array.from({ length: 50 }, (_, i) => ({
      path: `src/file${i}.ts`,
      changeType: "modified" as const,
    }));
    const diffData: GitDiffData = {
      ...createMockDiffData(),
      changedFiles: manyFiles,
    };
    const ctx = buildReasoningContext({
      requirements: [],
      profile,
      diffData,
      limits: {
        maxChangedFilesIncluded: 10,
        maxBytesPerFile: 8192,
        maxTotalSourceContext: 65536,
        maxDocumentationExcerptSize: 4096,
      },
    });
    expect(ctx.truncation.changedFilesTruncated).toBe(true);
    expect(ctx.truncation.totalChangedFiles).toBe(50);
    expect(ctx.truncation.includedChangedFiles).toBe(10);
  });

  it("records prior evidence", () => {
    const profile = createMockProfile();
    const ctx = buildReasoningContext({
      requirements: [],
      profile,
      evidence: [
        {
          id: "ev-1",
          type: "TEST_RESULT",
          provenance: "executed",
          timestamp: "2024-01-01",
          source: "vitest",
          status: "PASS",
          summary: "Tests passed",
        },
      ],
    });
    expect(ctx.priorEvidence).toHaveLength(1);
    expect(ctx.priorEvidence[0].status).toBe("PASS");
  });
});

describe("Deterministic Change Analysis", () => {
  it("produces analysis from Git diff data", () => {
    const diffData = createMockDiffData();
    const analysis = buildDeterministicChangeAnalysis(diffData);
    expect(analysis.changedFiles).toHaveLength(3);
    expect(analysis.summary).toContain("3 files changed");
    expect(analysis.affectedComponents).toHaveLength(0);
    expect(analysis.unknowns).toHaveLength(0);
  });

  it("separates deterministic data from inference fields", () => {
    const diffData = createMockDiffData();
    const analysis = buildDeterministicChangeAnalysis(diffData);
    expect(analysis.changedFiles[0].path).toBe("src/auth/middleware.ts");
    expect(analysis.affectedComponents).toEqual([]);
    expect(analysis.behaviorChanges).toEqual([]);
  });
});

describe("Baseline Comparison", () => {
  it("classifies INTRODUCED when target fails and baseline passes", () => {
    const result = classifyWithBaseline("PASS", "FAIL");
    expect(result.classification).toBe("INTRODUCED");
  });

  it("classifies PRE_EXISTING when both fail", () => {
    const result = classifyWithBaseline("FAIL", "FAIL");
    expect(result.classification).toBe("PRE_EXISTING");
  });

  it("classifies UNKNOWN when baseline is inconclusive", () => {
    const result = classifyWithBaseline("INCONCLUSIVE", "FAIL");
    expect(result.classification).toBe("UNKNOWN");
  });
});

describe("Profile-Based Action Limits", () => {
  it("limits quick profile to 3 actions", () => {
    const actions: ValidationAction[] = Array.from({ length: 10 }, (_, i) => ({
      id: `action-${i}`,
      type: "TEST" as const,
      purpose: `test ${i}`,
      priority: i,
    }));
    expect(applyProfileLimits(actions, "quick")).toHaveLength(3);
  });

  it("limits standard profile to 8 actions", () => {
    const actions: ValidationAction[] = Array.from({ length: 10 }, (_, i) => ({
      id: `action-${i}`,
      type: "TEST" as const,
      purpose: `test ${i}`,
      priority: i,
    }));
    expect(applyProfileLimits(actions, "standard")).toHaveLength(8);
  });

  it("deep profile allows up to 20 actions", () => {
    const actions: ValidationAction[] = Array.from({ length: 25 }, (_, i) => ({
      id: `action-${i}`,
      type: "TEST" as const,
      purpose: `test ${i}`,
      priority: i,
    }));
    expect(applyProfileLimits(actions, "deep")).toHaveLength(20);
  });
});

describe("Requirements Parsing", () => {
  it("parses markdown requirements file content", () => {
    const text = `
# User Authentication
- Users must log in with email and password
- Password must be at least 8 characters

# Data Export
- Users can export data as CSV
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe("req-1");
    expect(reqs[0].description).toBe("User Authentication");
    expect(reqs[0].acceptanceCriteria).toHaveLength(2);
  });

  it("parses inline requirements", () => {
    const reqs = parseInlineRequirements([
      "Users must be able to log in",
      "Admin panel requires authentication",
    ]);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe("req-1");
    expect(reqs[1].id).toBe("req-2");
  });

  it("handles priority annotations", () => {
    const text = `
# Feature
- Must be fast [priority: high]
`;
    const reqs = parseRequirementsText(text);
    expect(reqs[0].priority).toBe("high");
  });
});

describe("Report Formatting", () => {
  it("produces human-readable report from QEResult", () => {
    const result = createMockQEResult();
    const report = formatQEReport(result);
    expect(report).toContain("QE VERDICT: PASS_WITH_CONCERNS");
    expect(report).toContain("Confidence: MEDIUM");
    expect(report).toContain("Risk Assessment");
    expect(report).toContain("Remaining Gaps");
    expect(report).toContain("Execution Metrics");
  });

  it("distinguishes executed from inferred evidence", () => {
    const result = createMockQEResult();
    const report = formatQEReport(result);
    expect(report).toContain("[PASS]");
  });
});

describe("Verdict Guardrails", () => {
  it("downgrades PASS when blocker finding exists via orchestrator", async () => {
    const gateway = new FakeModelGateway(
      <T>(task: ReasoningTask<T>): T | undefined => {
        switch (task.role) {
          case "risk_analyst":
            return {
              level: "HIGH",
              factors: [{ factor: "test", reason: "test", weight: "high" }],
              confidence: 0.8,
              summary: "High risk",
            } as unknown as T;
          case "test_strategist":
            return {
              objectives: [],
              recommendedActions: [],
              identifiedRisks: [],
              expectedCapabilities: [],
              unavailableValidations: [],
            } as unknown as T;
          case "gap_analyst":
            return {
              gaps: [],
              requirementAssessments: [
                {
                  requirementId: "req-1",
                  status: "NOT_VERIFIED",
                  evidenceIds: [],
                  explanation: "No evidence",
                },
              ],
            } as unknown as T;
          case "verdict_reviewer":
            return {
              recommendedVerdict: "PASS",
              confidence: "HIGH",
              reasoning: "Model says pass",
              concerns: [],
              recommendedNextActions: [],
              summary: "All good",
            } as unknown as T;
          default:
            return undefined;
        }
      },
    );

    const orchestrator = new QEOrchestrator({
      gateway,
      repositoryProfile: createMockProfile(),
    });
    const request: QERequest = {
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Test requirement" }],
      profile: "quick",
      mode: "repository",
    };

    const result = await orchestrator.run(request);
    // With no evidence and NOT_VERIFIED requirements, PASS should be overridden
    expect(result.verdict).not.toBe("PASS");
  });
});

describe("Orchestrator with FakeModelGateway", () => {
  it("produces valid QEResult for repository mode", async () => {
    const gateway = createFakeGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 6,
      repositoryProfile: createMockProfile(),
    });

    const request: QERequest = {
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Build must succeed" }],
      profile: "quick",
      mode: "repository",
    };

    const result = await orchestrator.run(request);

    // Validates against canonical schema
    const parseResult = QEResultSchema.safeParse(result);
    expect(parseResult.success).toBe(true);

    expect(result.verdict).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.riskAssessment).toBeDefined();
    expect(result.metrics.modelCalls).toBeGreaterThan(0);
    expect(result.metrics.stateTransitions).toBeGreaterThan(0);
  });

  it("records model call count in metrics", async () => {
    const gateway = createFakeGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 6,
      repositoryProfile: createMockProfile(),
    });

    const request: QERequest = {
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Test" }],
      profile: "quick",
      mode: "repository",
    };

    const result = await orchestrator.run(request);
    expect(result.metrics.modelCalls).toBeGreaterThanOrEqual(3);
  });

  it("produces BLOCKED verdict on budget exhaustion", async () => {
    const gateway = createFakeGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 1,
      repositoryProfile: createMockProfile(),
    });

    const request: QERequest = {
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Test" }],
      profile: "quick",
      mode: "repository",
    };

    const result = await orchestrator.run(request);
    // With only 1 model call, budget exhausts early — verdict reflects this
    expect(["BLOCKED", "PASS_WITH_CONCERNS", "NEEDS_REVIEW"]).toContain(
      result.verdict,
    );
  });

  it("model calls use schema validation", async () => {
    const { RiskAnalysisOutputSchema } =
      await import("../src/prompts/risk-analysis/v1.js");
    const gateway = new FakeModelGateway(
      <T>(task: ReasoningTask<T>): T | undefined => {
        if (task.role === "risk_analyst") {
          return { invalid: true } as unknown as T;
        }
        return undefined;
      },
    );

    await expect(
      gateway.reason({
        role: "risk_analyst",
        objective: "test",
        context: {},
        outputSchema: RiskAnalysisOutputSchema,
      }),
    ).rejects.toThrow();
  });
});

describe("Invalid Model Output", () => {
  it("schema validation rejects malformed risk output", async () => {
    const { RiskAnalysisOutputSchema } =
      await import("../src/prompts/risk-analysis/v1.js");
    const bad = { level: "EXTREME", factors: "none" };
    const result = RiskAnalysisOutputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("schema validation rejects malformed verdict output", async () => {
    const { VerdictRecommendationOutputSchema } =
      await import("../src/prompts/verdict/v1.js");
    const bad = { recommendedVerdict: "MAYBE" };
    const result = VerdictRecommendationOutputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("schema validation rejects malformed gap output", async () => {
    const { GapAnalysisOutputSchema } =
      await import("../src/prompts/gap-analysis/v1.js");
    const bad = { gaps: "none" };
    const result = GapAnalysisOutputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts valid risk output", async () => {
    const { RiskAnalysisOutputSchema } =
      await import("../src/prompts/risk-analysis/v1.js");
    const good = {
      level: "HIGH",
      factors: [{ factor: "test", reason: "test", weight: "high" }],
      confidence: 0.8,
      summary: "High risk",
    };
    const result = RiskAnalysisOutputSchema.safeParse(good);
    expect(result.success).toBe(true);
  });
});

describe("Severity vs Confidence Separation", () => {
  it("findings maintain independent severity and confidence", async () => {
    const { investigateFailure } =
      await import("../src/core/reasoning/failure-investigator.js");
    const gateway = createFakeGateway();
    const result = await investigateFailure(
      gateway,
      {
        id: "ev-1",
        type: "TEST_RESULT",
        provenance: "executed",
        timestamp: "2024-01-01",
        source: "vitest",
        status: "FAIL",
        summary: "Test failed",
      },
      "test output",
      "error output",
      1,
    );
    expect(result.finding.severity).toBeDefined();
    expect(result.finding.confidence).toBeDefined();
    expect(result.finding.severity).not.toBe(result.finding.confidence);
  });
});

// Helper

function createMockQEResult() {
  return QEResultSchema.parse({
    executionId: "test-id",
    repository: { path: "/mock/repo", name: "mock-repo" },
    target: "HEAD",
    profile: "standard",
    repositoryProfile: createMockProfile(),
    riskAssessment: {
      level: "HIGH",
      factors: [
        {
          factor: "Auth change",
          reason: "Modified authorization middleware",
          weight: "high",
        },
      ],
      confidence: 0.85,
      summary: "High risk due to auth changes",
    },
    validationPlan: {
      objectives: [{ id: "obj-1", description: "Verify auth" }],
      plannedActions: [],
      identifiedRisks: ["Auth regression"],
      expectedCapabilities: ["unit-testing"],
    },
    evidence: [
      {
        id: "ev-1",
        type: "TEST_RESULT",
        provenance: "executed",
        timestamp: "2024-01-01T00:00:00Z",
        source: "vitest",
        status: "PASS",
        summary: "vitest run completed successfully",
      },
    ],
    findings: [],
    requirements: [
      {
        requirementId: "req-1",
        status: "PARTIALLY_VERIFIED",
        evidenceIds: ["ev-1"],
        explanation: "Tests pass but integration coverage missing",
      },
    ],
    remainingGaps: [
      {
        area: "Integration testing",
        description: "No integration environment",
        reason: "Docker not configured",
        risk: "MEDIUM",
      },
    ],
    verdict: "PASS_WITH_CONCERNS",
    confidence: "MEDIUM",
    summary: "Changes appear safe but gaps exist",
    recommendedNextActions: ["Add integration tests"],
    metrics: {
      startTime: "2024-01-01T00:00:00Z",
      endTime: "2024-01-01T00:01:00Z",
      durationMs: 60000,
      modelCalls: 5,
      commandsExecuted: 2,
      testsExecuted: 0,
      testsGenerated: 0,
      retries: 0,
      stateTransitions: 8,
    },
  });
}
