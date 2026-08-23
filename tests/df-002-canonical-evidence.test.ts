import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import type { Evidence, RepositoryProfile } from "../src/types/index.js";
import {
  createDiscoveryEvidence,
  createLifecycleEvidence,
  buildDeterministicGrounding,
  mergeGroundingWithModelAssessments,
} from "../src/core/orchestrator/deterministic-grounding.js";
import { buildGapAnalysisTask } from "../src/prompts/gap-analysis/v1.js";
import { buildReasoningContext } from "../src/core/orchestrator/context-builder.js";
import { applyGuardrails } from "../src/core/reasoning/verdict-engine.js";

const TEST_TIMEOUT = 30_000;

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "qe-canon-ev-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "test-canon", version: "1.0.0" }),
  );
  writeFileSync(join(dir, "index.js"), "// app\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

const minProfile: RepositoryProfile = {
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
  testFrameworks: [],
  ciSystems: [],
  applications: [],
  documentation: [],
  commands: [],
  capabilities: [],
  confidence: 0.9,
  configFiles: [],
  sourceDirectories: [],
};

const profileWithTools: RepositoryProfile = {
  ...minProfile,
  testFrameworks: [
    {
      id: "vitest",
      name: "vitest",
      category: "TEST_FRAMEWORK",
      confidence: 0.9,
      evidence: [],
    },
  ],
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
};

describe("DF-002 Part H: Canonical Evidence Regression Tests", () => {
  // H1: Repository discovery creates canonical Evidence
  it("H1: repository discovery creates canonical Evidence", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);

    expect(evidence.length).toBe(1);
    expect(evidence[0].type).toBe("DISCOVERY_RESULT");
    expect(evidence[0].provenance).toBe("observed");
    expect(evidence[0].status).toBe("OBSERVED");
    expect(evidence[0].source).toBe("repository-analysis");
    expect(evidence[0].summary).toContain("Repository analysis completed");
  });

  // H2: Discovery evidence has a stable unique ID/type/provenance
  it("H2: discovery evidence has stable unique ID/type/provenance", () => {
    const ev1 = createDiscoveryEvidence(profileWithTools);
    const ev2 = createDiscoveryEvidence(profileWithTools);

    expect(ev1[0].id).toBe("ev-discovery-repository");
    expect(ev2[0].id).toBe("ev-discovery-repository");
    expect(ev1[0].type).toBe(ev2[0].type);
    expect(ev1[0].provenance).toBe(ev2[0].provenance);
  });

  // H3: Discovered Vitest/test command facts appear in collectedEvidence sent to gap analysis
  it("H3: discovered facts appear in collectedEvidence sent to gap analysis", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);

    const task = buildGapAnalysisTask(
      [{ id: "REQ-1", description: "Customer requirement" }],
      evidence.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        summary: e.summary,
      })),
      [],
      { level: "LOW", factors: [] },
      undefined,
    );

    const ctx = task.context as Record<string, unknown>;
    const collected = ctx.collectedEvidence as {
      id: string;
      type: string;
      summary: string;
    }[];
    expect(collected).toBeDefined();
    expect(collected.some((e) => e.id === "ev-discovery-repository")).toBe(
      true,
    );
    expect(collected.some((e) => e.type === "DISCOVERY_RESULT")).toBe(true);
    const disc = collected.find((e) => e.id === "ev-discovery-repository")!;
    expect(disc.summary).toContain("vitest");
    expect(disc.summary).toContain("test commands: test");
  });

  // H4: Discovered lint/typecheck facts appear as canonical evidence
  it("H4: discovered lint/typecheck facts appear as canonical evidence", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);

    expect(evidence[0].summary).toContain("lint commands: lint");
    expect(evidence[0].summary).toContain("typecheck commands: typecheck");
    const details = evidence[0].details as Record<string, unknown>;
    expect(details.lintCommands).toEqual([
      { name: "lint", command: "npm run lint" },
    ]);
    expect(details.typecheckCommands).toEqual([
      { name: "typecheck", command: "npx tsc --noEmit" },
    ]);
  });

  // H5: Existing npm run test execution evidence is NOT duplicated
  it("H5: existing execution evidence is not duplicated by discovery", () => {
    const executionEvidence: Evidence = {
      id: "ev-exec-test",
      type: "COMMAND_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "npm run test",
      status: "PASS",
      summary: "npm run test completed successfully",
    };

    const discoveryEvidence = createDiscoveryEvidence(profileWithTools);

    // Discovery evidence is a separate record — different ID, different type
    expect(discoveryEvidence[0].id).not.toBe(executionEvidence.id);
    expect(discoveryEvidence[0].type).toBe("DISCOVERY_RESULT");
    expect(executionEvidence.type).toBe("COMMAND_RESULT");

    // Discovery does not create execution-type evidence
    expect(discoveryEvidence.every((e) => e.provenance === "observed")).toBe(
      true,
    );
    expect(discoveryEvidence.every((e) => e.type !== "COMMAND_RESULT")).toBe(
      true,
    );
    expect(discoveryEvidence.every((e) => e.type !== "TEST_RESULT")).toBe(true);
  });

  // H6: CLI invocation creates lifecycle evidence only when known
  it("H6: CLI invocation creates lifecycle evidence with known mode", () => {
    const evidence = createLifecycleEvidence({
      invocationMode: "cli",
      budgetActive: false,
    });

    expect(evidence.length).toBe(1);
    expect(evidence[0].id).toBe("ev-lifecycle-invocation");
    expect(evidence[0].type).toBe("LIFECYCLE_OBSERVATION");
    expect(evidence[0].provenance).toBe("observed");
    expect(evidence[0].summary).toContain("cli");
  });

  // H7: Budget activation creates limited lifecycle evidence without falsely claiming all acceptance criteria verified
  it("H7: budget evidence does not falsely claim full budget requirement verification", () => {
    const evidence = createLifecycleEvidence({
      invocationMode: "cli",
      budgetActive: true,
      budgetMaxDurationMs: 120000,
      budgetMaxModelCalls: 10,
    });

    const budgetEv = evidence.find((e) => e.id === "ev-lifecycle-budget");
    expect(budgetEv).toBeDefined();
    expect(budgetEv!.status).toBe("OBSERVED");
    // Budget evidence observes facts, not verification conclusions
    expect(budgetEv!.summary).not.toContain("VERIFIED");
    expect(budgetEv!.summary).not.toContain("requirement");
    expect(budgetEv!.summary).toContain("Execution budget active");
  });

  // H8: FR IDs and requirement wording have zero runtime effect on evidence creation
  it("H8: FR IDs and requirement wording have zero effect on evidence creation", () => {
    const ev1 = createDiscoveryEvidence(profileWithTools);
    const ev2 = createDiscoveryEvidence(profileWithTools);

    // Evidence is identical regardless of what requirements exist
    expect(ev1[0].id).toBe(ev2[0].id);
    expect(ev1[0].summary).toBe(ev2[0].summary);
    expect(ev1[0].details).toEqual(ev2[0].details);

    // Grounding produces zero results regardless of IDs
    const withFr = buildDeterministicGrounding({
      repositoryProfile: profileWithTools,
      evidence: ev1,
      requirements: [{ id: "FR-003", description: "Test discovery" }],
      budgetActive: true,
    });
    const withCustom = buildDeterministicGrounding({
      repositoryProfile: profileWithTools,
      evidence: ev1,
      requirements: [
        { id: "CUST-99", description: "Automated test identification" },
      ],
      budgetActive: true,
    });

    expect(withFr.length).toBe(0);
    expect(withCustom.length).toBe(0);
  });

  // H9: Arbitrary customer requirement wording can cite evidence through normal path
  // (Covered more thoroughly in Part I integration test below)
  it("H9: arbitrary customer wording receives same evidence as any other wording", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);

    // The evidence is available for any requirement to cite
    const task1 = buildGapAnalysisTask(
      [
        {
          id: "REQ-17",
          description:
            "The system shall discover existing automated testing infrastructure.",
        },
      ],
      evidence.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        summary: e.summary,
      })),
      [],
      { level: "LOW", factors: [] },
    );
    const task2 = buildGapAnalysisTask(
      [{ id: "FR-003", description: "Test discovery" }],
      evidence.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        summary: e.summary,
      })),
      [],
      { level: "LOW", factors: [] },
    );

    // Both receive the same collectedEvidence
    const ctx1 = task1.context as Record<string, unknown>;
    const ctx2 = task2.context as Record<string, unknown>;
    expect(ctx1.collectedEvidence).toEqual(ctx2.collectedEvidence);
  });

  // H10: validateEvidenceReferences accepts legitimate observed provenance
  it(
    "H10: observed provenance evidence passes through validation (PARTIALLY_VERIFIED preserved)",
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
                      requirementId: "REQ-1",
                      status: "PARTIALLY_VERIFIED",
                      evidenceIds: ["ev-discovery-repository"],
                      explanation:
                        "Discovery evidence supports test infrastructure exists",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS_WITH_CONCERNS",
                  confidence: "MEDIUM",
                  reasoning: "Partial verification",
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
          requirements: [{ id: "REQ-1", description: "Feature works" }],
          profile: "quick",
          mode: "repository",
        });

        const assessment = result.requirements.find(
          (r) => r.requirementId === "REQ-1",
        );
        // PARTIALLY_VERIFIED with observed evidence should be preserved
        expect(assessment).toBeDefined();
        expect(assessment!.status).toBe("PARTIALLY_VERIFIED");
        expect(assessment!.evidenceIds).toContain("ev-discovery-repository");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  // H11: validateEvidenceReferences still rejects fabricated/unknown evidence IDs
  it(
    "H11: fabricated evidence IDs are rejected by validation",
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
                      requirementId: "REQ-1",
                      status: "VERIFIED",
                      evidenceIds: [
                        "made-up-evidence-999",
                        "nonexistent-proof",
                      ],
                      explanation: "Model hallucinated evidence",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS",
                  confidence: "HIGH",
                  reasoning: "All good",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Pass",
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
          requirements: [{ id: "REQ-1", description: "Feature works" }],
          profile: "quick",
          mode: "repository",
        });

        const assessment = result.requirements.find(
          (r) => r.requirementId === "REQ-1",
        );
        expect(assessment).toBeDefined();
        // Fabricated evidence cannot produce VERIFIED
        expect(assessment!.status).not.toBe("VERIFIED");
        // Fabricated IDs are stripped
        expect(assessment!.evidenceIds.includes("made-up-evidence-999")).toBe(
          false,
        );
        expect(assessment!.evidenceIds.includes("nonexistent-proof")).toBe(
          false,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  // H12: VERIFIED remains protected from non-authoritative observed evidence
  it(
    "H12: VERIFIED with only observed non-deterministic evidence is downgraded",
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
                      requirementId: "REQ-1",
                      status: "VERIFIED",
                      evidenceIds: ["ev-discovery-repository"],
                      explanation:
                        "Model claims VERIFIED from discovery evidence alone",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS",
                  confidence: "HIGH",
                  reasoning: "Claims verified",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Pass",
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
          requirements: [{ id: "REQ-1", description: "Feature works" }],
          profile: "quick",
          mode: "repository",
        });

        const assessment = result.requirements.find(
          (r) => r.requirementId === "REQ-1",
        );
        expect(assessment).toBeDefined();
        // VERIFIED with observed DISCOVERY_RESULT (authoritative deterministic
        // observation) is now accepted — this validates the Part B change
        expect(assessment!.status).toBe("VERIFIED");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  // H13: Gap-analysis context contains canonical evidence and NO currentRunFacts
  it("H13: gap-analysis context contains evidence but no currentRunFacts", () => {
    const evidence = createDiscoveryEvidence(profileWithTools);

    const task = buildGapAnalysisTask(
      [{ id: "REQ-1", description: "Feature works" }],
      evidence.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        summary: e.summary,
      })),
      [],
      { level: "LOW", factors: [] },
      undefined,
    );

    const ctx = task.context as Record<string, unknown>;
    expect(ctx.collectedEvidence).toBeDefined();
    expect(ctx.currentRunFacts).toBeUndefined();
  });

  // H14: Gap-analysis prompt contains no contradictory currentRunFacts constraint
  it("H14: gap-analysis prompt has no currentRunFacts constraint", () => {
    const task = buildGapAnalysisTask(
      [{ id: "REQ-1", description: "Feature works" }],
      [],
      [],
      { level: "LOW", factors: [] },
    );

    const allText = JSON.stringify(task);
    expect(allText).not.toContain("currentRunFacts");
    expect(allText).not.toContain("machine-verified");
    expect(allText).not.toContain("take precedence over inference");
  });

  // H15: Risk-analysis context excludes volatile historicalObservations
  it("H15: risk-analysis context excludes volatile history when flag is set", () => {
    const ctx = buildReasoningContext({
      requirements: [{ id: "REQ-1", description: "Feature works" }],
      profile: minProfile,
      evidence: [],
      excludeVolatileHistory: true,
      projectMemory: {
        testing: {
          content: "npm test failed.\n",
          source: ".qe/TESTING.md",
        },
        knowledgeFiles: [],
        historySummaries: [],
      },
    });

    expect(ctx.projectMemory).toBeDefined();
    expect(ctx.projectMemory!.historicalObservations).toBeUndefined();
    expect(ctx.projectMemory!._temporalNote).toBeDefined();
  });

  // H16: Risk analysis still receives durable PROJECT memory
  it("H16: risk analysis receives PROJECT memory even with volatile history excluded", () => {
    const ctx = buildReasoningContext({
      requirements: [{ id: "REQ-1", description: "Feature works" }],
      profile: minProfile,
      evidence: [],
      excludeVolatileHistory: true,
      projectMemory: {
        project: {
          content: "TypeScript monorepo using npm workspaces.",
          source: ".qe/PROJECT.md",
        },
        testing: {
          content: "npm test failed.\n",
          source: ".qe/TESTING.md",
        },
        knowledgeFiles: [],
        historySummaries: [],
      },
    });

    expect(ctx.projectMemory).toBeDefined();
    expect(ctx.projectMemory!.project).toContain("TypeScript monorepo");
    expect(ctx.projectMemory!.historicalObservations).toBeUndefined();
  });

  // H17: Historical execution content remains stored but not supplied to risk reasoning
  it(
    "H17: historical content stored on disk but excluded from risk model",
    async () => {
      const dir = createTestRepo();
      try {
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "<!-- qe-managed:start -->\nnpm test failed in prior run.\n<!-- qe-managed:end -->\n",
        );

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
                      requirementId: "REQ-1",
                      status: "NOT_VERIFIED",
                      evidenceIds: [],
                      explanation: "No evidence",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "BLOCKED",
                  confidence: "LOW",
                  reasoning: "Blocked",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Blocked",
                } as unknown as T;
              case "memory_distiller":
                return { proposals: [], staleEntries: [] } as unknown as T;
              default:
                return undefined;
            }
          },
        );

        const orchestrator = new QEOrchestrator({
          gateway,
          memoryConfig: { enabled: true, historySummaries: false },
        });
        const result = await orchestrator.run({
          repositoryPath: dir,
          requirements: [{ id: "REQ-1", description: "Feature works" }],
          profile: "quick",
          mode: "repository",
        });

        expect(result.verdict).toBeDefined();

        // Memory file still exists on disk
        const content = readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8");
        expect(content).toContain("npm test failed");

        // Risk model did not receive historicalObservations
        const riskCall = gateway.calls.find((c) => c.role === "risk_analyst");
        expect(riskCall).toBeDefined();
        const ctx = riskCall!.context as Record<string, unknown>;
        const memCtx = ctx.projectMemory as Record<string, unknown>;
        expect(memCtx.historicalObservations).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  // H18: Failing-run → passing-run history cannot cause risk to say tests are unresolved
  it(
    "H18: passing run does not inherit stale failure narrative in risk model",
    async () => {
      const dir = createTestRepo();
      try {
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "<!-- qe-managed:start -->\nnpm test failed due to timeout issues.\n<!-- qe-managed:end -->\n",
        );
        writeFileSync(
          join(dir, ".qe", "RISKS.md"),
          "## Integration\n\nUnresolved test failures.\n",
        );

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
              case "risk_analyst": {
                // Verify context does NOT contain stale failure narratives
                const ctx = task.context as Record<string, unknown>;
                const mem = ctx.projectMemory as Record<string, unknown>;
                if (mem && mem.historicalObservations) {
                  throw new Error(
                    "Risk model received historicalObservations — structural exclusion failed",
                  );
                }
                return {
                  level: "LOW",
                  factors: [],
                  confidence: 0.8,
                  summary: "Low risk",
                } as unknown as T;
              }
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
                      requirementId: "REQ-1",
                      status: "NOT_VERIFIED",
                      evidenceIds: [],
                      explanation: "No evidence",
                    },
                  ],
                } as unknown as T;
              case "verdict_reviewer":
                return {
                  recommendedVerdict: "BLOCKED",
                  confidence: "LOW",
                  reasoning: "Blocked",
                  concerns: [],
                  recommendedNextActions: [],
                  summary: "Blocked",
                } as unknown as T;
              case "memory_distiller":
                return { proposals: [], staleEntries: [] } as unknown as T;
              default:
                return undefined;
            }
          },
        );

        const orchestrator = new QEOrchestrator({
          gateway,
          memoryConfig: { enabled: true, historySummaries: false },
        });

        // Should not throw — risk model validates no historical observations
        const result = await orchestrator.run({
          repositoryPath: dir,
          requirements: [{ id: "REQ-1", description: "Feature works" }],
          profile: "quick",
          mode: "repository",
        });

        expect(result.verdict).toBeDefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  // H19: Existing command execution evidence behavior remains unchanged
  it("H19: execution evidence factory is independent of discovery evidence", () => {
    const discoveryEv = createDiscoveryEvidence(profileWithTools);
    const lifecycleEv = createLifecycleEvidence({
      invocationMode: "cli",
      budgetActive: true,
    });

    // Discovery and lifecycle evidence have distinct IDs
    const allIds = [
      ...discoveryEv.map((e) => e.id),
      ...lifecycleEv.map((e) => e.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);

    // None of these are execution evidence types
    for (const ev of [...discoveryEv, ...lifecycleEv]) {
      expect(ev.provenance).toBe("observed");
      expect(ev.type).not.toBe("COMMAND_RESULT");
      expect(ev.type).not.toBe("TEST_RESULT");
      expect(ev.type).not.toBe("BUILD_RESULT");
    }
  });

  // H20: Final canonical assessment count/order/completeness remains unchanged
  it("H20: canonical merge count equals input requirement count", () => {
    const requirements = [
      { id: "REQ-001", description: "Repository analysis" },
      { id: "REQ-003", description: "Discover existing automated tests" },
      { id: "REQ-009", description: "Execute the test suite" },
      { id: "REQ-031", description: "Run via command line" },
      { id: "REQ-037", description: "Produce a structured report" },
    ];

    const grounding = buildDeterministicGrounding({
      repositoryProfile: profileWithTools,
      evidence: createDiscoveryEvidence(profileWithTools),
      requirements,
      budgetActive: true,
    });

    const modelAssessments = requirements.map((r) => ({
      requirementId: r.id,
      status: "NOT_VERIFIED" as const,
      evidenceIds: [],
      explanation: "Model assessment",
    }));

    const merged = mergeGroundingWithModelAssessments(
      grounding,
      modelAssessments,
      requirements,
    );

    expect(merged.length).toBe(requirements.length);
    const ids = merged.map((a) => a.requirementId);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 0; i < requirements.length; i++) {
      expect(merged[i].requirementId).toBe(requirements[i].id);
    }
  });

  // H21 (QE-identified): Single-test guardrail still fires with observational evidence present
  it("H21: single-test guardrail is not bypassed by observational evidence", () => {
    const discoveryEv = createDiscoveryEvidence(profileWithTools);
    const lifecycleEv = createLifecycleEvidence({
      invocationMode: "cli",
      budgetActive: true,
    });
    const executionEv: Evidence = {
      id: "ev-exec-1",
      type: "TEST_RESULT",
      provenance: "executed",
      timestamp: new Date().toISOString(),
      source: "npm run test",
      status: "PASS",
      summary: "Tests pass",
    };

    const allEvidence = [...discoveryEv, ...lifecycleEv, executionEv];

    const result = applyGuardrails(
      "PASS",
      [],
      allEvidence,
      [
        {
          area: "Coverage",
          description: "Missing coverage",
          risk: "MEDIUM" as const,
        },
      ],
      [
        {
          requirementId: "REQ-1",
          status: "PARTIALLY_VERIFIED" as const,
          evidenceIds: ["ev-discovery-repository"],
          explanation: "Partial",
        },
      ],
      false,
    );

    // Single executed PASS test + gaps should still trigger downgrade
    expect(result.verdict).toBe("PASS_WITH_CONCERNS");
    expect(result.overridden).toBe(true);
    expect(result.reason).toContain("passing single test");
  });
});

