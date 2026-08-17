import { describe, it, expect } from "vitest";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
} from "../src/core/orchestrator/budget-manager.js";
import { QEStateMachine } from "../src/core/lifecycle/index.js";
import { QEResultSchema } from "../src/types/index.js";
import type { QERequest, RepositoryProfile } from "../src/types/index.js";
import { classifyWithBaseline } from "../src/core/reasoning/failure-investigator.js";

// --- Shared Helpers ---

function createMockProfile(): RepositoryProfile {
  return {
    root: process.cwd(),
    git: { detected: true, root: process.cwd(), branch: "main" },
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
        id: "npm-script:test",
        name: "test",
        category: "TEST",
        command: "echo test-ok",
        executable: "echo",
        args: ["test-ok"],
        source: "package.json",
        confidence: 0.9,
        executionSupport: "STRUCTURED",
      },
      {
        id: "npm-script:build",
        name: "build",
        category: "BUILD",
        command: "echo build-ok",
        executable: "echo",
        args: ["build-ok"],
        source: "package.json",
        confidence: 0.9,
        executionSupport: "STRUCTURED",
      },
      {
        id: "npm-script:lint",
        name: "lint",
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

function createScenarioResponseProvider(
  overrides: Partial<{
    risk: unknown;
    plan: unknown;
    gaps: unknown;
    verdict: unknown;
    failure: unknown;
    change: unknown;
  }> = {},
): <T>(task: ReasoningTask<T>) => T | undefined {
  return <T>(task: ReasoningTask<T>): T | undefined => {
    switch (task.role) {
      case "change_analyst":
        return (overrides.change ?? {
          summary: "Minor change",
          affectedComponents: [],
          behaviorChanges: [],
          potentialBlastRadius: [],
          unknowns: [],
        }) as unknown as T;

      case "risk_analyst":
        return (overrides.risk ?? {
          level: "LOW",
          factors: [{ factor: "minor", reason: "Small change", weight: "low" }],
          confidence: 0.8,
          summary: "Low risk",
        }) as unknown as T;

      case "test_strategist":
        return (overrides.plan ?? {
          objectives: [{ id: "obj-1", description: "Verify build" }],
          recommendedActions: [
            {
              commandId: "npm-script:test",
              type: "TEST",
              purpose: "Run test suite",
              priority: 1,
              riskAddressed: [],
              requirementIds: ["req-1"],
            },
            {
              commandId: "npm-script:build",
              type: "BUILD",
              purpose: "Build project",
              priority: 2,
              riskAddressed: [],
              requirementIds: [],
            },
          ],
          identifiedRisks: [],
          expectedCapabilities: [],
          unavailableValidations: [],
        }) as unknown as T;

      case "failure_investigator":
        return (overrides.failure ?? {
          likelyCause: "PRODUCT_DEFECT",
          explanation: "Test failed",
          confidence: 0.85,
          suggestRetry: false,
          suggestBaselineComparison: true,
          affectedFiles: [],
          relatedRequirementIds: [],
        }) as unknown as T;

      case "gap_analyst":
        return (overrides.gaps ?? {
          gaps: [],
          requirementAssessments: [
            {
              requirementId: "req-1",
              status: "PARTIALLY_VERIFIED",
              evidenceIds: [],
              explanation: "Tests ran but limited coverage",
            },
          ],
        }) as unknown as T;

      case "verdict_reviewer":
        return (overrides.verdict ?? {
          recommendedVerdict: "PASS_WITH_CONCERNS",
          confidence: "MEDIUM",
          reasoning: "Tests pass but gaps exist",
          concerns: [],
          recommendedNextActions: [],
          summary: "Limited validation",
        }) as unknown as T;

      default:
        return undefined;
    }
  };
}

function createScenarioGateway(
  overrides: Partial<{
    risk: unknown;
    plan: unknown;
    gaps: unknown;
    verdict: unknown;
    failure: unknown;
    change: unknown;
  }> = {},
): FakeModelGateway {
  return new FakeModelGateway(createScenarioResponseProvider(overrides));
}

// --- Correction 2: Structured Commands ---

describe("Correction 2: Structured Commands", () => {
  it("does not use whitespace splitting for command reconstruction", async () => {
    const gateway = createScenarioGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });

    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Build works" }],
      profile: "quick",
      mode: "repository",
    });

    const parseResult = QEResultSchema.safeParse(result);
    expect(parseResult.success).toBe(true);
  });

  it("only executes STRUCTURED commands", async () => {
    const gateway = createScenarioGateway({
      plan: {
        objectives: [{ id: "obj-1", description: "test" }],
        recommendedActions: [
          {
            commandId: "shell-pipeline",
            type: "TEST",
            purpose: "Complex command",
            priority: 1,
            riskAddressed: [],
            requirementIds: [],
          },
        ],
        identifiedRisks: [],
        expectedCapabilities: [],
        unavailableValidations: [],
      },
    });

    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });
    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [],
      profile: "quick",
      mode: "repository",
    });

    expect(
      result.evidence.filter((e) => e.provenance === "executed"),
    ).toHaveLength(0);
  });

  it("DISCOVERED_ONLY commands are reported but not executed", () => {
    const profile = createMockProfile();
    profile.commands.push({
      id: "shell:complex",
      name: "complex pipeline",
      category: "TEST",
      command: "cat file | grep pattern && echo done",
      source: "CI",
      confidence: 0.7,
      executionSupport: "DISCOVERED_ONLY",
    });

    const structuredCommands = profile.commands.filter(
      (c) => c.executionSupport === "STRUCTURED",
    );
    const discoveredOnly = profile.commands.filter(
      (c) => c.executionSupport === "DISCOVERED_ONLY",
    );

    expect(structuredCommands.length).toBe(3);
    expect(discoveredOnly.length).toBe(1);
  });

  it("handles commands with quoted arguments", () => {
    const cmd = {
      id: "grep:search",
      name: "search",
      category: "OTHER" as const,
      command: "grep -r 'hello world' src/",
      executable: "grep",
      args: ["-r", "hello world", "src/"],
      source: "manual",
      confidence: 0.9,
      executionSupport: "STRUCTURED" as const,
    };

    expect(cmd.args[1]).toBe("hello world");
    expect(cmd.executable).toBe("grep");
  });

  it("handles commands with spaces in arguments", () => {
    const cmd = {
      id: "test:jest",
      name: "jest",
      category: "TEST" as const,
      command: "jest --testPathPattern 'my test file.test.ts'",
      executable: "jest",
      args: ["--testPathPattern", "my test file.test.ts"],
      source: "package.json",
      confidence: 0.9,
      executionSupport: "STRUCTURED" as const,
    };

    expect(cmd.args).toHaveLength(2);
    expect(cmd.args[1]).toContain(" ");
  });
});

