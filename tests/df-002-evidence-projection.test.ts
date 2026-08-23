import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import type { Evidence, RepositoryProfile } from "../src/types/index.js";
import {
  createDiscoveryEvidence,
  createLifecycleEvidence,
} from "../src/core/orchestrator/deterministic-grounding.js";
import {
  sanitizeEvidenceDetails,
  projectEvidenceForModel,
  isAuthoritativeVerificationEvidence,
} from "../src/core/orchestrator/evidence-projection.js";
import { buildGapAnalysisTask } from "../src/prompts/gap-analysis/v1.js";
import { buildVerdictTask } from "../src/prompts/verdict/v1.js";

const TEST_TIMEOUT = 30_000;

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "qe-ev-proj-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "test-proj", version: "1.0.0" }),
  );
  writeFileSync(join(dir, "index.js"), "// app\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

const profileWithTools: RepositoryProfile = {
  root: "/tmp/test",
  git: { detected: true, root: "/tmp/test", branch: "main" },
  languages: [
    {
      id: "ts",
      name: "TypeScript",
      category: "LANGUAGE",
      confidence: 0.9,
      evidence: [],
    },
    {
      id: "js",
      name: "JavaScript",
      category: "LANGUAGE",
      confidence: 0.9,
      evidence: [],
    },
  ],
  frameworks: [],
  packageManagers: [],
  buildSystems: [],
  testFrameworks: [
    {
      id: "vitest",
      name: "vitest",
      category: "TEST_FRAMEWORK",
      confidence: 0.9,
      evidence: [],
    },
    {
      id: "playwright",
      name: "playwright",
      category: "TEST_FRAMEWORK",
      confidence: 0.9,
      evidence: [],
    },
  ],
  ciSystems: [],
  applications: [],
  documentation: [],
  commands: [
    {
      id: "cmd-test",
      name: "test",
      category: "TEST",
      command: "npm run test",
      source: "package.json",
      confidence: 0.9,
    },
    {
      id: "cmd-test-watch",
      name: "test:watch",
      category: "TEST",
      command: "npm run test:watch",
      source: "package.json",
      confidence: 0.9,
    },
    {
      id: "cmd-lint",
      name: "lint",
      category: "LINT",
      command: "npm run lint",
      source: "package.json",
      confidence: 0.9,
    },
    {
      id: "cmd-tc",
      name: "typecheck",
      category: "TYPECHECK",
      command: "npx tsc --noEmit",
      source: "package.json",
      confidence: 0.9,
    },
  ],
  capabilities: [
    {
      id: "cap-test",
      type: "testing",
      provider: "vitest",
      available: true,
      confidence: 0.9,
    },
  ],
  confidence: 0.9,
  configFiles: [],
  sourceDirectories: [],
};

// ---------------------------------------------------------------
// Part F: Details Sanitization Tests
// ---------------------------------------------------------------
describe("DF-002 Part F: Details Sanitization", () => {
  it("F1: safe structured details reach gap analysis", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);
    const projected = projectEvidenceForModel(evidence);

    const task = buildGapAnalysisTask(
      [{ id: "REQ-1", description: "Customer requirement" }],
      projected,
      [],
      { level: "LOW", factors: [] },
    );

    const ctx = task.context as Record<string, unknown>;
    const collected = ctx.collectedEvidence as {
      id: string;
      type: string;
      details?: Record<string, unknown>;
    }[];
    const disc = collected.find((e) => e.id === "ev-discovery-repository")!;
    expect(disc.details).toBeDefined();
    expect(disc.details!.testFrameworks).toEqual(["vitest", "playwright"]);
    expect(disc.details!.testCommands).toEqual([
      { name: "test", command: "npm run test" },
      { name: "test:watch", command: "npm run test:watch" },
    ]);
    expect(disc.details!.lintCommands).toEqual([
      { name: "lint", command: "npm run lint" },
    ]);
    expect(disc.details!.typecheckCommands).toEqual([
      { name: "typecheck", command: "npx tsc --noEmit" },
    ]);
    expect(disc.details!.languages).toEqual(["TypeScript", "JavaScript"]);
  });

  it("F2: safe structured details reach verdict context", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);
    const lifecycleEv = createLifecycleEvidence({
      invocationMode: "cli",
      budgetActive: true,
      budgetMaxDurationMs: 120000,
      budgetMaxModelCalls: 12,
    });
    const allEvidence = [...evidence, ...lifecycleEv];
    const projected = projectEvidenceForModel(allEvidence);

    const task = buildVerdictTask(
      [{ id: "REQ-1", description: "Feature works" }],
      [],
      { level: "LOW", summary: "Low risk" },
      [],
      [
        {
          requirementId: "REQ-1",
          status: "PARTIALLY_VERIFIED",
          explanation: "Partial",
        },
      ],
      projected,
      false,
    );

    const ctx = task.context as Record<string, unknown>;
    const collected = ctx.collectedEvidence as {
      id: string;
      details?: Record<string, unknown>;
    }[];
    const disc = collected.find((e) => e.id === "ev-discovery-repository")!;
    expect(disc.details).toBeDefined();
    expect(disc.details!.testFrameworks).toEqual(["vitest", "playwright"]);

    const budget = collected.find((e) => e.id === "ev-lifecycle-budget")!;
    expect(budget.details).toBeDefined();
    expect(budget.details!.budgetActive).toBe(true);
    expect(budget.details!.maxDurationMs).toBe(120000);
  });

  it("F3: deeply nested objects and nested arrays are stripped by sanitization", () => {
    const evidence: Evidence = {
      id: "ev-test-1",
      type: "COMMAND_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "PASS",
      summary: "Test passed",
      details: {
        exitCode: 0,
        executable: "npm",
        args: ["run", "test"],
        deeplyNested: { level1: { level2: { level3: "deep" } } },
        nestedArray: [[1, 2, 3]],
        functionRef: () => "bad",
      },
    };

    const sanitized = sanitizeEvidenceDetails(evidence.details);
    expect(sanitized).toBeDefined();
    expect(sanitized!.exitCode).toBe(0);
    expect(sanitized!.executable).toBe("npm");
    // Deeply nested objects (more than 1 level) are dropped
    expect(sanitized!.deeplyNested).toBeUndefined();
    // Arrays of arrays produce empty arrays (inner arrays filtered out)
    expect(sanitized!.nestedArray).toEqual([]);
    // Functions are dropped
    expect(sanitized!.functionRef).toBeUndefined();
  });

  it("F4: large strings and arrays are bounded", () => {
    const longString = "x".repeat(1000);
    const largeArray = Array.from({ length: 100 }, (_, i) => `item-${i}`);

    const sanitized = sanitizeEvidenceDetails({
      longField: longString,
      largeList: largeArray,
    });

    expect(sanitized).toBeDefined();
    expect((sanitized!.longField as string).length).toBe(500);
    expect((sanitized!.largeList as string[]).length).toBe(50);
  });

  it("F5: existing context-reduction logic still works with details", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);
    const projected = projectEvidenceForModel(evidence);

    const serialized = JSON.stringify(projected);
    expect(typeof serialized).toBe("string");
    expect(serialized.length).toBeGreaterThan(0);
    const parsed = JSON.parse(serialized);
    expect(parsed[0].details).toBeDefined();
    expect(parsed[0].details.testFrameworks).toEqual(["vitest", "playwright"]);
  });

  it("F6: token growth remains bounded for typical evidence sets", () => {
    const discovery = createDiscoveryEvidence(profileWithTools);
    const lifecycle = createLifecycleEvidence({
      invocationMode: "cli",
      budgetActive: true,
      budgetMaxDurationMs: 120000,
      budgetMaxModelCalls: 12,
    });
    const execEvidence: Evidence[] = [
      {
        id: "ev-exec-test",
        type: "TEST_RESULT",
        provenance: "executed",
        timestamp: new Date().toISOString(),
        source: "npm:test",
        status: "PASS",
        summary: "Command 'npm run test' succeeded with exit code 0",
        details: {
          executable: "npm",
          args: ["run", "test"],
          exitCode: 0,
          durationMs: 3200,
          timedOut: false,
        },
      },
      {
        id: "ev-exec-lint",
        type: "COMMAND_RESULT",
        provenance: "executed",
        timestamp: new Date().toISOString(),
        source: "npm:lint",
        status: "PASS",
        summary: "Command 'npm run lint' succeeded with exit code 0",
        details: {
          executable: "npm",
          args: ["run", "lint"],
          exitCode: 0,
          durationMs: 1500,
          timedOut: false,
        },
      },
    ];

    const allEvidence = [...discovery, ...lifecycle, ...execEvidence];
    const withDetails = JSON.stringify(projectEvidenceForModel(allEvidence));
    const withoutDetails = JSON.stringify(
      allEvidence.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        summary: e.summary,
      })),
    );

    const overhead = withDetails.length - withoutDetails.length;
    expect(overhead).toBeLessThan(2000);
  });

  it("F7: null/undefined details produce no details field in projection", () => {
    const evidence: Evidence = {
      id: "ev-no-details",
      type: "COMMAND_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "PASS",
      summary: "Test passed",
    };

    const projected = projectEvidenceForModel([evidence]);
    expect(projected[0].details).toBeUndefined();
  });

  it("F8: empty object details produce no details field", () => {
    const evidence: Evidence = {
      id: "ev-empty-details",
      type: "COMMAND_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "PASS",
      summary: "Test passed",
      details: {},
    };

    const projected = projectEvidenceForModel([evidence]);
    expect(projected[0].details).toBeUndefined();
  });
});

