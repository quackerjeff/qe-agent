import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BudgetManager,
  createBudgetForProfile,
  VERDICT_TIME_RESERVE_MS,
  MIN_OPTIONAL_EXECUTION_MS,
} from "../src/core/orchestrator/budget-manager.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import { QEResultSchema } from "../src/types/index.js";
import type { RepositoryProfile } from "../src/types/index.js";

// --- Helpers ---

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "qe-rb-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function gitCommit(dir: string, msg: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", msg, "--allow-empty"], { cwd: dir });
}

function createMockProfile(root: string): RepositoryProfile {
  return {
    root,
    git: { detected: true, root, branch: "main" },
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
    packageManagers: [],
    buildSystems: [],
    testFrameworks: [
      {
        id: "vitest",
        name: "Vitest",
        category: "testFramework",
        confidence: 0.9,
        evidence: [{ source: "vitest.config.ts", reason: "Config found" }],
      },
    ],
    ciSystems: [],
    applications: [{ id: "root", name: "test-repo", path: "." }],
    documentation: [],
    commands: [
      {
        id: "npm-script:test",
        name: "test",
        category: "TEST",
        command: "vitest run",
        executable: "npx",
        args: ["vitest", "run"],
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

function createScenarioGateway(
  overrides: Partial<{
    risk: unknown;
    plan: unknown;
    gaps: unknown;
    verdict: unknown;
    failure: unknown;
    change: unknown;
    testGen: unknown;
  }> = {},
): FakeModelGateway {
  return new FakeModelGateway(<T>(task: ReasoningTask<T>): T | undefined => {
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
          level: "MEDIUM",
          factors: [
            { factor: "test", reason: "Test change", weight: "medium" },
          ],
          confidence: 0.7,
          summary: "Medium risk",
        }) as unknown as T;
      case "test_strategist":
        return (overrides.plan ?? {
          objectives: [{ id: "obj-1", description: "Verify" }],
          recommendedActions: [
            {
              commandId: "npm-script:test",
              type: "TEST",
              purpose: "Run tests",
              priority: 1,
              riskAddressed: [],
              requirementIds: ["req-1"],
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
          suggestBaselineComparison: false,
          affectedFiles: [],
          relatedRequirementIds: [],
        }) as unknown as T;
      case "gap_analyst":
        return (overrides.gaps ?? {
          gaps: [
            {
              area: "Validation",
              description: "Missing test coverage",
              reason: "No tests for target behavior",
              risk: "MEDIUM",
            },
          ],
          requirementAssessments: [
            {
              requirementId: "req-1",
              status: "NOT_VERIFIED",
              evidenceIds: [],
              explanation: "Insufficient evidence",
            },
          ],
        }) as unknown as T;
      case "verdict_reviewer":
        return (overrides.verdict ?? {
          recommendedVerdict: "PASS_WITH_CONCERNS",
          confidence: "MEDIUM",
          reasoning: "Gaps exist",
          concerns: ["Missing coverage"],
          recommendedNextActions: ["Add tests"],
          summary: "Gaps remain",
        }) as unknown as T;
      case "test_generator":
        return (overrides.testGen ?? {
          shouldGenerate: false,
          reason: "No generation needed",
          plans: [],
          proposals: [],
        }) as unknown as T;
      default:
        return undefined;
    }
  });
}

// ==========================================================================
// Minimum Optional Execution Threshold
// ==========================================================================

describe("DF-002: Minimum Optional Execution Threshold", () => {
  it("undefined estimatedMs uses MIN_OPTIONAL_EXECUTION_MS as fallback", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_EXECUTION_MS - 1,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(false);
    expect(budget.canAffordOptionalExecution(undefined)).toBe(false);
  });

  it("undefined estimatedMs allows execution when headroom exceeds minimum", () => {
    const budget = new BudgetManager({
      maxDurationMs:
        VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_EXECUTION_MS + 1_000,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(true);
    expect(budget.canAffordOptionalExecution(undefined)).toBe(true);
  });

  it("explicit estimatedMs below minimum is still honored", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 5_000,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(false);
    expect(budget.canAffordOptionalExecution(5_000)).toBe(true);
    expect(budget.canAffordOptionalExecution(5_001)).toBe(false);
  });

  it("optional execution denied when usable headroom is 5s (below 15s minimum)", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 5_000,
      maxModelCalls: 100,
    });

    expect(budget.canAffordOptionalExecution()).toBe(false);
  });

  it("optionalExecutionTimeoutMs returns 0 below minimum threshold", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + 10_000,
      maxModelCalls: 100,
    });

    expect(budget.optionalExecutionTimeoutMs(60_000)).toBe(0);
  });

  it("optionalExecutionTimeoutMs returns clamped value at or above minimum", () => {
    const budget = new BudgetManager({
      maxDurationMs: VERDICT_TIME_RESERVE_MS + MIN_OPTIONAL_EXECUTION_MS,
      maxModelCalls: 100,
    });

    expect(budget.optionalExecutionTimeoutMs(60_000)).toBe(
      MIN_OPTIONAL_EXECUTION_MS,
    );
  });

  it("MIN_OPTIONAL_EXECUTION_MS is 15 seconds", () => {
    expect(MIN_OPTIONAL_EXECUTION_MS).toBe(15_000);
  });
});

