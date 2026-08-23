import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import { ProjectMemoryManager } from "../src/core/memory/manager.js";
import type {
  QERequest,
  QEResult,
  MemoryUpdateProposal,
} from "../src/types/index.js";
import type { ProjectMemory } from "../src/core/memory/types.js";
import {
  buildReasoningContext,
  stripManagedMarkers,
  extractManagedContent,
  filterMemoryForDistillation,
} from "../src/core/orchestrator/context-builder.js";
import { buildRiskAnalysisTask } from "../src/prompts/risk-analysis/v1.js";
import { buildMemoryDistillationTask } from "../src/prompts/memory-distillation/v1.js";
import {
  buildDeterministicGrounding,
  createDiscoveryEvidence,
  createLifecycleEvidence,
  mergeGroundingWithModelAssessments,
} from "../src/core/orchestrator/deterministic-grounding.js";
import { buildGapAnalysisTask } from "../src/prompts/gap-analysis/v1.js";
import type { RepositoryProfile } from "../src/types/index.js";

const TEST_TIMEOUT = 30_000;

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "qe-stale-mem-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "test-stale", version: "1.0.0" }),
  );
  writeFileSync(join(dir, "index.js"), "// app\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

function createFakeGateway(
  memoryProposals: MemoryUpdateProposal[] = [],
  staleEntries: {
    source: string;
    reason: string;
    proposedCorrection?: string;
  }[] = [],
): FakeModelGateway {
  return new FakeModelGateway(<T>(task: ReasoningTask<T>): T | undefined => {
    switch (task.role) {
      case "change_analyst":
        return {
          summary: "Code change detected",
          affectedComponents: [],
          behaviorChanges: [],
          potentialBlastRadius: [],
          unknowns: [],
        } as unknown as T;

      case "risk_analyst":
        return {
          level: "MEDIUM",
          factors: [
            { factor: "change", reason: "Code changed", weight: "medium" },
          ],
          confidence: 0.7,
          summary: "Medium risk change",
        } as unknown as T;

      case "test_strategist":
        return {
          objectives: [{ id: "obj-1", description: "Validate change" }],
          recommendedActions: [],
          identifiedRisks: ["change"],
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
              explanation: "No execution evidence",
            },
          ],
        } as unknown as T;

      case "verdict_reviewer":
        return {
          recommendedVerdict: "PASS",
          confidence: "MEDIUM",
          reasoning: "No critical failures",
          concerns: [],
          recommendedNextActions: [],
          summary: "QE run complete",
        } as unknown as T;

      case "memory_distiller":
        return {
          proposals: memoryProposals,
          staleEntries,
        } as unknown as T;

      default:
        return undefined;
    }
  });
}

function runQE(
  dir: string,
  gateway: FakeModelGateway,
  memoryEnabled = true,
): Promise<QEResult> {
  const orchestrator = new QEOrchestrator({
    gateway,
    memoryConfig: { enabled: memoryEnabled, historySummaries: false },
  });

  const request: QERequest = {
    repositoryPath: dir,
    requirements: [{ id: "REQ-1", description: "Feature works" }],
    profile: "quick",
    mode: "repository",
  };

  return orchestrator.run(request);
}