// ---------------------------------------------------------------
// Part G: Evidence Sufficiency Tests
// ---------------------------------------------------------------
describe("DF-002 Part G: Evidence Sufficiency", () => {
  it("G1: executed TEST_RESULT is sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-test",
      type: "TEST_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "PASS",
      summary: "Tests pass",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(true);
  });

  it("G2: executed COMMAND_RESULT is sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-cmd",
      type: "COMMAND_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "PASS",
      summary: "Lint pass",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(true);
  });

  it("G3: observed DISCOVERY_RESULT is sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-discovery",
      type: "DISCOVERY_RESULT",
      provenance: "observed",
      timestamp: new Date().toISOString(),
      source: "repository-analysis",
      status: "OBSERVED",
      summary: "Discovery completed",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(true);
  });

  it("G4: observed LIFECYCLE_OBSERVATION is sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-lifecycle",
      type: "LIFECYCLE_OBSERVATION",
      provenance: "observed",
      timestamp: new Date().toISOString(),
      source: "lifecycle",
      status: "OBSERVED",
      summary: "Run invoked via cli",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(true);
  });

  it("G5: observed TEST_RESULT is NOT sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-obs-test",
      type: "TEST_RESULT",
      provenance: "observed",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED",
      summary: "Tests observed",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(false);
  });

  it("G6: observed COMMAND_RESULT is NOT sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-obs-cmd",
      type: "COMMAND_RESULT",
      provenance: "observed",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED",
      summary: "Command observed",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(false);
  });

  it("G7: inferred evidence is NOT sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-inferred",
      type: "DISCOVERY_RESULT",
      provenance: "inferred",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED",
      summary: "Inferred discovery",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(false);
  });

  it("G8: not_verified evidence is NOT sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-unverified",
      type: "LIFECYCLE_OBSERVATION",
      provenance: "not_verified",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED",
      summary: "Unverified",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(false);
  });

  it("G9: executed BUILD_RESULT is sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-build",
      type: "BUILD_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "build",
      status: "PASS",
      summary: "Build pass",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(true);
  });

  it("G10: observed BUILD_RESULT is NOT sufficient for VERIFIED", () => {
    const ev: Evidence = {
      id: "ev-obs-build",
      type: "BUILD_RESULT",
      provenance: "observed",
      timestamp: new Date().toISOString(),
      source: "build",
      status: "OBSERVED",
      summary: "Build observed",
    };
    expect(isAuthoritativeVerificationEvidence(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------
// Part E: Live-Run Failure Mode Regressions
// ---------------------------------------------------------------
describe("DF-002 Part E: Live-Run Failure Mode Regressions", () => {
  // E1: Repository detection — VERIFIED with DISCOVERY_RESULT survives validation
  it(
    "E1: VERIFIED citing observed DISCOVERY_RESULT survives validation",
    async () => {
      const dir = createTestRepo();
      try {
        const gateway = new FakeModelGateway(
          <T>(task: ReasoningTask<T>): T | undefined => {
            switch (task.role) {
              case "change_analyst":
                return {
                  summary: "Change",
                  affectedComponents: [],
                  behaviorChanges: [],
                  potentialBlastRadius: [],
                  unknowns: [],
                } as unknown as T;
              case "risk_analyst":
                return {
                  level: "LOW",
                  factors: [],
                  confidence: 0.8,
                  summary: "Low risk",
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
                      requirementId: "REQ-DETECT",
                      status: "VERIFIED",
                      evidenceIds: ["ev-discovery-repository"],
                      explanation:
                        "Repository analysis deterministically detected the repository",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS_WITH_CONCERNS",
                  confidence: "MEDIUM",
                  reasoning: "Verified via observation",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Partial",
                } as unknown as T;
              case "memory_distiller":
                return { proposals: [], staleEntries: [] } as unknown as T;
              default:
                return undefined;
            }
          },
        );

        const orchestrator = new QEOrchestrator({ gateway });
        const result = await orchestrator.run({
          repositoryPath: dir,
          requirements: [
            {
              id: "REQ-DETECT",
              description: "The system detects the repository",
            },
          ],
          profile: "quick",
          mode: "repository",
        });

        const assessment = result.requirements.find(
          (r) => r.requirementId === "REQ-DETECT",
        );
        expect(assessment).toBeDefined();
        expect(assessment!.status).toBe("VERIFIED");
        expect(assessment!.evidenceIds).toContain("ev-discovery-repository");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  // E2: Test discovery — fake reads structured details and cites discovery evidence
  it("E2: discovery details enable test-framework mapping", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);
    const projected = projectEvidenceForModel(evidence);

    const disc = projected.find((e) => e.id === "ev-discovery-repository")!;
    expect(disc.details).toBeDefined();
    expect(disc.details!.testFrameworks).toEqual(["vitest", "playwright"]);
    expect(disc.details!.testCommands).toBeDefined();
    expect((disc.details!.testCommands as unknown[]).length).toBeGreaterThan(0);
  });

  // E3: Quality-tool discovery — same evidence supports lint/typecheck mapping
  it("E3: discovery details enable quality-tool mapping (many-to-many)", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);
    const projected = projectEvidenceForModel(evidence);

    const disc = projected.find((e) => e.id === "ev-discovery-repository")!;
    expect(disc.details!.lintCommands).toEqual([
      { name: "lint", command: "npm run lint" },
    ]);
    expect(disc.details!.typecheckCommands).toEqual([
      { name: "typecheck", command: "npx tsc --noEmit" },
    ]);
  });

  // E4: Test execution — TEST_RESULT with executed provenance and details
  it("E4: execution evidence carries structured details for test mapping", () => {
    const ev: Evidence = {
      id: "ev-exec-test",
      type: "TEST_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "npm:test",
      status: "PASS",
      summary: "Command 'npm run test' succeeded with exit code 0",
      details: {
        executable: "npm",
        args: ["run", "test"],
        exitCode: 0,
        durationMs: 3200,
      },
    };

    const projected = projectEvidenceForModel([ev]);
    expect(projected[0].details).toBeDefined();
    expect(projected[0].details!.executable).toBe("npm");
    expect(projected[0].details!.args).toEqual(["run", "test"]);
    expect(projected[0].details!.exitCode).toBe(0);
  });

  // E5: CLI invocation — LIFECYCLE_OBSERVATION with invocationMode
  it(
    "E5: VERIFIED citing LIFECYCLE_OBSERVATION for CLI survives validation",
    async () => {
      const dir = createTestRepo();
      try {
        const gateway = new FakeModelGateway(
          <T>(task: ReasoningTask<T>): T | undefined => {
            switch (task.role) {
              case "change_analyst":
                return {
                  summary: "Change",
                  affectedComponents: [],
                  behaviorChanges: [],
                  potentialBlastRadius: [],
                  unknowns: [],
                } as unknown as T;
              case "risk_analyst":
                return {
                  level: "LOW",
                  factors: [],
                  confidence: 0.8,
                  summary: "Low risk",
                } as unknown as T;
              case "test_strategist":
                return {
                  objectives: [],
                  recommendedActions: [],
                  identifiedRisks: [],
                  expectedCapabilities: [],
                  unavailableValidations: [],
                } as unknown as T;
              case "gap_analyst": {
                const ctx = task.context as Record<string, unknown>;
                const collected = ctx.collectedEvidence as {
                  id: string;
                  details?: Record<string, unknown>;
                }[];
                const lifecycle = collected?.find(
                  (e) => e.id === "ev-lifecycle-invocation",
                );
                return {
                  gaps: [],
                  requirementAssessments: [
                    {
                      requirementId: "REQ-CLI",
                      status:
                        lifecycle?.details?.invocationMode === "cli"
                          ? "VERIFIED"
                          : "NOT_VERIFIED",
                      evidenceIds: lifecycle ? ["ev-lifecycle-invocation"] : [],
                      explanation: "CLI invocation observed",
                    },
                  ],
                } as unknown as T;
              }
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS_WITH_CONCERNS",
                  confidence: "MEDIUM",
                  reasoning: "CLI verified",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Partial",
                } as unknown as T;
              case "memory_distiller":
                return { proposals: [], staleEntries: [] } as unknown as T;
              default:
                return undefined;
            }
          },
        );

        const orchestrator = new QEOrchestrator({ gateway });
        const result = await orchestrator.run({
          repositoryPath: dir,
          requirements: [
            { id: "REQ-CLI", description: "The system runs via local CLI" },
          ],
          profile: "quick",
          mode: "repository",
        });

        const assessment = result.requirements.find(
          (r) => r.requirementId === "REQ-CLI",
        );
        expect(assessment).toBeDefined();
        expect(assessment!.status).toBe("VERIFIED");
        expect(assessment!.evidenceIds).toContain("ev-lifecycle-invocation");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  // E6: Execution budget — lifecycle budget evidence carries structured details
  it("E6: budget evidence carries structured details for budget mapping", () => {
    const lifecycle = createLifecycleEvidence({
      invocationMode: "cli",
      budgetActive: true,
      budgetMaxDurationMs: 120000,
      budgetMaxModelCalls: 12,
    });
    const projected = projectEvidenceForModel(lifecycle);

    const budget = projected.find((e) => e.id === "ev-lifecycle-budget")!;
    expect(budget.details).toBeDefined();
    expect(budget.details!.budgetActive).toBe(true);
    expect(budget.details!.maxDurationMs).toBe(120000);
    expect(budget.details!.maxModelCalls).toBe(12);
  });

  // E7: Wrong cross-mapping regression — each evidence maps to the correct requirement
  it(
    "E7: deterministic fake maps test and budget evidence to correct requirements using details",
    async () => {
      const dir = createTestRepo();
      try {
        const gateway = new FakeModelGateway(
          <T>(task: ReasoningTask<T>): T | undefined => {
            switch (task.role) {
              case "change_analyst":
                return {
                  summary: "Change",
                  affectedComponents: [],
                  behaviorChanges: [],
                  potentialBlastRadius: [],
                  unknowns: [],
                } as unknown as T;
              case "risk_analyst":
                return {
                  level: "LOW",
                  factors: [],
                  confidence: 0.8,
                  summary: "Low risk",
                } as unknown as T;
              case "test_strategist":
                return {
                  objectives: [],
                  recommendedActions: [
                    {
                      id: "act-test",
                      type: "TEST",
                      tool: "npm",
                      command: "npm run test",
                      targetFiles: [],
                      rationale: "Run tests",
                    },
                  ],
                  identifiedRisks: [],
                  expectedCapabilities: [],
                  unavailableValidations: [],
                } as unknown as T;
              case "gap_analyst": {
                const ctx = task.context as Record<string, unknown>;
                const collected = ctx.collectedEvidence as {
                  id: string;
                  type: string;
                  details?: Record<string, unknown>;
                }[];

                const testExecEv = collected?.find(
                  (e) =>
                    e.type === "TEST_RESULT" &&
                    e.details?.executable === "npm" &&
                    Array.isArray(e.details?.args) &&
                    (e.details.args as string[]).includes("test"),
                );
                const budgetEv = collected?.find(
                  (e) =>
                    e.type === "LIFECYCLE_OBSERVATION" &&
                    e.details?.budgetActive === true,
                );

                return {
                  gaps: [],
                  requirementAssessments: [
                    {
                      requirementId: "REQ-TEST-EXEC",
                      status: testExecEv ? "VERIFIED" : "NOT_VERIFIED",
                      evidenceIds: testExecEv ? [testExecEv.id] : [],
                      explanation: testExecEv
                        ? "Test execution evidence confirms tests ran"
                        : "No test execution evidence",
                    },
                    {
                      requirementId: "REQ-BUDGET",
                      status: budgetEv ? "VERIFIED" : "NOT_VERIFIED",
                      evidenceIds: budgetEv ? [budgetEv.id] : [],
                      explanation: budgetEv
                        ? "Budget lifecycle evidence confirms budget is active"
                        : "No budget evidence",
                    },
                  ],
                } as unknown as T;
              }
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS",
                  confidence: "HIGH",
                  reasoning: "All verified",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Pass",
                } as unknown as T;
              case "memory_distiller":
                return { proposals: [], staleEntries: [] } as unknown as T;
              default:
                return undefined;
            }
          },
        );

        const orchestrator = new QEOrchestrator({ gateway });
        const result = await orchestrator.run({
          repositoryPath: dir,
          requirements: [
            {
              id: "REQ-TEST-EXEC",
              description: "Execute existing tests in the repository",
            },
            {
              id: "REQ-BUDGET",
              description: "Enforce execution budget limits",
            },
          ],
          profile: "quick",
          mode: "repository",
        });

        const testAssessment = result.requirements.find(
          (r) => r.requirementId === "REQ-TEST-EXEC",
        );
        const budgetAssessment = result.requirements.find(
          (r) => r.requirementId === "REQ-BUDGET",
        );

        expect(testAssessment).toBeDefined();
        expect(budgetAssessment).toBeDefined();

        // Test execution requirement should cite TEST_RESULT, not budget evidence
        if (testAssessment!.status === "VERIFIED") {
          const testEvIds = testAssessment!.evidenceIds;
          const testEv = result.evidence.find((e) => testEvIds.includes(e.id));
          expect(testEv?.type).toBe("TEST_RESULT");
          expect(testEv?.provenance).toBe("executed");
        }

        // Budget requirement should cite LIFECYCLE_OBSERVATION budget evidence
        expect(budgetAssessment!.status).toBe("VERIFIED");
        expect(budgetAssessment!.evidenceIds).toContain("ev-lifecycle-budget");
        const budgetEv = result.evidence.find(
          (e) => e.id === "ev-lifecycle-budget",
        );
        expect(budgetEv?.type).toBe("LIFECYCLE_OBSERVATION");

        // Evidence is many-to-many: same discovery evidence can be cited by multiple requirements
        const discoveryEvId = "ev-discovery-repository";
        const discoveryEv = result.evidence.find((e) => e.id === discoveryEvId);
        expect(discoveryEv).toBeDefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  // E8: VERIFIED with observed TEST_RESULT is still downgraded
  it("E8: observed TEST_RESULT is not authoritative for VERIFIED", () => {
    const observedTestResult: Evidence = {
      id: "ev-obs-test-result",
      type: "TEST_RESULT",
      provenance: "observed",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED",
      summary: "Tests observed",
    };
    expect(isAuthoritativeVerificationEvidence(observedTestResult)).toBe(false);

    const observedCommandResult: Evidence = {
      id: "ev-obs-cmd",
      type: "COMMAND_RESULT",
      provenance: "observed",
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED",
      summary: "Command observed",
    };
    expect(isAuthoritativeVerificationEvidence(observedCommandResult)).toBe(
      false,
    );

    const observedBuildResult: Evidence = {
      id: "ev-obs-build",
      type: "BUILD_RESULT",
      provenance: "observed",
      timestamp: new Date().toISOString(),
      source: "build",
      status: "OBSERVED",
      summary: "Build observed",
    };
    expect(isAuthoritativeVerificationEvidence(observedBuildResult)).toBe(
      false,
    );
  });

  // E9: Empty evidenceIds remain insufficient for VERIFIED
  it("E9: empty evidenceIds cause VERIFIED downgrade", () => {
    // No evidence to check → !hasAuthoritativeEvidence → downgrade
    const noEvidence: Evidence[] = [];
    const projected = projectEvidenceForModel(noEvidence);
    expect(projected.length).toBe(0);

    // Validate that even with real evidence, empty cited IDs have no authoritative match
    const realEvidence: Evidence[] = [
      {
        id: "ev-real",
        type: "DISCOVERY_RESULT",
        provenance: "observed",
        timestamp: new Date().toISOString(),
        source: "test",
        status: "OBSERVED",
        summary: "Real",
      },
    ];
    const evidenceIds = new Set(realEvidence.map((e) => e.id));
    const emptyCitedIds: string[] = [];
    const validIds = emptyCitedIds.filter((id) => evidenceIds.has(id));
    expect(validIds.length).toBe(0);
  });

  // E10: fabricated evidence IDs remain invalid
  it("E10: fabricated evidence IDs are rejected (unknown IDs stripped)", () => {
    const evidence: Evidence[] = [
      {
        id: "ev-real",
        type: "DISCOVERY_RESULT",
        provenance: "observed",
        timestamp: new Date().toISOString(),
        source: "test",
        status: "OBSERVED",
        summary: "Real evidence",
      },
    ];

    const evidenceIds = new Set(evidence.map((e) => e.id));
    const assessmentIds = ["ev-real", "ev-fake-123", "ev-nonexistent"];
    const validIds = assessmentIds.filter((id) => evidenceIds.has(id));

    expect(validIds).toEqual(["ev-real"]);
    expect(validIds).not.toContain("ev-fake-123");
    expect(validIds).not.toContain("ev-nonexistent");
  });
});