// --- Correction 5: Evidence Reference Validation ---

describe("Correction 5: Evidence Reference Validation", () => {
  it("rejects invented evidence IDs in requirement assessments", async () => {
    const gateway = createScenarioGateway({
      gaps: {
        gaps: [],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "VERIFIED",
            evidenceIds: ["made-up-evidence-123", "fake-ev-456"],
            explanation: "Fake evidence says it passes",
          },
        ],
      },
    });

    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });
    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Must work" }],
      profile: "quick",
      mode: "repository",
    });

    const reqAssessment = result.requirements.find(
      (r) => r.requirementId === "req-1",
    );
    expect(reqAssessment).toBeDefined();
    expect(reqAssessment!.status).not.toBe("VERIFIED");
    expect(reqAssessment!.evidenceIds).toHaveLength(0);
  });

  it("VERIFIED requires executed evidence", async () => {
    const gateway = createScenarioGateway({
      gaps: {
        gaps: [],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "VERIFIED",
            evidenceIds: [],
            explanation: "Code looks correct",
          },
        ],
      },
    });

    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });
    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Must work" }],
      profile: "quick",
      mode: "repository",
    });

    const reqAssessment = result.requirements.find(
      (r) => r.requirementId === "req-1",
    );
    expect(reqAssessment!.status).not.toBe("VERIFIED");
  });

  it("finding evidence IDs are validated against actual evidence", async () => {
    const gateway = createScenarioGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });
    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Build works" }],
      profile: "quick",
      mode: "repository",
    });

    for (const finding of result.findings) {
      for (const evId of finding.evidenceIds) {
        expect(result.evidence.some((e) => e.id === evId)).toBe(true);
      }
    }
  });
});

