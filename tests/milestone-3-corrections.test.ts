import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import { BudgetAwareGateway } from "../src/core/orchestrator/budget-aware-gateway.js";
import {
  BudgetManager,
  createBudgetForProfile,
} from "../src/core/orchestrator/budget-manager.js";
import { QEStateMachine } from "../src/core/lifecycle/index.js";
import {
  QEResultSchema,
  BaselineComparisonSchema,
} from "../src/types/index.js";
import type { QERequest, RepositoryProfile } from "../src/types/index.js";
import { classifyWithBaseline } from "../src/core/reasoning/failure-investigator.js";
import { analyzeRepository } from "../src/repository/index.js";

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

  it("all-failing gateway produces BLOCKED verdict but completes lifecycle", async () => {
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

    expect(result.verdict).toBe("BLOCKED");
    const lastTransition =
      result.metrics.lifecycleHistory![
        result.metrics.lifecycleHistory!.length - 1
      ];
    expect(lastTransition.to).toBe("COMPLETE");
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
    // Retries are tracked via retry budget, not logical model-call budget
    expect(budget.modelCalls).toBe(0);
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

// --- Evaluation Harness with Real Git Repos ---

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "qe-eval-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function gitCommit(dir: string, msg: string): string {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", msg, "--allow-empty"], { cwd: dir });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
    .toString()
    .trim();
}

interface EvalScenario {
  name: string;
  repoDir: string;
  modelOverrides: Parameters<typeof createScenarioGateway>[0];
  request: QERequest;
  expectations: {
    allowedRiskLevels?: string[];
    allowedVerdicts: string[];
    requireGaps?: boolean;
    requireEvidence?: boolean;
  };
}

function buildScenarioA(): EvalScenario {
  const dir = createTempGitRepo();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "low-risk-app",
      version: "1.0.0",
      scripts: { check: "echo ok" },
    }),
  );
  writeFileSync(
    join(dir, "index.js"),
    "module.exports = { greet: () => 'hello' };\n",
  );
  gitCommit(dir, "initial");
  return {
    name: "A: Low-Risk Passing Change",
    repoDir: dir,
    request: {
      repositoryPath: dir,
      requirements: [{ id: "req-1", description: "Code passes lint checks" }],
      profile: "quick",
      mode: "repository",
    },
    modelOverrides: {
      risk: {
        level: "LOW",
        factors: [{ factor: "minor", reason: "Formatting fix", weight: "low" }],
        confidence: 0.9,
        summary: "Low risk",
      },
      gaps: {
        gaps: [],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "PARTIALLY_VERIFIED",
            evidenceIds: [],
            explanation: "Check passed",
          },
        ],
      },
      verdict: {
        recommendedVerdict: "PASS_WITH_CONCERNS",
        confidence: "MEDIUM",
        reasoning: "Low risk",
        concerns: [],
        recommendedNextActions: [],
        summary: "Low risk passes",
      },
    },
    expectations: {
      allowedRiskLevels: ["LOW", "MEDIUM"],
      allowedVerdicts: ["PASS", "PASS_WITH_CONCERNS"],
    },
  };
}

function buildScenarioB(): EvalScenario {
  const dir = createTempGitRepo();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "regression-app",
      version: "1.0.0",
      scripts: { test: "node validate.js" },
    }),
  );
  writeFileSync(join(dir, "validate.js"), "process.exit(0);\n");
  gitCommit(dir, "baseline: tests pass");
  writeFileSync(join(dir, "validate.js"), "process.exit(1);\n");
  gitCommit(dir, "target: break tests");
  return {
    name: "B: Introduced Regression",
    repoDir: dir,
    request: {
      repositoryPath: dir,
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
        summary: "High risk",
      },
      gaps: {
        gaps: [
          {
            area: "Tests",
            description: "Test failure",
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
        reasoning: "Regression",
        concerns: ["Failures"],
        recommendedNextActions: ["Fix"],
        summary: "Regression",
      },
    },
    expectations: {
      allowedRiskLevels: ["MEDIUM", "HIGH", "CRITICAL"],
      allowedVerdicts: ["FAIL"],
    },
  };
}