// ==========================================================================
// RETESTING Retention Gate
// ==========================================================================

describe("DF-002: RETESTING Skipped When No Tests Retained", () => {
  it(
    "RETESTING skipped when all generated tests are TEST_DEFECT and cleaned up",
    { timeout: 30_000 },
    async () => {
      const repoDir = createTempRepo();
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(
        join(repoDir, "src/utils.ts"),
        "export function add(a: number, b: number) { return a + b; }\n",
      );
      writeFileSync(
        join(repoDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { test: "echo ok" } }),
      );
      gitCommit(repoDir, "init");

      const gateway = createScenarioGateway({
        testGen: {
          shouldGenerate: true,
          reason: "Missing coverage for req-1",
          plans: [
            {
              objective: "Test detection",
              targetBehavior: "Detect valid repositories",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/hallucinated.test.ts",
              classification: "CANDIDATE",
              expectedEvidence: "Test result",
            },
          ],
          proposals: [
            {
              filePath: "tests/hallucinated.test.ts",
              operation: "CREATE",
              classification: "CANDIDATE",
              rationale: "Test repo detection",
              content: `import { describe, it, expect } from 'vitest';
import { detectRepository } from '../src/repositoryDetection';
describe('Detection', () => {
  it('detects', () => { expect(detectRepository('x')).toBeDefined(); });
});`,
              planIndex: 0,
              requirementIds: ["req-1"],
            },
          ],
        },
      });

      const orchestrator = new QEOrchestrator({
        gateway,
        maxModelCalls: 20,
        repositoryProfile: createMockProfile(repoDir),
      });

      const result = await orchestrator.run({
        repositoryPath: repoDir,
        requirements: [{ id: "req-1", description: "Detect repositories" }],
        profile: "standard",
        mode: "repository",
      });

      expect(QEResultSchema.safeParse(result).success).toBe(true);

      // RETESTING should NOT appear in lifecycle history
      const hasRetesting = result.metrics.lifecycleHistory?.some(
        (t) => t.to === "RETESTING",
      );
      expect(hasRetesting).toBe(false);

      // Generated test was cleaned up (not retained)
      const change = result.generatedTestChanges?.find(
        (c) => c.filePath === "tests/hallucinated.test.ts",
      );
      if (change) {
        expect(change.retained).toBe(false);
        expect(change.failureClassification).toBe("TEST_DEFECT");
      }

      // Verdict still formed
      expect(result.verdict).toBeDefined();
      expect(["PASS", "PASS_WITH_CONCERNS", "BLOCKED"]).toContain(
        result.verdict,
      );
    },
  );

  it(
    "RETESTING runs when at least one valid generated test is retained",
    { timeout: 30_000 },
    async () => {
      const repoDir = createTempRepo();
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(
        join(repoDir, "src/utils.ts"),
        "export function add(a: number, b: number) { return a + b; }\n",
      );
      writeFileSync(
        join(repoDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { test: "echo ok" } }),
      );
      gitCommit(repoDir, "init");

      const gateway = createScenarioGateway({
        plan: {
          objectives: [{ id: "obj-1", description: "Verify" }],
          recommendedActions: [
            {
              commandId: "npm-script:test",
              type: "TEST",
              purpose: "Run tests",
              priority: 1,
              riskAddressed: [],
              requirementIds: ["req-1"],
            },
          ],
          identifiedRisks: [],
          expectedCapabilities: [],
          unavailableValidations: [],
        },
        testGen: {
          shouldGenerate: true,
          reason: "Missing coverage",
          plans: [
            {
              objective: "Test utils",
              targetBehavior: "add function returns sum",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/valid.test.ts",
              classification: "CANDIDATE",
              expectedEvidence: "Test result",
            },
          ],
          proposals: [
            {
              filePath: "tests/valid.test.ts",
              operation: "CREATE",
              classification: "CANDIDATE",
              rationale: "Test add function",
              content: `import { describe, it, expect } from 'vitest';
import { add } from '../src/utils';
describe('Utils', () => {
  it('adds numbers', () => { expect(add(1, 2)).toBe(3); });
});`,
              planIndex: 0,
              requirementIds: ["req-1"],
            },
          ],
        },
      });

      const orchestrator = new QEOrchestrator({
        gateway,
        maxModelCalls: 20,
        repositoryProfile: createMockProfile(repoDir),
      });

      const result = await orchestrator.run({
        repositoryPath: repoDir,
        requirements: [{ id: "req-1", description: "Add function works" }],
        profile: "standard",
        mode: "repository",
      });

      expect(QEResultSchema.safeParse(result).success).toBe(true);

      // Valid test should be retained
      expect(result.generatedTestChanges).toBeDefined();
      const change = result.generatedTestChanges?.find(
        (c) => c.filePath === "tests/valid.test.ts",
      );
      expect(change).toBeDefined();
      expect(change!.retained).toBe(true);

      // RETESTING should appear because a retained test exists
      const hasRetesting = result.metrics.lifecycleHistory?.some(
        (t) => t.to === "RETESTING",
      );
      expect(hasRetesting).toBe(true);
    },
  );
});