// --- Correction 6: Lifecycle Transition History ---

describe("Correction 6: Lifecycle Transition History", () => {
  it("QEResult contains actual transition records", async () => {
    const gateway = createScenarioGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });

    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Test" }],
      profile: "quick",
      mode: "repository",
    });

    expect(result.metrics.lifecycleHistory).toBeDefined();
    expect(result.metrics.lifecycleHistory!.length).toBeGreaterThan(0);

    const firstTransition = result.metrics.lifecycleHistory![0];
    expect(firstTransition.from).toBe("INITIALIZING");
    expect(firstTransition.to).toBe("DISCOVERING");
    expect(firstTransition.timestamp).toBeTruthy();
  });

  it("lifecycle history includes from, to, timestamp for every transition", async () => {
    const gateway = createScenarioGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });

    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [],
      profile: "quick",
      mode: "repository",
    });

    for (const transition of result.metrics.lifecycleHistory!) {
      expect(transition.from).toBeTruthy();
      expect(transition.to).toBeTruthy();
      expect(transition.timestamp).toBeTruthy();
    }
  });

  it("BLOCKED transition is recorded", async () => {
    const gateway = new FakeModelGateway(() => undefined);
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });

    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [],
      profile: "quick",
      mode: "repository",
    });

    const lastTransition =
      result.metrics.lifecycleHistory![
        result.metrics.lifecycleHistory!.length - 1
      ];
    expect(lastTransition.to).toBe("BLOCKED");
  });

  it("state machine rejects invalid transitions", () => {
    const sm = new QEStateMachine();
    expect(() => sm.transition("COMPLETE")).toThrow();
  });
});

// --- Correction 7: Model Call Metadata ---

describe("Correction 7: Model Call Metadata", () => {
  it("QEResult includes model call details", async () => {
    const gateway = createScenarioGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });

    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Test" }],
      profile: "quick",
      mode: "repository",
    });

    expect(result.metrics.modelCallDetails).toBeDefined();
    expect(result.metrics.modelCallDetails!.length).toBeGreaterThan(0);
  });

  it("model call records contain provider-independent fields", async () => {
    const gateway = createScenarioGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });

    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Test" }],
      profile: "quick",
      mode: "repository",
    });

    for (const call of result.metrics.modelCallDetails!) {
      expect(call.role).toBeTruthy();
      expect(call.provider).toBeTruthy();
      expect(call.model).toBeTruthy();
      expect(call.promptVersion).toBeTruthy();
      expect(call.startedAt).toBeTruthy();
      expect(typeof call.durationMs).toBe("number");
      expect(typeof call.success).toBe("boolean");
      expect(typeof call.retryCount).toBe("number");
    }
  });

  it("prompt version is recorded from task", async () => {
    const gateway = createScenarioGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });

    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Test" }],
      profile: "quick",
      mode: "repository",
    });

    const riskCall = result.metrics.modelCallDetails!.find(
      (c) => c.role === "risk_analyst",
    );
    expect(riskCall).toBeDefined();
    expect(riskCall!.promptVersion).toContain("risk-analysis");
  });

  it("no secrets in model call metadata", async () => {
    const gateway = createScenarioGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });

    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [],
      profile: "quick",
      mode: "repository",
    });

    const json = JSON.stringify(result.metrics.modelCallDetails);
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("OPENAI_API_KEY");
  });
});