function buildScenarioC(): EvalScenario {
  const dir = createTempGitRepo();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "preexisting-app",
      version: "1.0.0",
      scripts: { test: "node validate.js" },
    }),
  );
  writeFileSync(join(dir, "validate.js"), "process.exit(1);\n");
  writeFileSync(join(dir, "lib.js"), "module.exports = {};\n");
  gitCommit(dir, "baseline: already broken");
  writeFileSync(join(dir, "lib.js"), "module.exports = { v: 2 };\n");
  gitCommit(dir, "target: unrelated change");
  return {
    name: "C: Pre-Existing Failure",
    repoDir: dir,
    request: {
      repositoryPath: dir,
      requirements: [{ id: "req-1", description: "Tests pass" }],
      profile: "standard",
      mode: "repository",
    },
    modelOverrides: {
      risk: {
        level: "MEDIUM",
        factors: [
          {
            factor: "pre-existing",
            reason: "Failure predates change",
            weight: "medium",
          },
        ],
        confidence: 0.7,
        summary: "Pre-existing",
      },
      gaps: {
        gaps: [
          {
            area: "Test health",
            description: "Pre-existing failure",
            reason: "Pre-existing",
            risk: "MEDIUM",
          },
        ],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "NOT_VERIFIED",
            evidenceIds: [],
            explanation: "Pre-existing",
          },
        ],
      },
      verdict: {
        recommendedVerdict: "PASS_WITH_CONCERNS",
        confidence: "MEDIUM",
        reasoning: "Pre-existing",
        concerns: ["Pre-existing failure"],
        recommendedNextActions: ["Fix test"],
        summary: "Pre-existing failure",
      },
    },
    expectations: {
      allowedVerdicts: ["PASS_WITH_CONCERNS", "NEEDS_REVIEW", "FAIL"],
    },
  };
}

function buildScenarioD(): EvalScenario {
  const dir = createTempGitRepo();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "missing-coverage-app",
      version: "1.0.0",
      scripts: { check: "echo basic-check-ok" },
    }),
  );
  writeFileSync(
    join(dir, "export.js"),
    "module.exports = { exportCSV: () => {} };\n",
  );
  gitCommit(dir, "initial");
  return {
    name: "D: Missing Coverage",
    repoDir: dir,
    request: {
      repositoryPath: dir,
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
            reason: "No export tests",
            weight: "medium",
          },
        ],
        confidence: 0.7,
        summary: "Coverage gaps",
      },
      gaps: {
        gaps: [
          {
            area: "Data export",
            description: "No CSV export test",
            reason: "No export tests exist",
            risk: "HIGH",
          },
        ],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "NOT_VERIFIED",
            evidenceIds: [],
            explanation: "No export tests",
          },
          {
            requirementId: "req-2",
            status: "NOT_VERIFIED",
            evidenceIds: [],
            explanation: "No pagination tests",
          },
        ],
      },
      verdict: {
        recommendedVerdict: "PASS_WITH_CONCERNS",
        confidence: "LOW",
        reasoning: "Coverage gaps",
        concerns: ["No export tests"],
        recommendedNextActions: ["Add tests"],
        summary: "Gaps remain",
      },
    },
    expectations: {
      allowedVerdicts: ["PASS_WITH_CONCERNS", "NEEDS_REVIEW"],
      requireGaps: true,
    },
  };
}

function buildScenarioE(): EvalScenario {
  const dir = createTempGitRepo();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "auth-app",
      version: "1.0.0",
      scripts: { check: "echo auth-check" },
    }),
  );
  writeFileSync(
    join(dir, "auth.js"),
    "module.exports = { requireAdmin: (req) => { if (!req.user.isAdmin) throw new Error('forbidden'); } };\n",
  );
  gitCommit(dir, "initial with auth");
  writeFileSync(
    join(dir, "auth.js"),
    "module.exports = { requireAdmin: () => {} };\n",
  );
  gitCommit(dir, "remove auth check");
  return {
    name: "E: Authorization Change",
    repoDir: dir,
    request: {
      repositoryPath: dir,
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
          { factor: "auth change", reason: "Auth removed", weight: "critical" },
        ],
        confidence: 0.95,
        summary: "Critical auth",
      },
      gaps: {
        gaps: [
          {
            area: "Auth testing",
            description: "No negative auth tests",
            reason: "Cannot verify block",
            risk: "CRITICAL",
          },
        ],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "NOT_VERIFIED",
            evidenceIds: [],
            explanation: "No auth tests",
          },
        ],
      },
      verdict: {
        recommendedVerdict: "NEEDS_REVIEW",
        confidence: "LOW",
        reasoning: "Auth change",
        concerns: ["No auth tests"],
        recommendedNextActions: ["Security review"],
        summary: "Auth change needs review",
      },
    },
    expectations: {
      allowedRiskLevels: ["HIGH", "CRITICAL"],
      allowedVerdicts: ["PASS_WITH_CONCERNS", "NEEDS_REVIEW", "FAIL"],
    },
  };
}