describe("DF-002 Stale Memory Correction", () => {
  // ---------------------------------------------------------------
  // 8: Exact stale-memory regression test
  // ---------------------------------------------------------------
  describe("8: Stale memory does not contaminate pre-execution reasoning", () => {
    let dir: string;
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it(
      "8A: volatile history structurally excluded from risk analysis",
      async () => {
        dir = createTestRepo();
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "Integration tests should be reviewed and fixed to ensure they pass.\n" +
            "npm run test failed due to timeout issues.\n",
        );
        writeFileSync(
          join(dir, ".qe", "RISKS.md"),
          "## Integration\n\nUnresolved integration test issues raise concerns about security and data sensitivity.\n",
        );
        mkdirSync(join(dir, ".qe", "knowledge"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "knowledge", "command-success-rates.md"),
          "The failure of 'npm run test' indicates potential issues.\n",
        );

        const gateway = createFakeGateway([], []);
        await runQE(dir, gateway);

        const riskCall = gateway.calls.find((c) => c.role === "risk_analyst");
        expect(riskCall).toBeDefined();

        const ctx = riskCall!.context as Record<string, unknown>;
        const memCtx = ctx.projectMemory as Record<string, unknown>;
        expect(memCtx).toBeDefined();
        expect(memCtx._temporalNote).toBeDefined();

        // Risk analysis must NOT receive volatile historicalObservations
        expect(memCtx.historicalObservations).toBeUndefined();
        expect(memCtx.testing).toBeUndefined();

        // Planner still receives historicalObservations (data not deleted)
        const planCall = gateway.calls.find(
          (c) => c.role === "test_strategist",
        );
        if (planCall) {
          const planCtx = planCall.context as Record<string, unknown>;
          const planMem = planCtx.projectMemory as Record<string, unknown>;
          if (planMem) {
            const planHist = planMem.historicalObservations as
              { source: string; content: string }[] | undefined;
            expect(planHist).toBeDefined();
            expect(planHist!.some((o) => o.source === "TESTING")).toBe(true);
          }
        }
      },
      TEST_TIMEOUT,
    );

    it(
      "8B: stale testing memory excluded from risk, not in primary testing field",
      async () => {
        dir = createTestRepo();
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "npm run test failed due to timeout.\n" +
            "Integration tests should be fixed.\n",
        );

        const gateway = createFakeGateway([], []);
        await runQE(dir, gateway);

        const riskCall = gateway.calls.find((c) => c.role === "risk_analyst");
        const ctx = riskCall!.context as Record<string, unknown>;
        const memCtx = ctx.projectMemory as Record<string, unknown>;

        // Legacy content NOT in risk analysis at all
        expect(memCtx.testing).toBeUndefined();
        expect(memCtx.historicalObservations).toBeUndefined();
      },
      TEST_TIMEOUT,
    );

    it("8C: risk prompt constraint references historical memory", () => {
      const ctx = buildReasoningContext({
        requirements: [{ id: "REQ-1", description: "test" }],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
      });

      const task = buildRiskAnalysisTask(ctx);
      const constraints = task.constraints ?? [];

      const historicalConstraint = constraints.find(
        (c) => c.includes("historical") && c.includes("prior QE runs"),
      );
      expect(historicalConstraint).toBeDefined();
      expect(historicalConstraint).toContain(
        "Do not state that tests currently fail",
      );
    });
  });

  // ---------------------------------------------------------------
  // 9: Repeated memory accumulation prevention
  // ---------------------------------------------------------------
  describe("9: Memory does not accumulate semantically duplicate paragraphs", () => {
    it("9A: buildFinalContent wraps TESTING content in managed sections", async () => {
      const dir = createTestRepo();
      try {
        const manager = new ProjectMemoryManager();
        const emptyMemory: ProjectMemory = {
          knowledgeFiles: [],
          historySummaries: [],
        };

        // First write: creates file with managed sections
        const { results } = await manager.applyUpdates(
          dir,
          [
            {
              target: "TESTING",
              operation: "ADD",
              rationale: "Run observation",
              content: "Integration tests need fixing.",
              confidence: 0.8,
            },
          ],
          emptyMemory,
        );
        expect(results[0].applied).toBe(true);

        const content1 = readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8");
        expect(content1).toContain("<!-- qe-managed:start -->");
        expect(content1).toContain("<!-- qe-managed:end -->");
        expect(content1).toContain("Integration tests need fixing.");

        // Second write: should REPLACE managed section, not append
        const { memory: loadedMemory } = await manager.load(dir);
        const { results: results2 } = await manager.applyUpdates(
          dir,
          [
            {
              target: "TESTING",
              operation: "UPDATE",
              rationale: "Updated observation",
              content: "Tests are now passing.",
              confidence: 0.9,
            },
          ],
          loadedMemory,
        );
        expect(results2[0].applied).toBe(true);

        const content2 = readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8");
        expect(content2).toContain("Tests are now passing.");
        expect(content2).not.toContain("Integration tests need fixing.");

        // Third write: should also replace
        const { memory: loadedMemory2 } = await manager.load(dir);
        const { results: results3 } = await manager.applyUpdates(
          dir,
          [
            {
              target: "TESTING",
              operation: "UPDATE",
              rationale: "Another observation",
              content: "All tests pass reliably.",
              confidence: 0.9,
            },
          ],
          loadedMemory2,
        );
        expect(results3[0].applied).toBe(true);

        const content3 = readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8");
        expect(content3).toContain("All tests pass reliably.");
        expect(content3).not.toContain("Tests are now passing.");
        expect(content3).not.toContain("Integration tests need fixing.");

        // Verify only ONE managed section exists
        const managedStarts = (
          content3.match(/<!-- qe-managed:start -->/g) ?? []
        ).length;
        const managedEnds = (content3.match(/<!-- qe-managed:end -->/g) ?? [])
          .length;
        expect(managedStarts).toBe(1);
        expect(managedEnds).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("9B: RISKS content uses managed sections to prevent accumulation", async () => {
      const dir = createTestRepo();
      try {
        const manager = new ProjectMemoryManager();
        const emptyMemory: ProjectMemory = {
          knowledgeFiles: [],
          historySummaries: [],
        };

        // First write
        await manager.applyUpdates(
          dir,
          [
            {
              target: "RISKS",
              operation: "ADD",
              rationale: "Risk observation",
              content: "Integration test issues raise concerns.",
              confidence: 0.8,
            },
          ],
          emptyMemory,
        );

        // Second write with similar content
        const { memory } = await manager.load(dir);
        await manager.applyUpdates(
          dir,
          [
            {
              target: "RISKS",
              operation: "UPDATE",
              rationale: "Updated risk",
              content: "No current integration test issues.",
              confidence: 0.9,
            },
          ],
          memory,
        );

        const content = readFileSync(join(dir, ".qe", "RISKS.md"), "utf-8");
        expect(content).toContain("No current integration test issues.");
        expect(content).not.toContain("raise concerns");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("9C: KNOWLEDGE content uses managed sections", async () => {
      const dir = createTestRepo();
      try {
        const manager = new ProjectMemoryManager();
        const emptyMemory: ProjectMemory = {
          knowledgeFiles: [],
          historySummaries: [],
        };

        await manager.applyUpdates(
          dir,
          [
            {
              target: "KNOWLEDGE",
              operation: "ADD",
              topic: "command-rates",
              rationale: "Command outcomes",
              content: "npm test failed in prior run.",
              confidence: 0.8,
            },
          ],
          emptyMemory,
        );

        const content1 = readFileSync(
          join(dir, ".qe", "knowledge", "command-rates.md"),
          "utf-8",
        );
        expect(content1).toContain("<!-- qe-managed:start -->");

        // Update replaces
        const { memory } = await manager.load(dir);
        await manager.applyUpdates(
          dir,
          [
            {
              target: "KNOWLEDGE",
              operation: "UPDATE",
              topic: "command-rates",
              rationale: "Updated outcomes",
              content: "All commands pass.",
              confidence: 0.9,
            },
          ],
          memory,
        );

        const content2 = readFileSync(
          join(dir, ".qe", "knowledge", "command-rates.md"),
          "utf-8",
        );
        expect(content2).toContain("All commands pass.");
        expect(content2).not.toContain("npm test failed");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ---------------------------------------------------------------
  // 10: Historical-failure-then-pass
  // ---------------------------------------------------------------
  describe("10: Historical failure does not contaminate pass run", () => {
    let dir: string;
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it(
      "10A: run N records failure, run N+1 (all pass) — risk model does not see stale failures",
      async () => {
        dir = createTestRepo();

        // Run N: simulate failure being recorded in memory
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "<!-- qe-managed:start -->\nnpm run test failed due to import errors.\n<!-- qe-managed:end -->\n",
        );
        writeFileSync(
          join(dir, ".qe", "RISKS.md"),
          "<!-- qe-managed:start -->\n## Test Failures\n\nUnresolved test failures indicate risk.\n<!-- qe-managed:end -->\n",
        );

        // Run N+1: all commands pass
        const gateway = createFakeGateway(
          [
            {
              target: "TESTING",
              operation: "UPDATE",
              rationale: "Tests now pass",
              content: "All test commands pass.",
              confidence: 0.95,
            },
          ],
          [],
        );
        await runQE(dir, gateway);

        // Risk model must NOT receive volatile history
        const riskCall = gateway.calls.find((c) => c.role === "risk_analyst");
        expect(riskCall).toBeDefined();
        const ctx = riskCall!.context as Record<string, unknown>;
        const memCtx = ctx.projectMemory as Record<string, unknown>;
        expect(memCtx._temporalNote).toBeDefined();
        expect(memCtx.historicalObservations).toBeUndefined();

        // Planner still receives historical context
        const planCall = gateway.calls.find(
          (c) => c.role === "test_strategist",
        );
        if (planCall) {
          const planCtx = planCall.context as Record<string, unknown>;
          const planMem = planCtx.projectMemory as Record<string, unknown>;
          if (planMem) {
            const histObs = planMem.historicalObservations as
              { source: string; content: string }[] | undefined;
            expect(histObs).toBeDefined();
            const testingObs = histObs!.find(
              (o: { source: string }) => o.source === "TESTING",
            );
            expect(testingObs).toBeDefined();
            expect(testingObs!.content).toContain("npm run test failed");
            expect(testingObs!.content).not.toContain("<!-- qe-managed");
          }
        }

        // After the run, memory is updated to reflect passing state
        const updatedContent = readFileSync(
          join(dir, ".qe", "TESTING.md"),
          "utf-8",
        );
        expect(updatedContent).toContain("All test commands pass.");
        expect(updatedContent).not.toContain("npm run test failed");
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------
  // 11: Historical-failure-then-fail
  // ---------------------------------------------------------------
  describe("11: Historical failure + current failure remains authoritative", () => {
    let dir: string;
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it(
      "11A: current FAIL evidence is authoritative — risk model does not see stale history",
      async () => {
        dir = createTestRepo();

        // Write historical failure memory
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "<!-- qe-managed:start -->\nnpm test failed in prior run.\n<!-- qe-managed:end -->\n",
        );

        // Gateway that records historical context but doesn't override behavior
        const gateway = createFakeGateway(
          [
            {
              target: "TESTING",
              operation: "UPDATE",
              rationale: "Tests still failing",
              content: "npm test continues to fail.",
              confidence: 0.9,
            },
          ],
          [],
        );
        const result = await runQE(dir, gateway);

        // Verdict model should still function normally
        expect(result.verdict).toBeDefined();

        // Risk model must NOT receive volatile history
        const riskCall = gateway.calls.find((c) => c.role === "risk_analyst");
        const ctx = riskCall!.context as Record<string, unknown>;
        const memCtx = ctx.projectMemory as Record<string, unknown>;
        expect(memCtx.historicalObservations).toBeUndefined();

        // Planner still receives historical context
        const planCall = gateway.calls.find(
          (c) => c.role === "test_strategist",
        );
        if (planCall) {
          const planCtx = planCall.context as Record<string, unknown>;
          const planMem = planCtx.projectMemory as Record<string, unknown>;
          if (planMem) {
            const histObs = planMem.historicalObservations as
              { source: string; content: string }[] | undefined;
            expect(histObs).toBeDefined();
          }
        }

        // Memory updated with current observation
        const updatedContent = readFileSync(
          join(dir, ".qe", "TESTING.md"),
          "utf-8",
        );
        expect(updatedContent).toContain("npm test continues to fail.");
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------
  // 12: Durable memory preservation
  // ---------------------------------------------------------------
  describe("12: Durable repository facts still influence reasoning", () => {
    let dir: string;
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it(
      "12A: PROJECT durable facts stay in project field; risk model excludes volatile history",
      async () => {
        dir = createTestRepo();
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "## Test Commands\n\nCanonical test command: `npm test`\nTest framework: Vitest\n",
        );
        writeFileSync(
          join(dir, ".qe", "PROJECT.md"),
          "## Architecture\n\nTypeScript monorepo using npm workspaces.\n",
        );

        const gateway = createFakeGateway([], []);
        await runQE(dir, gateway);

        const riskCall = gateway.calls.find((c) => c.role === "risk_analyst");
        const ctx = riskCall!.context as Record<string, unknown>;
        const memCtx = ctx.projectMemory as Record<string, unknown>;

        // PROJECT content is always durable — stays in project field
        expect(memCtx.project).toBeDefined();
        expect(String(memCtx.project)).toContain("TypeScript monorepo");

        // Risk model does NOT receive volatile history (excludeVolatileHistory)
        expect(memCtx.testing).toBeUndefined();
        expect(memCtx.historicalObservations).toBeUndefined();

        // Planner still receives historical observations
        const planCall = gateway.calls.find(
          (c) => c.role === "test_strategist",
        );
        if (planCall) {
          const planCtx = planCall.context as Record<string, unknown>;
          const planMem = planCtx.projectMemory as Record<string, unknown>;
          if (planMem) {
            const histObs = planMem.historicalObservations as
              { source: string; content: string }[] | undefined;
            if (histObs) {
              const testingObs = histObs.find((o) => o.source === "TESTING");
              expect(testingObs).toBeDefined();
              expect(testingObs!.content).toContain("npm test");
            }
          }
        }
      },
      TEST_TIMEOUT,
    );

    it(
      "12B: unmanaged knowledge files excluded from risk model via volatile history exclusion",
      async () => {
        dir = createTestRepo();
        mkdirSync(join(dir, ".qe", "knowledge"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "knowledge", "architecture.md"),
          "The repository uses a layered architecture with adapters, core, and prompts.\n",
        );

        const gateway = createFakeGateway([], []);
        await runQE(dir, gateway);

        // Risk model does NOT receive volatile history
        const riskCall = gateway.calls.find((c) => c.role === "risk_analyst");
        const ctx = riskCall!.context as Record<string, unknown>;
        const memCtx = ctx.projectMemory as Record<string, unknown>;
        expect(memCtx.knowledgeFiles).toBeUndefined();
        expect(memCtx.historicalObservations).toBeUndefined();

        // Planner still receives quarantined knowledge
        const planCall = gateway.calls.find(
          (c) => c.role === "test_strategist",
        );
        if (planCall) {
          const planCtx = planCall.context as Record<string, unknown>;
          const planMem = planCtx.projectMemory as Record<string, unknown>;
          if (planMem) {
            const histObs = planMem.historicalObservations as
              { source: string; content: string }[] | undefined;
            if (histObs) {
              expect(
                histObs.some(
                  (o) =>
                    o.source === "KNOWLEDGE/architecture" &&
                    o.content.includes("layered architecture"),
                ),
              ).toBe(true);
            }
          }
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------
  // 13: Existing memory file safety
  // ---------------------------------------------------------------
  describe("13: Existing memory files are preserved", () => {
    it("13A: user-authored content in TESTING.md survives QE update", async () => {
      const dir = createTestRepo();
      try {
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "## Developer Notes\n\nAlways run tests with NODE_ENV=test.\n\n## CI Notes\n\nCI uses parallel test sharding.\n",
        );

        const gateway = createFakeGateway(
          [
            {
              target: "TESTING",
              operation: "UPDATE",
              rationale: "QE observation",
              content: "Test suite runs in 45 seconds.",
              confidence: 0.8,
            },
          ],
          [],
        );
        await runQE(dir, gateway);

        const content = readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8");
        // User content preserved
        expect(content).toContain("Developer Notes");
        expect(content).toContain("NODE_ENV=test");
        expect(content).toContain("CI Notes");
        expect(content).toContain("parallel test sharding");
        // QE content in managed section
        expect(content).toContain("Test suite runs in 45 seconds.");
        expect(content).toContain("<!-- qe-managed:start -->");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("13B: user-authored content in RISKS.md survives QE update", async () => {
      const dir = createTestRepo();
      try {
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "RISKS.md"),
          "## Payment Processing\n\nBoundary tests needed for negative refunds.\n\nAdded by: Jane Doe\n",
        );

        const gateway = createFakeGateway(
          [
            {
              target: "RISKS",
              operation: "ADD",
              topic: "auth",
              rationale: "Auth risk",
              content: "## Auth\n\nAuth middleware is high-risk.\n",
              confidence: 0.85,
            },
          ],
          [],
        );
        await runQE(dir, gateway);

        const content = readFileSync(join(dir, ".qe", "RISKS.md"), "utf-8");
        expect(content).toContain("Payment Processing");
        expect(content).toContain("Jane Doe");
        expect(content).toContain("Auth middleware is high-risk.");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("13C: existing .qe files are not deleted by QE run", async () => {
      const dir = createTestRepo();
      try {
        mkdirSync(join(dir, ".qe", "knowledge"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "Existing testing content.\n",
        );
        writeFileSync(
          join(dir, ".qe", "RISKS.md"),
          "Existing risks content.\n",
        );
        writeFileSync(
          join(dir, ".qe", "knowledge", "custom.md"),
          "Custom knowledge.\n",
        );

        const gateway = createFakeGateway([], []);
        await runQE(dir, gateway);

        // All files still exist
        expect(existsSync(join(dir, ".qe", "TESTING.md"))).toBe(true);
        expect(existsSync(join(dir, ".qe", "RISKS.md"))).toBe(true);
        expect(existsSync(join(dir, ".qe", "knowledge", "custom.md"))).toBe(
          true,
        );

        // Content preserved
        expect(readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8")).toContain(
          "Existing testing content",
        );
        expect(readFileSync(join(dir, ".qe", "RISKS.md"), "utf-8")).toContain(
          "Existing risks content",
        );
        expect(
          readFileSync(join(dir, ".qe", "knowledge", "custom.md"), "utf-8"),
        ).toContain("Custom knowledge");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ---------------------------------------------------------------
  // Unit tests: buildFinalContent managed sections
  // ---------------------------------------------------------------
  describe("buildFinalContent managed sections", () => {
    it("new TESTING file is wrapped in managed sections", async () => {
      const dir = createTestRepo();
      try {
        const manager = new ProjectMemoryManager();
        const emptyMemory: ProjectMemory = {
          knowledgeFiles: [],
          historySummaries: [],
        };

        await manager.applyUpdates(
          dir,
          [
            {
              target: "TESTING",
              operation: "ADD",
              rationale: "Observation",
              content: "Tests use Vitest",
              confidence: 0.9,
            },
          ],
          emptyMemory,
        );

        const content = readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8");
        expect(content).toBe(
          "<!-- qe-managed:start -->\nTests use Vitest\n<!-- qe-managed:end -->\n",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("existing file without managed sections gets managed section appended", async () => {
      const dir = createTestRepo();
      try {
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "## User Notes\n\nManual testing checklist.\n",
        );

        const manager = new ProjectMemoryManager();
        const { memory } = await manager.load(dir);

        await manager.applyUpdates(
          dir,
          [
            {
              target: "TESTING",
              operation: "ADD",
              rationale: "QE observation",
              content: "npm test passes in 10s",
              confidence: 0.9,
            },
          ],
          memory,
        );

        const content = readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8");
        expect(content).toContain("## User Notes");
        expect(content).toContain("Manual testing checklist.");
        expect(content).toContain("<!-- qe-managed:start -->");
        expect(content).toContain("npm test passes in 10s");
        expect(content).toContain("<!-- qe-managed:end -->");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("existing managed section is replaced on update", async () => {
      const dir = createTestRepo();
      try {
        mkdirSync(join(dir, ".qe"), { recursive: true });
        writeFileSync(
          join(dir, ".qe", "TESTING.md"),
          "## User Notes\n\nChecklist.\n\n<!-- qe-managed:start -->\nOld QE content\n<!-- qe-managed:end -->\n",
        );

        const manager = new ProjectMemoryManager();
        const { memory } = await manager.load(dir);

        await manager.applyUpdates(
          dir,
          [
            {
              target: "TESTING",
              operation: "UPDATE",
              rationale: "New observation",
              content: "New QE content here",
              confidence: 0.9,
            },
          ],
          memory,
        );

        const content = readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8");
        expect(content).toContain("User Notes");
        expect(content).toContain("Checklist.");
        expect(content).toContain("New QE content here");
        expect(content).not.toContain("Old QE content");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("PROJECT target does not use managed sections", async () => {
      const dir = createTestRepo();
      try {
        const manager = new ProjectMemoryManager();
        const emptyMemory: ProjectMemory = {
          knowledgeFiles: [],
          historySummaries: [],
        };

        await manager.applyUpdates(
          dir,
          [
            {
              target: "PROJECT",
              operation: "ADD",
              rationale: "Project info",
              content: "TypeScript project using npm",
              confidence: 0.9,
            },
          ],
          emptyMemory,
        );

        const content = readFileSync(join(dir, ".qe", "PROJECT.md"), "utf-8");
        expect(content).toBe("TypeScript project using npm");
        expect(content).not.toContain("<!-- qe-managed");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ---------------------------------------------------------------
  // Unit tests: context-builder temporal framing
  // ---------------------------------------------------------------
  describe("context-builder temporal framing", () => {
    it("_temporalNote is added when projectMemory is provided", () => {
      const ctx = buildReasoningContext({
        requirements: [],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
        projectMemory: {
          testing: {
            content:
              "<!-- qe-managed:start -->\nTests use Vitest\n<!-- qe-managed:end -->\n",
            source: ".qe/TESTING.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      expect(ctx.projectMemory).toBeDefined();
      expect(ctx.projectMemory!._temporalNote).toBeDefined();
      expect(ctx.projectMemory!._temporalNote).toContain("prior QE runs");
      // Managed testing content is quarantined to historicalObservations
      expect(ctx.projectMemory!.historicalObservations).toBeDefined();
      expect(
        ctx.projectMemory!.historicalObservations!.some(
          (o) => o.source === "TESTING" && o.content.includes("Vitest"),
        ),
      ).toBe(true);
    });

    it("unmanaged testing content quarantined to historicalObservations", () => {
      const ctx = buildReasoningContext({
        requirements: [],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
        projectMemory: {
          testing: {
            content: "Tests use Vitest",
            source: ".qe/TESTING.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      expect(ctx.projectMemory).toBeDefined();
      expect(ctx.projectMemory!.historicalObservations).toBeDefined();
      expect(
        ctx.projectMemory!.historicalObservations!.some(
          (o) => o.source === "TESTING" && o.content.includes("Vitest"),
        ),
      ).toBe(true);
    });

    it("managed markers are stripped from context content", () => {
      const ctx = buildReasoningContext({
        requirements: [],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
        projectMemory: {
          testing: {
            content:
              "<!-- qe-managed:start -->\nTests use Vitest\n<!-- qe-managed:end -->\n",
            source: ".qe/TESTING.md",
          },
          risks: {
            entries: [
              {
                topic: "<!-- qe-managed:start -->",
                content: "Risk details\n<!-- qe-managed:end -->",
              },
            ],
            source: ".qe/RISKS.md",
          },
          knowledgeFiles: [
            {
              name: "commands",
              content:
                "<!-- qe-managed:start -->\nnpm test works\n<!-- qe-managed:end -->\n",
              source: ".qe/knowledge/commands.md",
            },
          ],
          historySummaries: [],
        },
      });

      // All TESTING/RISKS/KNOWLEDGE content quarantined to historicalObservations
      const histObs = ctx.projectMemory!.historicalObservations!;
      expect(histObs).toBeDefined();

      // TESTING content present, markers stripped
      const testingObs = histObs.find((o) => o.source === "TESTING");
      expect(testingObs).toBeDefined();
      expect(testingObs!.content).toBe("Tests use Vitest");
      expect(testingObs!.content).not.toContain("<!-- qe-managed");

      // RISKS content present, markers stripped
      const risksObs = histObs.find((o) => o.source === "RISKS");
      expect(risksObs).toBeDefined();
      expect(risksObs!.content).not.toContain("<!-- qe-managed");

      // KNOWLEDGE content present, markers stripped
      const knowledgeObs = histObs.find(
        (o) => o.source === "KNOWLEDGE/commands",
      );
      expect(knowledgeObs).toBeDefined();
      expect(knowledgeObs!.content).toBe("npm test works");
      expect(knowledgeObs!.content).not.toContain("<!-- qe-managed");
    });

    it("no projectMemory field when not provided", () => {
      const ctx = buildReasoningContext({
        requirements: [],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
      });

      expect(ctx.projectMemory).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // Unit tests: stripManagedMarkers
  // ---------------------------------------------------------------
  describe("stripManagedMarkers", () => {
    it("strips start and end markers", () => {
      const input =
        "<!-- qe-managed:start -->\nSome content\n<!-- qe-managed:end -->\n";
      expect(stripManagedMarkers(input)).toBe("Some content");
    });

    it("returns content unchanged when no markers present", () => {
      const input = "Just normal content here.";
      expect(stripManagedMarkers(input)).toBe("Just normal content here.");
    });

    it("handles empty content", () => {
      expect(stripManagedMarkers("")).toBe("");
    });

    it("handles content with markers mid-text", () => {
      const input =
        "User notes.\n\n<!-- qe-managed:start -->\nQE content\n<!-- qe-managed:end -->\n\nMore notes.";
      expect(stripManagedMarkers(input)).toBe(
        "User notes.\n\nQE content\n\nMore notes.",
      );
    });
  });

  // ---------------------------------------------------------------
  // Risk prompt constraint verification
  // ---------------------------------------------------------------
  describe("risk prompt historical-memory constraint", () => {
    it("risk analysis task includes historical-memory constraint", () => {
      const ctx = buildReasoningContext({
        requirements: [{ id: "REQ-1", description: "test" }],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
      });

      const task = buildRiskAnalysisTask(ctx);
      const constraints = task.constraints ?? [];

      expect(
        constraints.some(
          (c) => c.includes("prior QE runs") && c.includes("historical"),
        ),
      ).toBe(true);

      expect(
        constraints.some((c) =>
          c.includes("Do not state that tests currently fail"),
        ),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Memory distillation prompt constraint verification
  // ---------------------------------------------------------------
  describe("memory distillation accumulation constraint", () => {
    it("distillation task includes dedup constraint", () => {
      const task = buildMemoryDistillationTask({
        repositoryRoot: "/tmp/test",
        executionId: "test-001",
        evidence: [],
        findings: [],
        verdict: "PASS",
        discoveredCommands: [],
        existingMemory: { knowledgeFiles: [], historySummaries: [] },
      });

      const constraints = task.constraints ?? [];
      expect(
        constraints.some(
          (c) => c.includes("semantically duplicate") && c.includes("TESTING"),
        ),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // 6: Legacy TESTING quarantine
  // ---------------------------------------------------------------
  describe("6: Legacy unmanaged TESTING content quarantined from primary context", () => {
    it("6A: pure legacy TESTING file excluded from testing field", () => {
      const ctx = buildReasoningContext({
        requirements: [{ id: "REQ-1", description: "test" }],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
        projectMemory: {
          testing: {
            content:
              "Integration tests should be reviewed and fixed.\n" +
              "npm run test failed due to timeout issues.\n",
            source: ".qe/TESTING.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      expect(ctx.projectMemory!.historicalObservations).toBeDefined();
      expect(
        ctx.projectMemory!.historicalObservations!.some(
          (o) =>
            o.source === "TESTING" &&
            o.content.includes("Integration tests") &&
            o.content.includes("timeout issues"),
        ),
      ).toBe(true);
    });

    it("6B: mixed file — all content quarantined to historicalObservations", () => {
      const ctx = buildReasoningContext({
        requirements: [],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
        projectMemory: {
          testing: {
            content:
              "## Developer Notes\n\nAlways run with NODE_ENV=test.\n\n" +
              "<!-- qe-managed:start -->\nAll tests pass in 12s.\n<!-- qe-managed:end -->\n",
            source: ".qe/TESTING.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      // ALL testing content (managed + legacy) quarantined to historicalObservations
      const histObs = ctx.projectMemory!.historicalObservations!;
      expect(histObs).toBeDefined();
      const testingObs = histObs.find((o) => o.source === "TESTING");
      expect(testingObs).toBeDefined();
      expect(testingObs!.content).toContain("Developer Notes");
      expect(testingObs!.content).toContain("All tests pass in 12s.");
    });

    it("6C: managed-only TESTING file — still quarantined to historicalObservations", () => {
      const ctx = buildReasoningContext({
        requirements: [],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
        projectMemory: {
          testing: {
            content:
              "<!-- qe-managed:start -->\nTests pass reliably.\n<!-- qe-managed:end -->\n",
            source: ".qe/TESTING.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      // Even managed-only testing content is quarantined as historical
      expect(ctx.projectMemory!.historicalObservations).toBeDefined();
      expect(
        ctx.projectMemory!.historicalObservations!.some(
          (o) => o.source === "TESTING" && o.content === "Tests pass reliably.",
        ),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // 7: Legacy RISKS quarantine
  // ---------------------------------------------------------------
  describe("7: Legacy unmanaged RISKS content quarantined from primary context", () => {
    it("7A: pure legacy RISKS entries quarantined to historicalObservations", () => {
      const ctx = buildReasoningContext({
        requirements: [],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
        projectMemory: {
          risks: {
            entries: [
              {
                topic: "Integration",
                content:
                  "Unresolved integration test issues raise concerns about security.",
              },
            ],
            source: ".qe/RISKS.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      const histObs = ctx.projectMemory!.historicalObservations;
      expect(histObs).toBeDefined();
      expect(histObs!.some((o) => o.source === "RISKS")).toBe(true);
      expect(
        histObs!.some((o) => o.content.includes("integration test issues")),
      ).toBe(true);
    });

    it("7B: legacy KNOWLEDGE files quarantined to historicalObservations", () => {
      const ctx = buildReasoningContext({
        requirements: [],
        profile: {
          root: "/tmp/test",
          languages: [],
          frameworks: [],
          testFrameworks: [],
          commands: [],
          capabilities: [],
          packageManagers: [],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
        projectMemory: {
          knowledgeFiles: [
            {
              name: "command-success-rates",
              content:
                "The failure of 'npm run test' indicates potential issues.",
              source: ".qe/knowledge/command-success-rates.md",
            },
          ],
          historySummaries: [],
        },
      });

      const histObs = ctx.projectMemory!.historicalObservations;
      expect(histObs).toBeDefined();
      expect(
        histObs!.some(
          (o) =>
            o.source === "KNOWLEDGE/command-success-rates" &&
            o.content.includes("npm run test"),
        ),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // 8: Generic test category preservation
  // ---------------------------------------------------------------
  describe("8: Generic test category not renamed by historical memory", () => {
    it("8D: npm run test category preserved, not converted to integration tests", () => {
      const ctx = buildReasoningContext({
        requirements: [{ id: "REQ-1", description: "Validate" }],
        profile: {
          root: "/tmp/test",
          languages: [{ name: "TypeScript" }],
          frameworks: [],
          testFrameworks: [{ name: "vitest" }],
          commands: [
            {
              id: "cmd-1",
              name: "test",
              category: "test",
              command: "npm run test",
            },
          ],
          capabilities: [],
          packageManagers: [{ name: "npm" }],
          configFiles: [],
          sourceDirectories: [],
        },
        evidence: [],
        projectMemory: {
          testing: {
            content:
              "Integration tests should be reviewed and fixed to ensure they pass.\n" +
              "npm run test failed due to timeout issues.\n",
            source: ".qe/TESTING.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      // The repository profile command is "npm run test" with category "test"
      const testCmd = ctx.repositoryProfile.commands.find(
        (c) => c.command === "npm run test",
      );
      expect(testCmd).toBeDefined();
      expect(testCmd!.category).toBe("test");

      // It's quarantined — the model cannot treat it as current
      const histObs = ctx.projectMemory!.historicalObservations;
      expect(histObs).toBeDefined();
      expect(histObs!.some((o) => o.source === "TESTING")).toBe(true);
    });

    it(
      "8E: end-to-end — risk model receives no volatile history at all",
      async () => {
        const dir = createTestRepo();
        try {
          mkdirSync(join(dir, ".qe"), { recursive: true });
          writeFileSync(
            join(dir, ".qe", "TESTING.md"),
            "Integration tests should be reviewed and fixed.\n" +
              "npm run test failed due to timeout issues.\n",
          );
          writeFileSync(
            join(dir, ".qe", "RISKS.md"),
            "## Integration\n\nUnresolved integration test issues raise concerns.\n",
          );
          mkdirSync(join(dir, ".qe", "knowledge"), { recursive: true });
          writeFileSync(
            join(dir, ".qe", "knowledge", "cmd-rates.md"),
            "The failure of 'npm run test' indicates potential issues.\n",
          );

          const gateway = createFakeGateway([], []);
          await runQE(dir, gateway);

          const riskCall = gateway.calls.find((c) => c.role === "risk_analyst");
          const ctx = riskCall!.context as Record<string, unknown>;
          const memCtx = ctx.projectMemory as Record<string, unknown>;

          // Primary fields must NOT contain legacy stale content
          expect(memCtx.testing).toBeUndefined();
          expect(memCtx.knowledgeFiles).toBeUndefined();

          // Risk model must NOT receive volatile history (structurally excluded)
          expect(memCtx.historicalObservations).toBeUndefined();

          // Durable project memory (if present) is still included
          expect(memCtx._temporalNote).toBeDefined();
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------
  // extractManagedContent unit tests
  // ---------------------------------------------------------------
  describe("extractManagedContent", () => {
    it("returns legacy only for content without managed sections", () => {
      const result = extractManagedContent(
        "Old freeform content about failures.",
      );
      expect(result.managed).toBeNull();
      expect(result.legacy).toBe("Old freeform content about failures.");
    });

    it("returns managed only for content with only managed sections", () => {
      const result = extractManagedContent(
        "<!-- qe-managed:start -->\nCurrent observations.\n<!-- qe-managed:end -->\n",
      );
      expect(result.managed).toBe("Current observations.");
      expect(result.legacy).toBeNull();
    });

    it("separates managed and legacy for mixed content", () => {
      const result = extractManagedContent(
        "User notes here.\n\n<!-- qe-managed:start -->\nQE observations.\n<!-- qe-managed:end -->\n\nMore user notes.",
      );
      expect(result.managed).toBe("QE observations.");
      expect(result.legacy).toBe("User notes here.\n\nMore user notes.");
    });

    it("returns both null for empty content", () => {
      const result = extractManagedContent("");
      expect(result.managed).toBeNull();
      expect(result.legacy).toBeNull();
    });

    it("returns both null for whitespace-only content", () => {
      const result = extractManagedContent("   \n  \n  ");
      expect(result.managed).toBeNull();
      expect(result.legacy).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // DF-002 PART E: 16 Required Regression Tests
  // ---------------------------------------------------------------
  describe("DF-002 Part E: Historical memory isolation + deterministic grounding", () => {
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

    // E1: Legacy unmanaged stale TESTING memory does not become current state
    it("E1: legacy unmanaged stale TESTING memory does not become current state", () => {
      const ctx = buildReasoningContext({
        requirements: [{ id: "REQ-1", description: "Feature works" }],
        profile: minProfile,
        evidence: [],
        projectMemory: {
          testing: {
            content: "npm run test failed due to timeout issues.\n",
            source: ".qe/TESTING.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      expect(ctx.projectMemory!.historicalObservations).toBeDefined();
      expect(
        ctx.projectMemory!.historicalObservations!.some(
          (o) => o.source === "TESTING" && o.content.includes("timeout"),
        ),
      ).toBe(true);
      // No primary testing/risks/knowledgeFiles fields
      expect(
        (ctx.projectMemory as Record<string, unknown>).testing,
      ).toBeUndefined();
      expect(
        (ctx.projectMemory as Record<string, unknown>).risks,
      ).toBeUndefined();
      expect(
        (ctx.projectMemory as Record<string, unknown>).knowledgeFiles,
      ).toBeUndefined();
    });

    // E2: Managed stale TESTING memory also does not become current state
    it("E2: managed stale TESTING memory also does not become current state", () => {
      const ctx = buildReasoningContext({
        requirements: [{ id: "REQ-1", description: "Feature works" }],
        profile: minProfile,
        evidence: [],
        projectMemory: {
          testing: {
            content:
              "<!-- qe-managed:start -->\nnpm run test failed due to import errors.\n<!-- qe-managed:end -->\n",
            source: ".qe/TESTING.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      expect(
        (ctx.projectMemory as Record<string, unknown>).testing,
      ).toBeUndefined();
      expect(ctx.projectMemory!.historicalObservations).toBeDefined();
      expect(
        ctx.projectMemory!.historicalObservations!.some(
          (o) => o.source === "TESTING" && o.content.includes("import errors"),
        ),
      ).toBe(true);
    });

    // E3: Legacy + managed RISKS content cannot create a current failure assertion
    it("E3: legacy + managed RISKS content quarantined to historicalObservations", () => {
      const ctx = buildReasoningContext({
        requirements: [],
        profile: minProfile,
        evidence: [],
        projectMemory: {
          risks: {
            entries: [
              {
                topic: "Integration",
                content:
                  "Unresolved issues\n\n<!-- qe-managed:start -->\nRisk level medium.\n<!-- qe-managed:end -->\n",
              },
            ],
            source: ".qe/RISKS.md",
          },
          knowledgeFiles: [],
          historySummaries: [],
        },
      });

      expect(
        (ctx.projectMemory as Record<string, unknown>).risks,
      ).toBeUndefined();
      expect(ctx.projectMemory!.historicalObservations).toBeDefined();
      expect(
        ctx.projectMemory!.historicalObservations!.some(
          (o) => o.source === "RISKS",
        ),
      ).toBe(true);
    });

    // E4: Memory distillation receives temporally filtered memory, not raw contaminated disk content
    it("E4: memory distillation receives filtered memory, not raw disk content", () => {
      const rawMemory: ProjectMemory = {
        testing: {
          content:
            "Legacy stale paragraph 1.\nLegacy stale paragraph 2.\n\n" +
            "<!-- qe-managed:start -->\nManaged observation.\n<!-- qe-managed:end -->\n",
          source: ".qe/TESTING.md",
        },
        risks: {
          entries: [
            {
              topic: "Integration",
              content:
                "Legacy risk claim.\n\n<!-- qe-managed:start -->\nManaged risk.\n<!-- qe-managed:end -->\n",
            },
          ],
          source: ".qe/RISKS.md",
        },
        knowledgeFiles: [
          {
            name: "cmd-rates",
            content:
              "Old data.\n\n<!-- qe-managed:start -->\nFiltered data.\n<!-- qe-managed:end -->\n",
            source: ".qe/knowledge/cmd-rates.md",
          },
        ],
        historySummaries: [],
      };

      const filtered = filterMemoryForDistillation(rawMemory);

      // Testing: only managed content survives
      expect(filtered.testing).toBeDefined();
      expect(filtered.testing!.content).toBe("Managed observation.");
      expect(filtered.testing!.content).not.toContain("Legacy stale");

      // Risks: only managed content survives
      expect(filtered.risks).toBeDefined();
      expect(filtered.risks!.entries[0].content).toBe("Managed risk.");
      expect(filtered.risks!.entries[0].content).not.toContain("Legacy risk");

      // Knowledge: only managed content survives
      expect(filtered.knowledgeFiles.length).toBe(1);
      expect(filtered.knowledgeFiles[0].content).toBe("Filtered data.");
      expect(filtered.knowledgeFiles[0].content).not.toContain("Old data");
    });

    // E5: Repeated failing-run → passing-run sequence converges rather than re-contaminates
    it(
      "E5: failing-run → passing-run converges without re-contamination",
      async () => {
        const dir = createTestRepo();
        try {
          mkdirSync(join(dir, ".qe"), { recursive: true });
          // Simulate failure memory from run N
          writeFileSync(
            join(dir, ".qe", "TESTING.md"),
            "Legacy failure claim.\n\n" +
              "<!-- qe-managed:start -->\nnpm test failed in prior run.\n<!-- qe-managed:end -->\n",
          );

          // Run N+1: passing, updates memory
          const gateway = createFakeGateway(
            [
              {
                target: "TESTING",
                operation: "UPDATE",
                rationale: "Tests now pass",
                content: "All tests pass.",
                confidence: 0.95,
              },
            ],
            [],
          );
          await runQE(dir, gateway);

          // Verify distillation received filtered memory (only managed content)
          const distillCall = gateway.calls.find(
            (c) => c.role === "memory_distiller",
          );
          expect(distillCall).toBeDefined();
          const distillCtx = distillCall!.context as Record<string, unknown>;
          const existingMem = distillCtx.existingMemory as Record<
            string,
            unknown
          >;
          if (existingMem.testing) {
            expect(String(existingMem.testing)).not.toContain(
              "Legacy failure claim",
            );
          }

          // Memory updated to reflect passing state
          const content = readFileSync(join(dir, ".qe", "TESTING.md"), "utf-8");
          expect(content).toContain("All tests pass.");
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT,
    );

    // E6: Discovery evidence captures discovered test frameworks and commands
    it("E6: discovery evidence captures discovered test frameworks", () => {
      const profile: RepositoryProfile = {
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
        ],
      };

      const evidence = createDiscoveryEvidence(profile);

      expect(evidence.length).toBe(1);
      expect(evidence[0].id).toBe("ev-discovery-repository");
      expect(evidence[0].type).toBe("DISCOVERY_RESULT");
      expect(evidence[0].provenance).toBe("observed");
      expect(evidence[0].status).toBe("OBSERVED");
      expect(evidence[0].summary).toContain("test frameworks: vitest");
      expect(evidence[0].summary).toContain("test commands: test");
      const details = evidence[0].details as Record<string, unknown>;
      expect(details.testFrameworks).toContain("vitest");
      expect(details.testCommands).toEqual([
        { name: "test", command: "npm run test" },
      ]);
    });

    // E7: No test frameworks when none discovered
    it("E7: discovery evidence shows empty test frameworks when none discovered", () => {
      const evidence = createDiscoveryEvidence(minProfile);

      expect(evidence.length).toBe(1);
      expect(evidence[0].summary).toContain("Repository analysis completed");
      expect(evidence[0].summary).not.toContain("test frameworks:");
      const details = evidence[0].details as Record<string, unknown>;
      expect(details.testFrameworks).toEqual([]);
      expect(details.testCommands).toEqual([]);
    });

    // E8: Discovery evidence captures quality tools
    it("E8: discovery evidence captures lint and typecheck commands", () => {
      const profileWithTools: RepositoryProfile = {
        ...minProfile,
        commands: [
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
            command: "npm run typecheck",
            source: "package.json",
            confidence: 0.9,
          },
        ],
      };

      const evidence = createDiscoveryEvidence(profileWithTools);

      expect(evidence.length).toBe(1);
      expect(evidence[0].summary).toContain("lint commands: lint");
      expect(evidence[0].summary).toContain("typecheck commands: typecheck");
      const details = evidence[0].details as Record<string, unknown>;
      expect(details.lintCommands).toEqual([
        { name: "lint", command: "npm run lint" },
      ]);
      expect(details.typecheckCommands).toEqual([
        { name: "typecheck", command: "npm run typecheck" },
      ]);
    });

    // E9: Lifecycle evidence captures invocation mode
    it("E9: lifecycle evidence captures invocation mode", () => {
      const evidence = createLifecycleEvidence({
        invocationMode: "cli",
        budgetActive: false,
      });

      expect(evidence.length).toBe(1);
      expect(evidence[0].id).toBe("ev-lifecycle-invocation");
      expect(evidence[0].type).toBe("LIFECYCLE_OBSERVATION");
      expect(evidence[0].provenance).toBe("observed");
      expect(evidence[0].status).toBe("OBSERVED");
      expect(evidence[0].summary).toContain("cli");
    });

    // E10: Lifecycle evidence includes budget when active
    it("E10: lifecycle evidence includes budget record when active", () => {
      const evidence = createLifecycleEvidence({
        invocationMode: "cli",
        budgetActive: true,
        budgetMaxDurationMs: 120000,
        budgetMaxModelCalls: 10,
      });

      expect(evidence.length).toBe(2);
      expect(evidence[0].id).toBe("ev-lifecycle-invocation");
      expect(evidence[1].id).toBe("ev-lifecycle-budget");
      expect(evidence[1].type).toBe("LIFECYCLE_OBSERVATION");
      expect(evidence[1].summary).toContain("Execution budget active");
      expect(evidence[1].summary).toContain("maxDuration: 120000ms");
      expect(evidence[1].summary).toContain("maxModelCalls: 10");
    });

    // E11: Lifecycle evidence omits budget when inactive
    it("E11: lifecycle evidence omits budget record when inactive", () => {
      const evidence = createLifecycleEvidence({
        invocationMode: "cli",
        budgetActive: false,
      });

      expect(evidence.length).toBe(1);
      expect(evidence[0].id).toBe("ev-lifecycle-invocation");
    });

    // E12: Discovery and lifecycle evidence use observed provenance
    it("E12: all canonical evidence uses observed provenance", () => {
      const discoveryEvidence = createDiscoveryEvidence(minProfile);
      const lifecycleEvidence = createLifecycleEvidence({
        invocationMode: "cli",
        budgetActive: true,
      });

      for (const ev of [...discoveryEvidence, ...lifecycleEvidence]) {
        expect(ev.provenance).toBe("observed");
        expect(ev.status).toBe("OBSERVED");
      }
    });

    // E13: No requirement is deterministically pre-assessed without metadata
    it("E13: no requirement is deterministically pre-assessed", () => {
      const results = buildDeterministicGrounding({
        repositoryProfile: minProfile,
        evidence: [],
        requirements: [
          { id: "FR-035A", description: "Token/cost telemetry reporting" },
          { id: "FR-003", description: "Test discovery" },
          { id: "FR-031", description: "Local CLI invocation" },
        ],
        budgetActive: true,
      });

      expect(results.length).toBe(0);
    });

    // E14: No requirement is deterministically pre-assessed regardless of description
    it("E14: no grounding for any description without metadata", () => {
      const results = buildDeterministicGrounding({
        repositoryProfile: minProfile,
        evidence: [],
        requirements: [
          { id: "FR-037", description: "Structured report output" },
          { id: "FR-009", description: "Test execution" },
        ],
        budgetActive: true,
      });

      expect(results.length).toBe(0);
    });

    // E15: Planner requirementIds cannot cause deterministic assessment
    it("E15: planner requirementIds cannot cause deterministic assessment", () => {
      const results = buildDeterministicGrounding({
        repositoryProfile: minProfile,
        evidence: [],
        requirements: [
          {
            id: "PLANNER-INJECTED-001",
            description: "Some planner-generated requirement",
          },
        ],
        budgetActive: true,
      });

      expect(results.length).toBe(0);
    });

    // E16: Canonical merge count equals input requirement count
    it("E16: canonical merge count equals input requirement count", () => {
      const requirements = [
        { id: "REQ-001", description: "Repository analysis" },
        { id: "REQ-003", description: "Discover existing automated tests" },
        { id: "REQ-009", description: "Execute the test suite" },
        { id: "REQ-031", description: "Run via command line" },
        { id: "REQ-037", description: "Produce a structured report" },
      ];

      const grounding = buildDeterministicGrounding({
        repositoryProfile: minProfile,
        evidence: [],
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

      // All are NOT_VERIFIED since no grounding exists without metadata
      for (const a of merged) {
        expect(a.status).toBe("NOT_VERIFIED");
      }
    });
  });

  // ---------------------------------------------------------------
  // Genericity tests: Grounding is wording/ID-independent
  // ---------------------------------------------------------------
  describe("Generic grounding: wording and ID independence", () => {
    const profileWithTests: RepositoryProfile = {
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
          id: "jest",
          name: "jest",
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
          command: "npm test",
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
      ],
      capabilities: [],
      confidence: 0.9,
      configFiles: [],
      sourceDirectories: [],
    };

    // A: Discovery evidence is requirement-wording-independent
    it("A: discovery evidence is identical regardless of requirement wording", () => {
      const ev1 = createDiscoveryEvidence(profileWithTests);
      const ev2 = createDiscoveryEvidence(profileWithTests);

      expect(ev1[0].summary).toBe(ev2[0].summary);
      expect(ev1[0].details).toEqual(ev2[0].details);
    });

    // B: Discovery evidence captures test frameworks from profile
    it("B: discovery evidence captures test frameworks from profile regardless of requirement phrasing", () => {
      const evidence = createDiscoveryEvidence(profileWithTests);

      expect(evidence[0].summary).toContain("test frameworks: jest");
      const details = evidence[0].details as Record<string, unknown>;
      expect(details.testFrameworks).toContain("jest");
    });

    // C: Coincidental phrase cannot cause automatic grounding
    it("C: unrelated requirement with coincidental phrase is not auto-grounded", () => {
      const results = buildDeterministicGrounding({
        repositoryProfile: profileWithTests,
        evidence: [],
        requirements: [
          {
            id: "REQ-99",
            description:
              "Test discovery of new user preferences on first login",
          },
        ],
        budgetActive: true,
      });

      expect(results.length).toBe(0);
    });

    // D: FR IDs have zero runtime significance
    it("D: IDs FR-003/FR-004 have zero runtime significance", () => {
      const withFrId = buildDeterministicGrounding({
        repositoryProfile: profileWithTests,
        evidence: [],
        requirements: [{ id: "FR-003", description: "Test discovery" }],
        budgetActive: true,
      });
      const withCustomId = buildDeterministicGrounding({
        repositoryProfile: profileWithTests,
        evidence: [],
        requirements: [{ id: "CUST-001", description: "Test discovery" }],
        budgetActive: true,
      });

      expect(withFrId.length).toBe(0);
      expect(withCustomId.length).toBe(0);

      // Evidence is identical regardless of requirement ID
      const ev = createDiscoveryEvidence(profileWithTests);
      expect(ev[0].id).toBe("ev-discovery-repository");
      expect(ev[0].type).toBe("DISCOVERY_RESULT");
    });

    // E: Renaming PRD requirement descriptions does not break behavior
    it("E: renaming PRD descriptions does not break grounding", () => {
      const original = buildDeterministicGrounding({
        repositoryProfile: profileWithTests,
        evidence: [],
        requirements: [
          { id: "FR-003", description: "Test discovery" },
          { id: "FR-004", description: "Quality tool discovery" },
          { id: "FR-009", description: "Test execution" },
        ],
        budgetActive: true,
      });
      const renamed = buildDeterministicGrounding({
        repositoryProfile: profileWithTests,
        evidence: [],
        requirements: [
          { id: "FR-003", description: "Automated test identification" },
          { id: "FR-004", description: "Static analysis tool detection" },
          { id: "FR-009", description: "Suite runner invocation" },
        ],
        budgetActive: true,
      });

      expect(original.length).toBe(0);
      expect(renamed.length).toBe(0);
    });

    // F: Discovery evidence works with arbitrary profiles
    it("F: discovery evidence works identically with any profile", () => {
      const evidence = createDiscoveryEvidence(profileWithTests);

      const details = evidence[0].details as Record<string, unknown>;
      expect(details.testFrameworks).toContain("jest");
      expect((details.lintCommands as { name: string }[]).length).toBe(1);

      const lifecycle = createLifecycleEvidence({
        invocationMode: "cli",
        budgetActive: true,
      });
      expect(lifecycle[0].summary).toContain("cli");

      const grounding = buildDeterministicGrounding({
        repositoryProfile: profileWithTests,
        evidence: [],
        requirements: [
          { id: "REQ-217", description: "Validate test infrastructure" },
        ],
        budgetActive: true,
      });
      expect(grounding.length).toBe(0);
    });

    // G: Discovery evidence is available as gap analysis input via evidence array
    it("G: discovery evidence flows through evidence array to gap analysis", () => {
      const evidence = createDiscoveryEvidence(profileWithTests);

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
      const evidenceCtx = ctx.collectedEvidence as {
        id: string;
        type: string;
      }[];
      expect(evidenceCtx).toBeDefined();
      expect(evidenceCtx.some((e) => e.id === "ev-discovery-repository")).toBe(
        true,
      );
      expect(evidenceCtx.some((e) => e.type === "DISCOVERY_RESULT")).toBe(true);
    });
  });
});