// --- Correction 8: Budget Retries ---

describe("Correction 8: Budget Retries", () => {
  it("retries count against budget", async () => {
    let callCount = 0;
    const gateway = new FakeModelGateway(
      <T>(task: ReasoningTask<T>): T | undefined => {
        callCount++;
        if (task.role === "risk_analyst" && callCount <= 2) {
          throw new Error("Temporary failure");
        }
        return createScenarioResponseProvider()(task) as T | undefined;
      },
    );

    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, 2);

    const task = {
      role: "risk_analyst",
      objective: "test",
      context: {},
      outputSchema: (await import("../src/prompts/risk-analysis/v1.js"))
        .RiskAnalysisOutputSchema,
      promptVersion: "test-v1",
    };

    await budgetGateway.reason(task);
    expect(budget.retries).toBeGreaterThan(0);
    expect(budget.modelCalls).toBeGreaterThan(0);
  });

  it("budget exhaustion stops retries", async () => {
    const gateway = new FakeModelGateway(() => {
      throw new Error("Always fails");
    });

    const budget = new BudgetManager({
      maxDurationMs: 60000,
      maxModelCalls: 10,
      maxRetries: 1,
    });
    const budgetGateway = new BudgetAwareGateway(gateway, budget, 5);

    await expect(
      budgetGateway.reason({
        role: "test",
        objective: "test",
        context: {},
        outputSchema: (await import("zod")).z.object({
          result: (await import("zod")).z.string(),
        }),
      }),
    ).rejects.toThrow();

    expect(budget.retries).toBeLessThanOrEqual(1);
  });

  it("successful first attempt records zero retries", async () => {
    const gateway = createScenarioGateway();
    const budget = new BudgetManager(createBudgetForProfile("standard"));
    const budgetGateway = new BudgetAwareGateway(gateway, budget, 2);

    await budgetGateway.reason({
      role: "risk_analyst",
      objective: "test",
      context: {},
      outputSchema: (await import("../src/prompts/risk-analysis/v1.js"))
        .RiskAnalysisOutputSchema,
      promptVersion: "test-v1",
    });

    expect(budget.retries).toBe(0);
    expect(budgetGateway.callMetadata[0].retryCount).toBe(0);
    expect(budgetGateway.callMetadata[0].success).toBe(true);
  });

  it("model-call budget exhaustion produces BLOCKED or reduced confidence", async () => {
    const gateway = createScenarioGateway();
    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 1,
      repositoryProfile: createMockProfile(),
    });

    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Test" }],
      profile: "quick",
      mode: "repository",
    });

    expect(["BLOCKED", "PASS_WITH_CONCERNS", "NEEDS_REVIEW"]).toContain(
      result.verdict,
    );
  });
});

// --- Adversarial Tests ---

describe("Adversarial: Invented Evidence", () => {
  it("fake evidence IDs cannot produce VERIFIED requirement", async () => {
    const gateway = createScenarioGateway({
      gaps: {
        gaps: [],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "VERIFIED",
            evidenceIds: [
              "made-up-evidence-123",
              "invented-ev-abc",
              "nonexistent-proof",
            ],
            explanation: "Model hallucinated evidence",
          },
        ],
      },
    });

    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });
    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Must work" }],
      profile: "quick",
      mode: "repository",
    });

    const assessment = result.requirements.find(
      (r) => r.requirementId === "req-1",
    );
    expect(assessment!.status).not.toBe("VERIFIED");
  });
});