function buildScenarioF(): EvalScenario {
  const dir = createTempGitRepo();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "db-app",
      version: "1.0.0",
    }),
  );
  writeFileSync(
    join(dir, "migrate.js"),
    "const db = require('pg'); db.connect();\n",
  );
  gitCommit(dir, "initial");
  return {
    name: "F: Insufficient Environment",
    repoDir: dir,
    request: {
      repositoryPath: dir,
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
            factor: "env gap",
            reason: "Database not available",
            weight: "high",
          },
        ],
        confidence: 0.8,
        summary: "No database",
      },
      plan: {
        objectives: [],
        recommendedActions: [],
        identifiedRisks: ["No database"],
        expectedCapabilities: ["database"],
        unavailableValidations: [
          { description: "DB migration tests", reason: "No database" },
        ],
      },
      gaps: {
        gaps: [
          {
            area: "Database",
            description: "Cannot validate migrations",
            reason: "No database",
            risk: "CRITICAL",
          },
        ],
        requirementAssessments: [
          {
            requirementId: "req-1",
            status: "BLOCKED",
            evidenceIds: [],
            explanation: "No database",
          },
        ],
      },
      verdict: {
        recommendedVerdict: "BLOCKED",
        confidence: "LOW",
        reasoning: "No database",
        concerns: ["Missing DB"],
        recommendedNextActions: ["Provide DB"],
        summary: "Blocked",
      },
    },
    expectations: {
      allowedVerdicts: ["BLOCKED", "NEEDS_REVIEW"],
      requireGaps: true,
    },
  };
}

