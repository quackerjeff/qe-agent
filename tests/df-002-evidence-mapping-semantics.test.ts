import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGapAnalysisTask } from "../src/prompts/gap-analysis/v1.js";
import { projectEvidenceForModel } from "../src/core/orchestrator/evidence-projection.js";
import {
  createDiscoveryEvidence,
  createLifecycleEvidence,
} from "../src/core/orchestrator/deterministic-grounding.js";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import type { Evidence, RepositoryProfile } from "../src/types/index.js";

const TEST_TIMEOUT = 30_000;

// ---------------------------------------------------------------
// Part D: Prompt Constraint Tests
// ---------------------------------------------------------------
describe("DF-002: Gap-Analysis Prompt Evidence-Mapping Semantics", () => {
  function buildTaskWithMinimalContext() {
    return buildGapAnalysisTask(
      [{ id: "REQ-1", description: "Test requirement" }],
      [
        {
          id: "ev-1",
          type: "TEST_RESULT",
          status: "PASS",
          summary: "Test passed",
        },
      ],
      [],
      { level: "LOW", factors: [] },
    );
  }

  it("D1: constraints state evidence can support multiple requirements", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    const multiUse = constraints.some(
      (c) =>
        c.includes("multiple requirements") &&
        (c.includes("single evidence") || c.includes("same evidence")),
    );
    expect(multiUse).toBe(true);
  });

  it("D2: constraints state evidence is not single-use or consumed", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    const notConsumed = constraints.some(
      (c) =>
        (c.includes("not consume") || c.includes("not reserve")) &&
        c.includes("evidence"),
    );
    expect(notConsumed).toBe(true);
  });

  it("D3: constraints state DISCOVERY_RESULT + OBSERVED is authoritative", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    const discoveryAuthoritative = constraints.some(
      (c) =>
        c.includes("DISCOVERY_RESULT") &&
        c.includes("OBSERVED") &&
        c.includes("authoritative"),
    );
    expect(discoveryAuthoritative).toBe(true);
  });

  it("D4: constraints state LIFECYCLE_OBSERVATION + OBSERVED is authoritative", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    const lifecycleAuthoritative = constraints.some(
      (c) =>
        c.includes("LIFECYCLE_OBSERVATION") &&
        c.includes("OBSERVED") &&
        c.includes("authoritative"),
    );
    expect(lifecycleAuthoritative).toBe(true);
  });

  it("D5: constraints distinguish observed evidence from inference", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    const distinguishes = constraints.some(
      (c) =>
        c.includes("observed") &&
        c.includes("infer") &&
        (c.includes("not inference") ||
          c.includes("not infer") ||
          c.includes("authoritative fact")),
    );
    expect(distinguishes).toBe(true);
  });

  it("D6: constraints state TEST_RESULT represents execution", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    const testExecution = constraints.some(
      (c) =>
        c.includes("TEST_RESULT") &&
        (c.includes("execution") || c.includes("executed")),
    );
    expect(testExecution).toBe(true);
  });

  it("D7: constraints state lifecycle/budget evidence is not proof of test execution", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    const noLifecycleAsTest = constraints.some(
      (c) =>
        (c.includes("lifecycle") || c.includes("budget")) &&
        c.includes("not") &&
        (c.includes("test") || c.includes("execution")) &&
        c.includes("proof"),
    );
    expect(noLifecycleAsTest).toBe(true);
  });

  it("D8: constraints state evidence.details should be used for assessment", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    const useDetails = constraints.some(
      (c) => c.includes("details") && c.includes("evidence"),
    );
    expect(useDetails).toBe(true);
  });

  it("D9: old 'Separate inference from execution' constraint is replaced by three-tier provenance", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    const hasOldConstraint = constraints.some(
      (c) => c === "Separate inference from execution.",
    );
    expect(hasOldConstraint).toBe(false);

    const hasThreeTier = constraints.some(
      (c) =>
        c.includes("executed") && c.includes("observed") && c.includes("infer"),
    );
    expect(hasThreeTier).toBe(true);
  });

  it("D10: original non-evidence constraints are preserved", () => {
    const task = buildTaskWithMinimalContext();
    const constraints = task.constraints!;
    expect(
      constraints.some(
        (c) =>
          c ===
          "A requirement is NOT VERIFIED solely because code implements it.",
      ),
    ).toBe(true);
    expect(
      constraints.some(
        (c) => c === "Evidence must support verification status.",
      ),
    ).toBe(true);
    expect(
      constraints.some(
        (c) => c === "Report all meaningful unverified behavior as gaps.",
      ),
    ).toBe(true);
    expect(
      constraints.some(
        (c) => c === "Do not claim actions occurred unless evidence exists.",
      ),
    ).toBe(true);
    expect(
      constraints.some(
        (c) => c === "Do not generate tests — report TEST_GAP instead.",
      ),
    ).toBe(true);
    expect(
      constraints.some(
        (c) =>
          c ===
          "Keep explanations to one concise sentence citing specific evidence IDs.",
      ),
    ).toBe(true);
    expect(constraints.some((c) => c.includes("FLAKY_TEST"))).toBe(true);
    expect(
      constraints.some((c) => c.includes("test failure by test type")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------
// Part E: Semantic Integration Tests with Deterministic Fake
// ---------------------------------------------------------------

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

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "qe-ev-map-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "test-map", version: "1.0.0" }),
  );
  writeFileSync(join(dir, "index.js"), "// app\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("DF-002: Evidence-to-Requirement Mapping Integration", () => {
  // Generic customer-style requirements (no FR IDs)
  const GENERIC_REQUIREMENTS = [
    {
      id: "REQ-DISCOVERY",
      description:
        "The system shall detect automated test infrastructure in the repository.",
    },
    {
      id: "REQ-QUALITY-TOOLS",
      description:
        "The tool shall identify available linting and type-checking capabilities.",
    },
    {
      id: "REQ-EXECUTION",
      description:
        "The system shall execute the repository's existing automated tests.",
    },
    {
      id: "REQ-CLI",
      description:
        "The application shall support invocation from a local command line.",
    },
    {
      id: "REQ-BUDGETS",
      description:
        "The system shall enforce configured execution time and call limits.",
    },
  ];

  // Evidence matching the dogfood scenario
  const discoveryEvidence = createDiscoveryEvidence(profileWithTools);
  const lifecycleEvidence = createLifecycleEvidence({
    invocationMode: "cli",
    budgetActive: true,
    budgetMaxDurationMs: 120_000,
    budgetMaxModelCalls: 6,
  });
  const testResultEvidence: Evidence = {
    id: "ev-exec-test",
    type: "TEST_RESULT",
    provenance: "executed",
    timestamp: new Date().toISOString(),
    source: "local:npm",
    status: "PASS",
    summary: "Command 'npm run test' succeeded with exit code 0",
    details: {
      executable: "npm",
      args: ["run", "test"],
      exitCode: 0,
      durationMs: 4200,
      timedOut: false,
    },
  };

  const allEvidence: Evidence[] = [
    ...discoveryEvidence,
    ...lifecycleEvidence,
    testResultEvidence,
  ];

  it("E9: one DISCOVERY_RESULT can support multiple requirements", () => {
    const projected = projectEvidenceForModel(allEvidence);

    const task = buildGapAnalysisTask(GENERIC_REQUIREMENTS, projected, [], {
      level: "LOW",
      factors: [],
    });

    // The task supplies exactly one DISCOVERY_RESULT evidence record
    const ctx = task.context as Record<string, unknown>;
    const collected = ctx.collectedEvidence as { id: string; type: string }[];
    const discoveryRecords = collected.filter(
      (e) => e.type === "DISCOVERY_RESULT",
    );
    expect(discoveryRecords.length).toBe(1);
    expect(discoveryRecords[0].id).toBe("ev-discovery-repository");

    // Both REQ-DISCOVERY and REQ-QUALITY-TOOLS are present as requirements
    const reqs = ctx.requirements as { id: string }[];
    expect(reqs.some((r) => r.id === "REQ-DISCOVERY")).toBe(true);
    expect(reqs.some((r) => r.id === "REQ-QUALITY-TOOLS")).toBe(true);

    // The prompt constraints permit the same evidence to support both
    const constraints = task.constraints!;
    expect(
      constraints.some(
        (c) =>
          c.includes("multiple requirements") && c.includes("same evidence"),
      ),
    ).toBe(true);
  });

  it(
    "E10: CLI lifecycle evidence maps to CLI-like requirement via fake",
    async () => {
      const dir = createTestRepo();
      try {
        const gateway = new FakeModelGateway(
          <T>(task: ReasoningTask<T>): T | undefined => {
            switch (task.role) {
              case "change_analyst":
                return {
                  summary: "Change detected",
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
                      requirementId: "REQ-CLI",
                      status: "VERIFIED",
                      evidenceIds: ["ev-lifecycle-invocation"],
                      explanation:
                        "ev-lifecycle-invocation confirms CLI invocation mode.",
                    },
                    {
                      requirementId: "REQ-BUDGETS",
                      status: "PARTIALLY_VERIFIED",
                      evidenceIds: ["ev-lifecycle-budget"],
                      explanation:
                        "ev-lifecycle-budget confirms execution time and call limits are active.",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS_WITH_CONCERNS",
                  confidence: "MEDIUM",
                  reasoning: "Partial coverage",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Partial",
                } as unknown as T;
              case "memory_distiller":
                return {
                  proposals: [],
                  staleEntries: [],
                } as unknown as T;
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
              id: "REQ-CLI",
              description:
                "The application shall support invocation from a local command line.",
            },
            {
              id: "REQ-BUDGETS",
              description:
                "The system shall enforce configured execution time and call limits.",
            },
          ],
          profile: "quick",
          mode: "repository",
        });

        const cliAssessment = result.requirements.find(
          (r) => r.requirementId === "REQ-CLI",
        );
        expect(cliAssessment).toBeDefined();
        expect(cliAssessment!.status).toBe("VERIFIED");
        expect(cliAssessment!.evidenceIds).toContain("ev-lifecycle-invocation");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "E11: budget lifecycle evidence maps to execution-limit requirement via fake",
    async () => {
      const dir = createTestRepo();
      try {
        const gateway = new FakeModelGateway(
          <T>(task: ReasoningTask<T>): T | undefined => {
            switch (task.role) {
              case "change_analyst":
                return {
                  summary: "Change detected",
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
                      requirementId: "REQ-BUDGETS",
                      status: "PARTIALLY_VERIFIED",
                      evidenceIds: ["ev-lifecycle-budget"],
                      explanation:
                        "ev-lifecycle-budget confirms budget configuration with maxDurationMs and maxModelCalls.",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS_WITH_CONCERNS",
                  confidence: "MEDIUM",
                  reasoning: "Partial",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Partial",
                } as unknown as T;
              case "memory_distiller":
                return {
                  proposals: [],
                  staleEntries: [],
                } as unknown as T;
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
              id: "REQ-BUDGETS",
              description:
                "The system shall enforce configured execution time and call limits.",
            },
          ],
          profile: "quick",
          mode: "repository",
        });

        const budgetAssessment = result.requirements.find(
          (r) => r.requirementId === "REQ-BUDGETS",
        );
        expect(budgetAssessment).toBeDefined();
        expect(budgetAssessment!.status).toBe("PARTIALLY_VERIFIED");
        expect(budgetAssessment!.evidenceIds).toContain("ev-lifecycle-budget");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "E12: test execution requirement does not cite budget evidence; budget requirement correctly cites budget evidence",
    async () => {
      const dir = createTestRepo();
      try {
        const gateway = new FakeModelGateway(
          <T>(task: ReasoningTask<T>): T | undefined => {
            switch (task.role) {
              case "change_analyst":
                return {
                  summary: "Change detected",
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
                // Fake model following correct semantics:
                // - does NOT cite budget evidence for test execution
                // - cites budget evidence for budget requirement
                return {
                  gaps: [],
                  requirementAssessments: [
                    {
                      requirementId: "REQ-EXECUTION",
                      status: "NOT_VERIFIED",
                      evidenceIds: [],
                      explanation:
                        "No TEST_RESULT evidence found; budget metadata is not proof of test execution.",
                    },
                    {
                      requirementId: "REQ-BUDGETS",
                      status: "PARTIALLY_VERIFIED",
                      evidenceIds: ["ev-lifecycle-budget"],
                      explanation:
                        "ev-lifecycle-budget confirms budget configuration with maxDurationMs and maxModelCalls.",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS_WITH_CONCERNS",
                  confidence: "MEDIUM",
                  reasoning: "Partial",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Partial",
                } as unknown as T;
              case "memory_distiller":
                return {
                  proposals: [],
                  staleEntries: [],
                } as unknown as T;
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
              id: "REQ-EXECUTION",
              description:
                "The system shall execute the repository's existing automated tests.",
            },
            {
              id: "REQ-BUDGETS",
              description:
                "The system shall enforce configured execution time and call limits.",
            },
          ],
          profile: "quick",
          mode: "repository",
        });

        const execAssessment = result.requirements.find(
          (r) => r.requirementId === "REQ-EXECUTION",
        );
        expect(execAssessment).toBeDefined();
        // Budget evidence must NOT be cited for test execution
        expect(execAssessment!.evidenceIds).not.toContain(
          "ev-lifecycle-budget",
        );
        // Without actual test execution, NOT_VERIFIED is correct
        expect(execAssessment!.status).toBe("NOT_VERIFIED");

        const budgetAssessment = result.requirements.find(
          (r) => r.requirementId === "REQ-BUDGETS",
        );
        expect(budgetAssessment).toBeDefined();
        expect(budgetAssessment!.evidenceIds).toContain("ev-lifecycle-budget");
        expect(budgetAssessment!.status).toBe("PARTIALLY_VERIFIED");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "E13: generic non-FR requirement wording works identically",
    async () => {
      const dir = createTestRepo();
      try {
        const gateway = new FakeModelGateway(
          <T>(task: ReasoningTask<T>): T | undefined => {
            switch (task.role) {
              case "change_analyst":
                return {
                  summary: "Change detected",
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
                      requirementId: "CUST-INFRA",
                      status: "PARTIALLY_VERIFIED",
                      evidenceIds: ["ev-discovery-repository"],
                      explanation:
                        "ev-discovery-repository confirms test frameworks and lint commands discovered.",
                    },
                    {
                      requirementId: "CUST-INVOKE",
                      status: "VERIFIED",
                      evidenceIds: ["ev-lifecycle-invocation"],
                      explanation:
                        "ev-lifecycle-invocation confirms CLI invocation.",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS_WITH_CONCERNS",
                  confidence: "MEDIUM",
                  reasoning: "Partial",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Partial",
                } as unknown as T;
              case "memory_distiller":
                return {
                  proposals: [],
                  staleEntries: [],
                } as unknown as T;
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
              id: "CUST-INFRA",
              description:
                "Automated CI/CD and testing infrastructure must be identified.",
            },
            {
              id: "CUST-INVOKE",
              description: "The tool must be runnable from a terminal.",
            },
          ],
          profile: "quick",
          mode: "repository",
        });

        const infraAssessment = result.requirements.find(
          (r) => r.requirementId === "CUST-INFRA",
        );
        expect(infraAssessment).toBeDefined();
        expect(infraAssessment!.status).toBe("PARTIALLY_VERIFIED");
        expect(infraAssessment!.evidenceIds).toContain(
          "ev-discovery-repository",
        );

        const invokeAssessment = result.requirements.find(
          (r) => r.requirementId === "CUST-INVOKE",
        );
        expect(invokeAssessment).toBeDefined();
        expect(invokeAssessment!.status).toBe("VERIFIED");
        expect(invokeAssessment!.evidenceIds).toContain(
          "ev-lifecycle-invocation",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it("E14: no requirement ID has special runtime meaning", () => {
    // Build two tasks with different requirement IDs but same evidence
    const projected = projectEvidenceForModel(allEvidence);

    const taskFR = buildGapAnalysisTask(
      [
        { id: "FR-003", description: "Test discovery" },
        { id: "FR-031", description: "Local CLI" },
      ],
      projected,
      [],
      { level: "LOW", factors: [] },
    );

    const taskCustom = buildGapAnalysisTask(
      [
        { id: "CUST-1", description: "Test discovery" },
        { id: "CUST-2", description: "Local CLI" },
      ],
      projected,
      [],
      { level: "LOW", factors: [] },
    );

    // Same constraints regardless of requirement IDs
    expect(taskFR.constraints).toEqual(taskCustom.constraints);
    // Same objective
    expect(taskFR.objective).toEqual(taskCustom.objective);
    // Same evidence context
    const ctxFR = taskFR.context as Record<string, unknown>;
    const ctxCustom = taskCustom.context as Record<string, unknown>;
    expect(ctxFR.collectedEvidence).toEqual(ctxCustom.collectedEvidence);
  });

  it(
    "E15: discovery evidence supports both discovery and quality-tool requirements simultaneously",
    async () => {
      const dir = createTestRepo();
      try {
        const gateway = new FakeModelGateway(
          <T>(task: ReasoningTask<T>): T | undefined => {
            switch (task.role) {
              case "change_analyst":
                return {
                  summary: "Change detected",
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
                      requirementId: "REQ-TEST-INFRA",
                      status: "PARTIALLY_VERIFIED",
                      evidenceIds: ["ev-discovery-repository"],
                      explanation:
                        "ev-discovery-repository shows vitest framework discovered.",
                    },
                    {
                      requirementId: "REQ-QUALITY",
                      status: "PARTIALLY_VERIFIED",
                      evidenceIds: ["ev-discovery-repository"],
                      explanation:
                        "ev-discovery-repository shows lint and typecheck commands discovered.",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS_WITH_CONCERNS",
                  confidence: "MEDIUM",
                  reasoning: "Partial",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Partial",
                } as unknown as T;
              case "memory_distiller":
                return {
                  proposals: [],
                  staleEntries: [],
                } as unknown as T;
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
              id: "REQ-TEST-INFRA",
              description:
                "The system shall detect automated test infrastructure.",
            },
            {
              id: "REQ-QUALITY",
              description:
                "The tool shall identify available linting and type-checking capabilities.",
            },
          ],
          profile: "quick",
          mode: "repository",
        });

        // Both requirements cite the same discovery evidence
        const testInfra = result.requirements.find(
          (r) => r.requirementId === "REQ-TEST-INFRA",
        );
        const quality = result.requirements.find(
          (r) => r.requirementId === "REQ-QUALITY",
        );

        expect(testInfra).toBeDefined();
        expect(quality).toBeDefined();
        expect(testInfra!.evidenceIds).toContain("ev-discovery-repository");
        expect(quality!.evidenceIds).toContain("ev-discovery-repository");
        expect(testInfra!.status).toBe("PARTIALLY_VERIFIED");
        expect(quality!.status).toBe("PARTIALLY_VERIFIED");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );
});