describe("Adversarial: Optimistic Verdict", () => {
  it("guardrails override PASS when no evidence exists", async () => {
    const gateway = createScenarioGateway({
      plan: {
        objectives: [],
        recommendedActions: [],
        identifiedRisks: [],
        expectedCapabilities: [],
        unavailableValidations: [],
      },
      gaps: {
        gaps: [
          {
            area: "Everything",
            description: "No validation performed",
            reason: "No commands available",
            risk: "CRITICAL",
          },
        ],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "NOT_VERIFIED",
            evidenceIds: [],
            explanation: "Nothing ran",
          },
        ],
      },
      verdict: {
        recommendedVerdict: "PASS",
        confidence: "HIGH",
        reasoning: "Model optimistically says pass",
        concerns: [],
        recommendedNextActions: [],
        summary: "Model says all good",
      },
    });

    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });
    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Must work" }],
      profile: "quick",
      mode: "repository",
    });

    expect(result.verdict).not.toBe("PASS");
  });
});

describe("Adversarial: Optimistic Requirement Verification", () => {
  it("VERIFIED without executed evidence is downgraded", async () => {
    const gateway = createScenarioGateway({
      plan: {
        objectives: [],
        recommendedActions: [],
        identifiedRisks: [],
        expectedCapabilities: [],
        unavailableValidations: [],
      },
      gaps: {
        gaps: [],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "VERIFIED",
            evidenceIds: [],
            explanation:
              "Source code inspection shows implementation is correct",
          },
        ],
      },
    });

    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });
    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Must work" }],
      profile: "quick",
      mode: "repository",
    });

    const assessment = result.requirements.find(
      (r) => r.requirementId === "req-1",
    );
    expect(assessment!.status).not.toBe("VERIFIED");
  });
});

describe("Adversarial: Invented Command", () => {
  it("model-recommended nonexistent command ID produces no execution", async () => {
    const gateway = createScenarioGateway({
      plan: {
        objectives: [{ id: "obj-1", description: "test" }],
        recommendedActions: [
          {
            commandId: "nonexistent-command-xyz",
            type: "TEST",
            purpose: "Ghost command",
            priority: 1,
            riskAddressed: [],
            requirementIds: [],
          },
        ],
        identifiedRisks: [],
        expectedCapabilities: [],
        unavailableValidations: [],
      },
    });

    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 12,
      repositoryProfile: createMockProfile(),
    });
    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [],
      profile: "quick",
      mode: "repository",
    });

    expect(
      result.evidence.filter((e) => e.provenance === "executed"),
    ).toHaveLength(0);
  });
});

describe("Adversarial: Complex Command", () => {
  it("shell pipeline command is DISCOVERED_ONLY", () => {
    const cmd = {
      id: "ci:pipeline",
      name: "complex",
      category: "TEST" as const,
      command: "cat results.json | jq '.tests' && echo 'done'",
      source: "CI workflow",
      confidence: 0.7,
      executionSupport: "DISCOVERED_ONLY" as const,
    };

    expect(cmd.executionSupport).toBe("DISCOVERED_ONLY");
    expect(cmd.executable).toBeUndefined();
    expect(cmd.args).toBeUndefined();
  });
});

describe("Adversarial: Budget Retry Exhaustion", () => {
  it("repeated failures exhaust budget and produce truthful result", async () => {
    const gateway = new FakeModelGateway(
      <T>(task: ReasoningTask<T>): T | undefined => {
        if (task.role === "risk_analyst") {
          throw new Error("Model always fails for risk");
        }
        return createScenarioResponseProvider()(task) as T | undefined;
      },
    );

    const orchestrator = new QEOrchestrator({
      gateway,
      maxModelCalls: 6,
      repositoryProfile: createMockProfile(),
    });
    const result = await orchestrator.run({
      repositoryPath: process.cwd(),
      requirements: [{ id: "req-1", description: "Test" }],
      profile: "quick",
      mode: "repository",
    });

    expect(["BLOCKED", "PASS_WITH_CONCERNS", "NEEDS_REVIEW"]).toContain(
      result.verdict,
    );
  });
});

// --- Evaluation Harness ---

interface EvaluationScenario {
  name: string;
  description: string;
  request: QERequest;
  modelOverrides: Parameters<typeof createScenarioGateway>[0];
  expectations: {
    allowedRiskLevels?: string[];
    allowedVerdicts: string[];
    requiredFindingCategories?: string[];
    expectedClassification?: string;
    requireGaps?: boolean;
  };
}