// ==========================================================================
// Skipped RETESTING Evidence Semantics
// ==========================================================================

describe("DF-002: Skipped RETESTING Produces No Fake Evidence", () => {
  it(
    "no INCONCLUSIVE/timed-out evidence produced when RETESTING is skipped",
    { timeout: 30_000 },
    async () => {
      const repoDir = createTempRepo();
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(
        join(repoDir, "src/utils.ts"),
        "export function add(a: number, b: number) { return a + b; }\n",
      );
      writeFileSync(
        join(repoDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { test: "echo ok" } }),
      );
      gitCommit(repoDir, "init");

      const gateway = createScenarioGateway({
        testGen: {
          shouldGenerate: true,
          reason: "Missing coverage",
          plans: [
            {
              objective: "Test detection",
              targetBehavior: "Detect input",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/bad-import.test.ts",
              classification: "CANDIDATE",
              expectedEvidence: "Test result",
            },
          ],
          proposals: [
            {
              filePath: "tests/bad-import.test.ts",
              operation: "CREATE",
              classification: "CANDIDATE",
              rationale: "Test detection",
              content: `import { describe, it, expect } from 'vitest';
import { detect } from '../src/nonExistent';
describe('Detection', () => {
  it('works', () => { expect(detect()).toBeDefined(); });
});`,
              planIndex: 0,
              requirementIds: ["req-1"],
            },
          ],
        },
      });

      const orchestrator = new QEOrchestrator({
        gateway,
        maxModelCalls: 20,
        repositoryProfile: createMockProfile(repoDir),
      });

      const result = await orchestrator.run({
        repositoryPath: repoDir,
        requirements: [{ id: "req-1", description: "Detection" }],
        profile: "standard",
        mode: "repository",
      });

      expect(QEResultSchema.safeParse(result).success).toBe(true);

      // No RETESTING stage
      const hasRetesting = result.metrics.lifecycleHistory?.some(
        (t) => t.to === "RETESTING",
      );
      expect(hasRetesting).toBe(false);

      // No timed-out retest evidence — only evidence should be from
      // EXECUTING stage and the generated-test diagnostic
      const retestEvidence = result.evidence.filter(
        (e) => e.summary.includes("Retest:") || e.summary.includes("timed out"),
      );
      expect(retestEvidence).toHaveLength(0);

      // Verdict still formed
      expect(result.verdict).toBeDefined();
    },
  );
});

// ==========================================================================
// Verdict Formation After Skip
// ==========================================================================

describe("DF-002: Verdict Formation After RETESTING Skip", () => {
  it("verdict proceeds normally when RETESTING is skipped", () => {
    const budget = new BudgetManager(createBudgetForProfile("quick"));

    // Simulate stages consuming model calls
    budget.recordModelCall(); // risk
    budget.recordModelCall(); // planning
    budget.recordModelCall(); // gap analysis
    budget.recordModelCall(); // test-gen

    // Verdict should still be affordable
    expect(budget.canAffordModelCall()).toBe(true);
  });

  it("FORMING_VERDICT reachable from GENERATING_TESTS via ANALYZING_GAPS", async () => {
    const { QEStateMachine } = await import("../src/core/lifecycle/index.js");
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING");
    sm.transition("ASSESSING_RISK");
    sm.transition("PLANNING");
    sm.transition("EXECUTING");
    sm.transition("ANALYZING_GAPS");
    sm.transition("GENERATING_TESTS");

    // Skip RETESTING, go to ANALYZING_GAPS then FORMING_VERDICT
    sm.transition("ANALYZING_GAPS");
    sm.transition("FORMING_VERDICT");
    expect(sm.state).toBe("FORMING_VERDICT");
  });
});