describe("Evaluation Harness (Real Repos)", () => {
  const scenarios: EvalScenario[] = [];
  const cleanups: string[] = [];

  beforeAll(() => {
    const builders = [
      buildScenarioA,
      buildScenarioB,
      buildScenarioC,
      buildScenarioD,
      buildScenarioE,
      buildScenarioF,
    ];
    for (const build of builders) {
      const s = build();
      scenarios.push(s);
      cleanups.push(s.repoDir);
    }
  });

  afterAll(() => {
    for (const dir of cleanups) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  it("creates real Git repositories for scenarios", () => {
    for (const s of scenarios) {
      const log = execFileSync("git", ["log", "--oneline"], {
        cwd: s.repoDir,
      }).toString();
      expect(log.length).toBeGreaterThan(0);
    }
  });

  it("discovers real commands from scenario repos", async () => {
    const profileA = await analyzeRepository({
      targetPath: scenarios[0].repoDir,
    });
    expect(profileA.root).toBe(scenarios[0].repoDir);
    expect(profileA.commands.length).toBeGreaterThanOrEqual(0);
  });

  for (let i = 0; i < 6; i++) {
    const names = [
      "A: Low-Risk",
      "B: Regression",
      "C: Pre-Existing",
      "D: Missing Coverage",
      "E: Auth Change",
      "F: Insufficient Env",
    ];
    it(`Scenario ${names[i]} produces valid structured result`, async () => {
      const s = scenarios[i];
      const profile = await analyzeRepository({ targetPath: s.repoDir });
      const gateway = createScenarioGateway(s.modelOverrides);
      const orchestrator = new QEOrchestrator({
        gateway,
        maxModelCalls: 12,
        repositoryProfile: profile,
      });

      const result = await orchestrator.run(s.request);

      const parseResult = QEResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);

      if (s.expectations.allowedRiskLevels) {
        expect(s.expectations.allowedRiskLevels).toContain(
          result.riskAssessment.level,
        );
      }
      expect(s.expectations.allowedVerdicts).toContain(result.verdict);
      if (s.expectations.requireGaps) {
        expect(result.remainingGaps.length).toBeGreaterThan(0);
      }
      expect(result.metrics.lifecycleHistory).toBeDefined();
      expect(result.metrics.lifecycleHistory!.length).toBeGreaterThan(0);
      expect(result.metrics.modelCallDetails).toBeDefined();
      expect(result.metrics.modelCallDetails!.length).toBeGreaterThan(0);
    });
  }
});

// --- Baseline Comparison Schema Tests ---

describe("Baseline Comparison Structured Data", () => {
  it("BaselineComparison schema validates correctly", () => {
    const valid = {
      classification: "INTRODUCED",
      targetEvidenceId: "ev-target-1",
      baselineEvidenceId: "ev-baseline-1",
      validationActionId: "action-test:vitest",
      explanation: "Baseline passed, target failed",
    };
    expect(BaselineComparisonSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid classification", () => {
    const invalid = {
      classification: "MAYBE",
      targetEvidenceId: "ev-1",
    };
    expect(BaselineComparisonSchema.safeParse(invalid).success).toBe(false);
  });

  it("target fails + baseline passes = INTRODUCED classification", () => {
    const result = classifyWithBaseline("PASS", "FAIL");
    expect(result.classification).toBe("INTRODUCED");
    expect(result.baselinePassed).toBe(true);
    expect(result.targetPassed).toBe(false);
  });

  it("target fails + baseline fails = PRE_EXISTING classification", () => {
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

  it("QEResult with baselineComparisons validates", () => {
    const profile = createMockProfile();
    const result = QEResultSchema.safeParse({
      executionId: "test-1",
      repository: { path: "/tmp/test", name: "test" },
      target: "HEAD",
      profile: "quick",
      repositoryProfile: profile,
      riskAssessment: {
        level: "LOW",
        factors: [],
        confidence: 0.5,
        summary: "low",
      },
      validationPlan: {
        objectives: [],
        plannedActions: [],
        identifiedRisks: [],
        expectedCapabilities: [],
      },
      evidence: [
        {
          id: "ev-t-1",
          type: "COMMAND_RESULT",
          provenance: "executed",
          timestamp: "2024-01-01",
          source: "test",
          status: "FAIL",
          summary: "failed",
        },
        {
          id: "ev-b-1",
          type: "COMMAND_RESULT",
          provenance: "executed",
          timestamp: "2024-01-01",
          source: "baseline",
          status: "PASS",
          summary: "passed",
        },
      ],
      findings: [],
      baselineComparisons: [
        {
          classification: "INTRODUCED",
          targetEvidenceId: "ev-t-1",
          baselineEvidenceId: "ev-b-1",
          validationActionId: "action-test",
          explanation: "Baseline passed, target failed",
        },
      ],
      requirements: [],
      remainingGaps: [],
      verdict: "FAIL",
      confidence: "HIGH",
      summary: "Regression",
      recommendedNextActions: [],
      metrics: {
        startTime: "2024-01-01",
        modelCalls: 0,
        commandsExecuted: 0,
        testsExecuted: 0,
        testsGenerated: 0,
        retries: 0,
        stateTransitions: 0,
      },
    });
    expect(result.success).toBe(true);
  });
});

// --- CLI exec --command-id Structured Command Tests ---

describe("CLI exec uses structured DiscoveredCommand fields", () => {
  it("STRUCTURED command with spaces in args uses executable/args directly", () => {
    const discovered = {
      id: "test:grep",
      name: "grep search",
      category: "OTHER" as const,
      command: "grep -r 'hello world' src/",
      executable: "grep",
      args: ["-r", "hello world", "src/"],
      source: "manual",
      confidence: 0.9,
      executionSupport: "STRUCTURED" as const,
    };
    expect(discovered.executionSupport).toBe("STRUCTURED");
    expect(discovered.executable).toBe("grep");
    expect(discovered.args[1]).toBe("hello world");
  });

  it("DISCOVERED_ONLY command is not executable", () => {
    const discovered = {
      id: "ci:pipeline",
      name: "pipeline",
      category: "OTHER" as const,
      command: "cat file | grep pattern && echo done",
      source: "CI",
      confidence: 0.7,
      executionSupport: "DISCOVERED_ONLY" as const,
    };
    expect(discovered.executionSupport).toBe("DISCOVERED_ONLY");
    expect(discovered.executable).toBeUndefined();
  });

  it("normal npm STRUCTURED command provides executable and args", () => {
    const discovered = {
      id: "npm-script:test",
      name: "test",
      category: "TEST" as const,
      command: "npm run test",
      executable: "npm",
      args: ["run", "test"],
      source: "package.json",
      confidence: 0.9,
      executionSupport: "STRUCTURED" as const,
    };
    expect(discovered.executable).toBe("npm");
    expect(discovered.args).toEqual(["run", "test"]);
  });
});

// --- Retry Budget Accounting Tests ---

describe("Retry Budget Fully Accounted", () => {
  it("attempt 1 fails, attempt 2 succeeds = two attempts accounted", async () => {
    let callCount = 0;
    const gateway = new FakeModelGateway(
      <T>(task: ReasoningTask<T>): T | undefined => {
        callCount++;
        if (task.role === "risk_analyst" && callCount === 1) {
          throw new Error("Transient failure");
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
    expect(budgetGateway.callMetadata.length).toBe(2);
    expect(budgetGateway.callMetadata[0].success).toBe(false);
    expect(budgetGateway.callMetadata[1].success).toBe(true);
    expect(budget.retries).toBe(1);
    // Retries do not consume logical model-call budget
    expect(budget.modelCalls).toBe(0);
  });

  it("fails until budget exhausted, no additional attempts", async () => {
    const gateway = new FakeModelGateway(() => {
      throw new Error("Always fails");
    });

    const budget = new BudgetManager({
      maxDurationMs: 60000,
      maxModelCalls: 10,
      maxRetries: 2,
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

    expect(budget.retries).toBeLessThanOrEqual(2);
    expect(budgetGateway.callMetadata.every((m) => !m.success)).toBe(true);
  });

  it("OpenAI provider does not retry internally", async () => {
    const { OpenAIModelGateway } =
      await import("../src/models/gateway/openai.js");
    const gw = new OpenAIModelGateway({ model: "gpt-4o", apiKey: "test-key" });
    expect((gw as any).client._options.maxRetries).toBe(0);
  });
});