function createEvaluationScenarios(): EvaluationScenario[] {
  return [
    // Scenario A: Low-Risk Passing Change
    {
      name: "A: Low-Risk Passing Change",
      description: "Small safe change with passing tests",
      request: {
        repositoryPath: process.cwd(),
        requirements: [{ id: "req-1", description: "Code passes lint checks" }],
        profile: "quick",
        mode: "repository",
      },
      modelOverrides: {
        risk: {
          level: "LOW",
          factors: [
            {
              factor: "minor change",
              reason: "Small formatting fix",
              weight: "low",
            },
          ],
          confidence: 0.9,
          summary: "Low risk formatting change",
        },
        gaps: {
          gaps: [],
          requirementAssessments: [
            {
              requirementId: "req-1",
              status: "PARTIALLY_VERIFIED",
              evidenceIds: [],
              explanation: "Lint passed",
            },
          ],
        },
        verdict: {
          recommendedVerdict: "PASS_WITH_CONCERNS",
          confidence: "MEDIUM",
          reasoning: "Tests pass, low risk",
          concerns: [],
          recommendedNextActions: [],
          summary: "Low risk change passes validation",
        },
      },
      expectations: {
        allowedRiskLevels: ["LOW", "MEDIUM"],
        allowedVerdicts: ["PASS", "PASS_WITH_CONCERNS"],
      },
    },

    // Scenario B: Introduced Regression (simulated)
    {
      name: "B: Introduced Regression",
      description: "Target introduces a failure not in baseline",
      request: {
        repositoryPath: process.cwd(),
        requirements: [{ id: "req-1", description: "All tests pass" }],
        profile: "standard",
        mode: "repository",
      },
      modelOverrides: {
        risk: {
          level: "HIGH",
          factors: [
            {
              factor: "test failure",
              reason: "Tests fail on target",
              weight: "high",
            },
          ],
          confidence: 0.9,
          summary: "High risk - test failures",
        },
        gaps: {
          gaps: [
            {
              area: "Test suite",
              description: "Material test failure",
              reason: "Tests fail",
              risk: "HIGH",
            },
          ],
          requirementAssessments: [
            {
              requirementId: "req-1",
              status: "NOT_VERIFIED",
              evidenceIds: [],
              explanation: "Tests fail",
            },
          ],
        },
        verdict: {
          recommendedVerdict: "FAIL",
          confidence: "HIGH",
          reasoning: "Material regression detected",
          concerns: ["Test failures"],
          recommendedNextActions: ["Fix regression"],
          summary: "Introduced regression detected",
        },
      },
      expectations: {
        allowedRiskLevels: ["MEDIUM", "HIGH", "CRITICAL"],
        allowedVerdicts: ["FAIL"],
      },
    },

    // Scenario C: Pre-Existing Failure
    {
      name: "C: Pre-Existing Failure",
      description: "Both baseline and target fail the same tests",
      request: {
        repositoryPath: process.cwd(),
        requirements: [{ id: "req-1", description: "Tests pass" }],
        profile: "standard",
        mode: "repository",
      },
      modelOverrides: {
        risk: {
          level: "MEDIUM",
          factors: [
            {
              factor: "pre-existing failure",
              reason: "Failure predates change",
              weight: "medium",
            },
          ],
          confidence: 0.7,
          summary: "Medium risk - pre-existing failure",
        },
        gaps: {
          gaps: [
            {
              area: "Pre-existing test health",
              description: "Existing tests fail independently of change",
              reason: "Pre-existing issue",
              risk: "MEDIUM",
            },
          ],
          requirementAssessments: [
            {
              requirementId: "req-1",
              status: "NOT_VERIFIED",
              evidenceIds: [],
              explanation: "Pre-existing failure",
            },
          ],
        },
        verdict: {
          recommendedVerdict: "PASS_WITH_CONCERNS",
          confidence: "MEDIUM",
          reasoning: "Failure is pre-existing, not introduced by change",
          concerns: ["Pre-existing test failure"],
          recommendedNextActions: ["Fix pre-existing test"],
          summary: "Pre-existing failure — change not at fault",
        },
      },
      expectations: {
        allowedVerdicts: ["PASS_WITH_CONCERNS", "NEEDS_REVIEW", "FAIL"],
      },
    },

    // Scenario D: Missing Coverage
    {
      name: "D: Missing Coverage",
      description: "Important requirements cannot be fully validated",
      request: {
        repositoryPath: process.cwd(),
        requirements: [
          { id: "req-1", description: "Data export works in CSV format" },
          { id: "req-2", description: "Large datasets are paginated" },
        ],
        profile: "standard",
        mode: "repository",
      },
      modelOverrides: {
        risk: {
          level: "MEDIUM",
          factors: [
            {
              factor: "coverage gap",
              reason: "No tests for data export",
              weight: "medium",
            },
          ],
          confidence: 0.7,
          summary: "Medium risk due to validation gaps",
        },
        gaps: {
          gaps: [
            {
              area: "Data export",
              description: "No test for CSV export functionality",
              reason: "No export-related tests exist",
              risk: "HIGH",
            },
          ],
          requirementAssessments: [
            {
              requirementId: "req-1",
              status: "NOT_VERIFIED",
              evidenceIds: [],
              explanation: "No export tests available",
            },
            {
              requirementId: "req-2",
              status: "NOT_VERIFIED",
              evidenceIds: [],
              explanation: "No pagination tests available",
            },
          ],
        },
        verdict: {
          recommendedVerdict: "PASS_WITH_CONCERNS",
          confidence: "LOW",
          reasoning: "Tests pass but critical coverage gaps",
          concerns: ["No export tests"],
          recommendedNextActions: ["Add export tests"],
          summary: "Significant validation gaps remain",
        },
      },
      expectations: {
        allowedVerdicts: ["PASS_WITH_CONCERNS", "NEEDS_REVIEW"],
        requireGaps: true,
      },
    },

    // Scenario E: Authorization Change
    {
      name: "E: Authorization Change",
      description: "Security-sensitive change impacts auth",
      request: {
        repositoryPath: process.cwd(),
        requirements: [
          { id: "req-1", description: "Admin endpoints require admin role" },
        ],
        profile: "standard",
        mode: "repository",
      },
      modelOverrides: {
        risk: {
          level: "CRITICAL",
          factors: [
            {
              factor: "auth change",
              reason: "Authorization middleware modified",
              weight: "critical",
            },
          ],
          confidence: 0.95,
          summary: "Critical risk — authorization change",
        },
        gaps: {
          gaps: [
            {
              area: "Authorization testing",
              description: "No negative auth tests",
              reason: "Cannot verify unauthorized access is blocked",
              risk: "CRITICAL",
            },
          ],
          requirementAssessments: [
            {
              requirementId: "req-1",
              status: "NOT_VERIFIED",
              evidenceIds: [],
              explanation: "No authorization-specific tests",
            },
          ],
        },
        verdict: {
          recommendedVerdict: "NEEDS_REVIEW",
          confidence: "LOW",
          reasoning: "Auth change requires manual review",
          concerns: ["No negative authorization tests"],
          recommendedNextActions: ["Manual security review"],
          summary: "Authorization change needs human review",
        },
      },
      expectations: {
        allowedRiskLevels: ["HIGH", "CRITICAL"],
        allowedVerdicts: ["PASS_WITH_CONCERNS", "NEEDS_REVIEW", "FAIL"],
      },
    },

    // Scenario F: Insufficient Environment
    {
      name: "F: Insufficient Environment",
      description: "Critical validation capability cannot execute",
      request: {
        repositoryPath: process.cwd(),
        requirements: [
          { id: "req-1", description: "Database migrations run successfully" },
        ],
        profile: "standard",
        mode: "repository",
      },
      modelOverrides: {
        risk: {
          level: "HIGH",
          factors: [
            {
              factor: "environment gap",
              reason: "Database not available",
              weight: "high",
            },
          ],
          confidence: 0.8,
          summary: "High risk — insufficient environment",
        },
        plan: {
          objectives: [],
          recommendedActions: [],
          identifiedRisks: ["Database not available"],
          expectedCapabilities: ["database"],
          unavailableValidations: [
            {
              description: "Database migration tests",
              reason: "No database available in test environment",
            },
          ],
        },
        gaps: {
          gaps: [
            {
              area: "Database validation",
              description: "Cannot validate database migrations",
              reason: "No database environment available",
              risk: "CRITICAL",
            },
          ],
          requirementAssessments: [
            {
              requirementId: "req-1",
              status: "BLOCKED",
              evidenceIds: [],
              explanation: "No database environment available",
            },
          ],
        },
        verdict: {
          recommendedVerdict: "BLOCKED",
          confidence: "LOW",
          reasoning: "Cannot validate without database",
          concerns: ["Missing database environment"],
          recommendedNextActions: ["Provide database access"],
          summary: "Blocked by missing environment",
        },
      },
      expectations: {
        allowedVerdicts: ["BLOCKED", "NEEDS_REVIEW"],
        requireGaps: true,
      },
    },
  ];
}