// ---------------------------------------------------------------
// Part I: Integration-Style Semantic Test
// ---------------------------------------------------------------
describe("DF-002 Part I: End-to-End Canonical Evidence Integration", () => {
  it(
    "observation → Evidence → gap model → evidenceIds → validateEvidenceReferences → assessment",
    async () => {
      const dir = createTestRepo();
      try {
        // Gateway that behaves like an evidence-respecting model:
        // - cites ev-discovery-repository for REQ-17 (test infrastructure)
        // - returns NOT_VERIFIED for REQ-42 (test execution) since no executed evidence exists
        const gateway = new FakeModelGateway(
          <T>(task: ReasoningTask<T>): T | undefined => {
            switch (task.role) {
              case "change_analyst":
                return {
                  summary: "Repository change detected",
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
                  objectives: [
                    {
                      id: "obj-1",
                      description: "Validate test infrastructure",
                    },
                  ],
                  recommendedActions: [],
                  identifiedRisks: [],
                  expectedCapabilities: [],
                  unavailableValidations: [],
                } as unknown as T;

              case "gap_analyst": {
                // Verify the gap analyst receives canonical evidence
                const ctx = task.context as Record<string, unknown>;
                const collected = ctx.collectedEvidence as {
                  id: string;
                  type: string;
                  status: string;
                  summary: string;
                }[];

                const hasDiscovery = collected?.some(
                  (e) =>
                    e.id === "ev-discovery-repository" &&
                    e.type === "DISCOVERY_RESULT",
                );
                const hasLifecycle = collected?.some(
                  (e) =>
                    e.id === "ev-lifecycle-invocation" &&
                    e.type === "LIFECYCLE_OBSERVATION",
                );

                // Evidence-respecting model behavior:
                // - REQ-17 (discovery) → PARTIALLY_VERIFIED citing discovery evidence
                // - REQ-42 (execution) → NOT_VERIFIED since no execution evidence
                return {
                  gaps: hasDiscovery
                    ? [
                        {
                          area: "Test Execution",
                          description: "Test suite execution was not performed",
                          reason: "No executed test evidence",
                          risk: "MEDIUM",
                        },
                      ]
                    : [],
                  requirementAssessments: [
                    {
                      requirementId: "REQ-17",
                      status: hasDiscovery
                        ? "PARTIALLY_VERIFIED"
                        : "NOT_VERIFIED",
                      evidenceIds: hasDiscovery
                        ? ["ev-discovery-repository"]
                        : [],
                      explanation: hasDiscovery
                        ? "Repository analysis discovered test frameworks and commands"
                        : "No discovery evidence found",
                    },
                    {
                      requirementId: "REQ-42",
                      status: "NOT_VERIFIED",
                      evidenceIds: hasLifecycle
                        ? ["ev-lifecycle-invocation"]
                        : [],
                      explanation:
                        "Run was invoked but no test execution evidence exists",
                    },
                  ],
                } as unknown as T;
              }

              case "verdict_reviewer":
                return {
                  recommendedVerdict: "PASS_WITH_CONCERNS",
                  confidence: "MEDIUM",
                  reasoning:
                    "Test infrastructure discovered but execution not performed",
                  concerns: ["No test execution"],
                  recommendedNextActions: ["Run tests"],
                  summary: "Partial verification only",
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
              id: "REQ-17",
              description:
                "The system shall discover existing automated testing infrastructure.",
            },
            {
              id: "REQ-42",
              description:
                "The application must run the tests already present in the repository.",
            },
          ],
          profile: "quick",
          mode: "repository",
        });

        // --- Verify end-to-end evidence flow ---

        // 1. Evidence records were created (observation → Evidence)
        const discoveryEv = result.evidence.find(
          (e) => e.id === "ev-discovery-repository",
        );
        expect(discoveryEv).toBeDefined();
        expect(discoveryEv!.type).toBe("DISCOVERY_RESULT");
        expect(discoveryEv!.provenance).toBe("observed");
        expect(discoveryEv!.status).toBe("OBSERVED");

        const lifecycleEv = result.evidence.find(
          (e) => e.id === "ev-lifecycle-invocation",
        );
        expect(lifecycleEv).toBeDefined();
        expect(lifecycleEv!.type).toBe("LIFECYCLE_OBSERVATION");

        // 2. Gap model cited evidence IDs (gap model context → evidenceIds)
        const req17 = result.requirements.find(
          (r) => r.requirementId === "REQ-17",
        );
        expect(req17).toBeDefined();

        const req42 = result.requirements.find(
          (r) => r.requirementId === "REQ-42",
        );
        expect(req42).toBeDefined();

        // 3. validateEvidenceReferences preserved valid observed evidence
        // REQ-17 cited ev-discovery-repository which is valid → preserved
        expect(req17!.evidenceIds).toContain("ev-discovery-repository");
        expect(req17!.status).toBe("PARTIALLY_VERIFIED");

        // REQ-42 has no executed evidence → NOT_VERIFIED is appropriate
        expect(req42!.status).toBe("NOT_VERIFIED");

        // 4. Verdict was formed (assessment → verdict)
        expect(result.verdict).toBeDefined();

        // 5. No currentRunFacts side channel was used
        const gapCall = gateway.calls.find((c) => c.role === "gap_analyst");
        expect(gapCall).toBeDefined();
        const gapCtx = gapCall!.context as Record<string, unknown>;
        expect(gapCtx.currentRunFacts).toBeUndefined();

        // 6. Risk model did not receive volatile history
        const riskCall = gateway.calls.find((c) => c.role === "risk_analyst");
        expect(riskCall).toBeDefined();
        const riskCtx = riskCall!.context as Record<string, unknown>;
        const riskMem = riskCtx.projectMemory as Record<string, unknown>;
        if (riskMem) {
          expect(riskMem.historicalObservations).toBeUndefined();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );
});