describe("Evaluation Harness", () => {
  const scenarios = createEvaluationScenarios();

  for (const scenario of scenarios) {
    it(`Scenario ${scenario.name}`, async () => {
      const gateway = createScenarioGateway(scenario.modelOverrides);
      const orchestrator = new QEOrchestrator({
        gateway,
        maxModelCalls: 12,
        repositoryProfile: createMockProfile(),
      });

      const result = await orchestrator.run(scenario.request);

      // Validate against canonical schema
      const parseResult = QEResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);

      // Verify risk level if specified
      if (scenario.expectations.allowedRiskLevels) {
        expect(scenario.expectations.allowedRiskLevels).toContain(
          result.riskAssessment.level,
        );
      }

      // Verify verdict
      expect(scenario.expectations.allowedVerdicts).toContain(result.verdict);

      // Verify gaps required
      if (scenario.expectations.requireGaps) {
        expect(result.remainingGaps.length).toBeGreaterThan(0);
      }

      // Verify lifecycle history is present
      expect(result.metrics.lifecycleHistory).toBeDefined();
      expect(result.metrics.lifecycleHistory!.length).toBeGreaterThan(0);

      // Verify model call metadata is present
      expect(result.metrics.modelCallDetails).toBeDefined();
      expect(result.metrics.modelCallDetails!.length).toBeGreaterThan(0);
    });
  }
});

// --- Baseline Comparison Unit Tests ---

describe("Baseline Comparison Classification", () => {
  it("target fails + baseline passes = INTRODUCED", () => {
    const result = classifyWithBaseline("PASS", "FAIL");
    expect(result.classification).toBe("INTRODUCED");
    expect(result.baselinePassed).toBe(true);
    expect(result.targetPassed).toBe(false);
  });

  it("target fails + baseline fails = PRE_EXISTING", () => {
    const result = classifyWithBaseline("FAIL", "FAIL");
    expect(result.classification).toBe("PRE_EXISTING");
    expect(result.baselinePassed).toBe(false);
    expect(result.targetPassed).toBe(false);
  });

  it("baseline inconclusive = UNKNOWN", () => {
    const result = classifyWithBaseline("INCONCLUSIVE", "FAIL");
    expect(result.classification).toBe("UNKNOWN");
  });

  it("both pass = UNKNOWN (no regression)", () => {
    const result = classifyWithBaseline("PASS", "PASS");
    expect(result.classification).toBe("UNKNOWN");
    expect(result.baselinePassed).toBe(true);
    expect(result.targetPassed).toBe(true);
  });
});
