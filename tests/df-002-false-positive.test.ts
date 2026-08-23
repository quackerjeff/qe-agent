import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateRelativeImports,
  investigateGeneratedTestFailure,
} from "../src/core/test-generation/index.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import {
  QEResultSchema,
  GeneratedTestProvenanceSchema,
} from "../src/types/index.js";
import type { RepositoryProfile, Evidence } from "../src/types/index.js";

// --- Helpers ---

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "qe-fp-"));
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

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev-1",
    type: "TEST_RESULT",
    provenance: "executed",
    timestamp: new Date().toISOString(),
    source: "generated-test:tests/gen.test.ts",
    status: "FAIL",
    summary: "Test failed",
    ...overrides,
  };
}

// ==========================================================================
// Static Import Validation
// ==========================================================================

describe("Static Import Validation", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempRepo();
    mkdirSync(join(repoDir, "src"), { recursive: true });
    mkdirSync(join(repoDir, "tests"), { recursive: true });
    writeFileSync(
      join(repoDir, "src/utils.ts"),
      "export function add(a: number, b: number) { return a + b; }\n",
    );
    writeFileSync(
      join(repoDir, "src/index.ts"),
      'export { add } from "./utils.js";\n',
    );
    gitCommit(repoDir, "init");
  });

  it("1. unresolved relative import → TEST_DEFECT classification", () => {
    const content = `import { describe, it, expect } from 'vitest';
import { detectRepository } from '../src/repositoryDetection';

describe('Repository Detection', () => {
  it('detects valid repos', () => {
    expect(detectRepository('valid-repo-url')).toBeDefined();
  });
});`;

    const result = validateRelativeImports(
      content,
      "tests/integration/repositoryDetection.test.ts",
      repoDir,
    );
    expect(result.valid).toBe(false);
    expect(result.unresolvedImports.length).toBeGreaterThan(0);
    expect(result.unresolvedImports[0].specifier).toBe(
      "../src/repositoryDetection",
    );
  });

  it("7. valid relative import passes static validation", () => {
    const content = `import { describe, it, expect } from 'vitest';
import { add } from '../src/utils';

describe('add', () => {
  it('adds numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
});`;

    const result = validateRelativeImports(
      content,
      "tests/add.test.ts",
      repoDir,
    );
    expect(result.valid).toBe(true);
    expect(result.unresolvedImports).toHaveLength(0);
  });

  it("7b. valid import to index file passes", () => {
    const content = `import { add } from '../src';`;

    const result = validateRelativeImports(
      content,
      "tests/add.test.ts",
      repoDir,
    );
    expect(result.valid).toBe(true);
  });

  it("8. package import (vitest) is not rejected", () => {
    const content = `import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('schema', () => {
  it('validates', () => {
    expect(z.string().safeParse('ok').success).toBe(true);
  });
});`;

    const result = validateRelativeImports(
      content,
      "tests/schema.test.ts",
      repoDir,
    );
    expect(result.valid).toBe(true);
  });

  it("catches multiple unresolved imports", () => {
    const content = `import { foo } from '../src/nonexistent';
import { bar } from '../lib/alsoMissing';`;

    const result = validateRelativeImports(
      content,
      "tests/multi.test.ts",
      repoDir,
    );
    expect(result.valid).toBe(false);
    expect(result.unresolvedImports.length).toBe(2);
  });
});

// ==========================================================================
// Evidence Provenance Schema
// ==========================================================================

describe("Evidence Provenance Schema", () => {
  it("4. GeneratedTestProvenance schema validates", () => {
    const valid = GeneratedTestProvenanceSchema.safeParse({
      generatedTestId: "gen-1",
      generatedFilePath: "tests/gen.test.ts",
      failureClassification: "TEST_DEFECT",
      assertionsExecuted: false,
    });
    expect(valid.success).toBe(true);
  });

  it("4b. GeneratedTestProvenance is optional on Evidence", () => {
    const ev: Evidence = makeEvidence();
    expect(ev.generatedTestProvenance).toBeUndefined();
  });
});

// ==========================================================================
// Failure Investigator Semantics
// ==========================================================================

describe("Zero-Assertion / Load Failure Semantics", () => {
  it("module resolution error classified as TEST_DEFECT", () => {
    const result = investigateGeneratedTestFailure({
      generatedTestId: "gen-1",
      generatedFilePath: "tests/bad.test.ts",
      testContent: 'import { x } from "../src/nonexistent";',
      executionEvidence: makeEvidence({
        summary: "Cannot find module '../src/nonexistent'",
      }),
      requirementIds: ["req-1"],
      classification: "CANDIDATE",
    });
    expect(result.failureClassification).toBe("TEST_DEFECT");
    expect(result.finding).toBeUndefined();
  });

  it("syntax error classified as TEST_DEFECT", () => {
    const result = investigateGeneratedTestFailure({
      generatedTestId: "gen-1",
      generatedFilePath: "tests/bad.test.ts",
      testContent: "const x = {",
      executionEvidence: makeEvidence({
        summary: "SyntaxError: Unexpected end of input",
      }),
      requirementIds: [],
      classification: "PERMANENT_REGRESSION",
    });
    expect(result.failureClassification).toBe("TEST_DEFECT");
  });

  it("'is not defined' classified as TEST_DEFECT", () => {
    const result = investigateGeneratedTestFailure({
      generatedTestId: "gen-1",
      generatedFilePath: "tests/bad.test.ts",
      testContent: "test('x', () => { foo(); });",
      executionEvidence: makeEvidence({
        summary: "ReferenceError: foo is not defined",
      }),
      requirementIds: [],
      classification: "CANDIDATE",
    });
    expect(result.failureClassification).toBe("TEST_DEFECT");
  });

  it("'is not a function' classified as TEST_DEFECT", () => {
    const result = investigateGeneratedTestFailure({
      generatedTestId: "gen-1",
      generatedFilePath: "tests/bad.test.ts",
      testContent: 'import { x } from "../src/utils"; x();',
      executionEvidence: makeEvidence({
        summary: "TypeError: x is not a function",
      }),
      requirementIds: [],
      classification: "CANDIDATE",
    });
    expect(result.failureClassification).toBe("TEST_DEFECT");
  });
});

// ==========================================================================
// Verdict Guardrail
// ==========================================================================

describe("Verdict Guardrail — Generated-Test TEST_DEFECT", () => {
  it(
    "5. TEST_DEFECT evidence cannot drive product FAIL",
    { timeout: 30_000 },
    async () => {
      const repoDir = createTempRepo();
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(join(repoDir, "src/app.ts"), "export const x = 1;\n");
      writeFileSync(
        join(repoDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { test: "echo ok" } }),
      );
      gitCommit(repoDir, "init");

      // Model generates a test with hallucinated import
      const gateway = createScenarioGateway({
        plan: {
          objectives: [{ id: "obj-1", description: "Verify" }],
          recommendedActions: [],
          identifiedRisks: [],
          expectedCapabilities: [],
          unavailableValidations: [],
        },
        testGen: {
          shouldGenerate: true,
          reason: "Missing coverage",
          plans: [
            {
              objective: "Verify detection",
              targetBehavior: "Detect repos",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/integration/repositoryDetection.test.ts",
              classification: "CANDIDATE",
              expectedEvidence: "Test result",
            },
          ],
          proposals: [
            {
              filePath: "tests/integration/repositoryDetection.test.ts",
              operation: "CREATE",
              classification: "CANDIDATE",
              rationale: "Test repo detection",
              content: `import { describe, it, expect } from 'vitest';
import { detectRepository } from '../src/repositoryDetection';

describe('Repository Detection', () => {
  it('detects valid repos', () => {
    expect(detectRepository('valid-repo-url')).toBeDefined();
  });
});`,
              planIndex: 0,
              requirementIds: ["req-1"],
            },
          ],
        },
        verdict: {
          recommendedVerdict: "FAIL",
          confidence: "HIGH",
          reasoning: "Test failure",
          concerns: ["Critical defect"],
          recommendedNextActions: ["Fix defect"],
          summary: "Critical defect detected",
        },
      });

      const orchestrator = new QEOrchestrator({
        gateway,
        maxModelCalls: 20,
        repositoryProfile: createMockProfile(repoDir),
      });

      const result = await orchestrator.run({
        repositoryPath: repoDir,
        requirements: [{ id: "req-1", description: "Feature works" }],
        profile: "standard",
        mode: "repository",
      });

      expect(QEResultSchema.safeParse(result).success).toBe(true);

      // The verdict must NOT be FAIL since the only failure is a TEST_DEFECT
      expect(result.verdict).not.toBe("FAIL");
    },
  );

  it(
    "11. independent product failure + generated TEST_DEFECT may still yield FAIL",
    { timeout: 30_000 },
    async () => {
      const repoDir = createTempRepo();
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(join(repoDir, "src/app.ts"), "export const x = 1;\n");
      writeFileSync(
        join(repoDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          scripts: { test: "exit 1" },
        }),
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
              objective: "Verify detection",
              targetBehavior: "Detect repos",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/bad.test.ts",
              classification: "CANDIDATE",
              expectedEvidence: "Test result",
            },
          ],
          proposals: [
            {
              filePath: "tests/bad.test.ts",
              operation: "CREATE",
              classification: "CANDIDATE",
              rationale: "Bad test",
              content: `import { nonExistent } from '../src/nonExistent';`,
              planIndex: 0,
              requirementIds: ["req-1"],
            },
          ],
        },
        verdict: {
          recommendedVerdict: "FAIL",
          confidence: "HIGH",
          reasoning: "Real test failure",
          concerns: ["Product defect"],
          recommendedNextActions: ["Fix defect"],
          summary: "Real defect found",
        },
      });

      const orchestrator = new QEOrchestrator({
        gateway,
        maxModelCalls: 20,
        repositoryProfile: createMockProfile(repoDir),
      });

      const result = await orchestrator.run({
        repositoryPath: repoDir,
        requirements: [{ id: "req-1", description: "Feature works" }],
        profile: "standard",
        mode: "repository",
      });

      expect(QEResultSchema.safeParse(result).success).toBe(true);

      // Independent real failure exists (from "exit 1"), so FAIL is valid
      const hasRealFailEvidence = result.evidence.some(
        (e) => e.status === "FAIL" && e.generatedTestProvenance == null,
      );
      expect(hasRealFailEvidence).toBe(true);
    },
  );
});

// ==========================================================================
// Exact Dogfood Failure Reproduction
// ==========================================================================

describe("Exact Dogfood Reproduction — DF-002 False-Positive", () => {
  it(
    "10. hallucinated import: static validation → no execution → TEST_DEFECT → cleanup → no FAIL",
    { timeout: 30_000 },
    async () => {
      const repoDir = createTempRepo();
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(join(repoDir, "src/app.ts"), "export const x = 1;\n");
      writeFileSync(
        join(repoDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { test: "echo ok" } }),
      );
      gitCommit(repoDir, "init");

      const gateway = createScenarioGateway({
        plan: {
          objectives: [{ id: "obj-1", description: "Verify" }],
          recommendedActions: [],
          identifiedRisks: [],
          expectedCapabilities: [],
          unavailableValidations: [],
        },
        testGen: {
          shouldGenerate: true,
          reason: "Missing coverage",
          plans: [
            {
              objective: "Verify repo detection",
              targetBehavior: "Repository detection",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/integration/repositoryDetection.test.ts",
              classification: "CANDIDATE",
              expectedEvidence: "Test execution result",
            },
          ],
          proposals: [
            {
              filePath: "tests/integration/repositoryDetection.test.ts",
              operation: "CREATE",
              classification: "CANDIDATE",
              rationale: "Test repository detection",
              content: `import { describe, it, expect } from 'vitest';
import { detectRepository } from '../src/repositoryDetection';

describe('Repository Detection', () => {
  it('detects valid repository', () => {
    expect(detectRepository('valid-repo-url')).toBeDefined();
  });
  it('rejects invalid repository', () => {
    expect(detectRepository('invalid-repo-url')).toBeNull();
  });
});`,
              planIndex: 0,
              requirementIds: ["req-1"],
            },
          ],
        },
        verdict: {
          recommendedVerdict: "FAIL",
          confidence: "HIGH",
          reasoning: "Critical defect found",
          concerns: ["Integration failure"],
          recommendedNextActions: ["Fix module"],
          summary: "Critical defect in repository detection",
        },
      });

      const orchestrator = new QEOrchestrator({
        gateway,
        maxModelCalls: 20,
        repositoryProfile: createMockProfile(repoDir),
      });

      const result = await orchestrator.run({
        repositoryPath: repoDir,
        requirements: [{ id: "req-1", description: "Feature works" }],
        profile: "standard",
        mode: "repository",
      });

      expect(QEResultSchema.safeParse(result).success).toBe(true);

      // Static validation detects unresolved import
      expect(result.generatedTestChanges).toBeDefined();
      const change = result.generatedTestChanges!.find(
        (c) => c.filePath === "tests/integration/repositoryDetection.test.ts",
      );
      expect(change).toBeDefined();
      expect(change!.failureClassification).toBe("TEST_DEFECT");

      // Test was not executed (static validation caught it)
      expect(change!.executionTargetingMode).toBe("UNVERIFIED");

      // 12. No working-tree residue
      expect(
        existsSync(
          join(repoDir, "tests/integration/repositoryDetection.test.ts"),
        ),
      ).toBe(false);

      // File was not retained
      expect(change!.retained).toBe(false);

      // No product-defect finding
      const productFindings = result.findings.filter(
        (f) => f.category === "DEFECT" || f.category === "REGRESSION",
      );
      expect(productFindings).toHaveLength(0);

      // Verdict is NOT FAIL
      expect(result.verdict).not.toBe("FAIL");

      // Evidence carries provenance
      const genEvidence = result.evidence.find(
        (e) => e.generatedTestProvenance != null,
      );
      expect(genEvidence).toBeDefined();
      expect(genEvidence!.generatedTestProvenance!.failureClassification).toBe(
        "TEST_DEFECT",
      );
      expect(genEvidence!.status).toBe("INCONCLUSIVE");

      // testDefectTestsRemoved metric
      expect(result.testGenerationMetrics).toBeDefined();
      expect(
        result.testGenerationMetrics!.testDefectTestsRemoved,
      ).toBeGreaterThanOrEqual(1);
    },
  );
});

// ==========================================================================
// TEST_DEFECT Cleanup & Retention Override
// ==========================================================================

describe("TEST_DEFECT Cleanup & Retention Override", () => {
  it(
    "6. model PERMANENT_REGRESSION overridden by TEST_DEFECT cleanup",
    { timeout: 30_000 },
    async () => {
      const repoDir = createTempRepo();
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(join(repoDir, "src/app.ts"), "export const x = 1;\n");
      writeFileSync(
        join(repoDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { test: "echo ok" } }),
      );
      gitCommit(repoDir, "init");

      const gateway = createScenarioGateway({
        plan: {
          objectives: [{ id: "obj-1", description: "Verify" }],
          recommendedActions: [],
          identifiedRisks: [],
          expectedCapabilities: [],
          unavailableValidations: [],
        },
        testGen: {
          shouldGenerate: true,
          reason: "Regression protection",
          plans: [
            {
              objective: "Verify regression",
              targetBehavior: "Core behavior",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/perm.test.ts",
              classification: "PERMANENT_REGRESSION",
              expectedEvidence: "Test result",
            },
          ],
          proposals: [
            {
              filePath: "tests/perm.test.ts",
              operation: "CREATE",
              classification: "PERMANENT_REGRESSION",
              rationale: "Permanent regression protection",
              content: `import { nonExistent } from '../src/nonExistent';
test('it works', () => { expect(nonExistent).toBeDefined(); });`,
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
        requirements: [{ id: "req-1", description: "Feature works" }],
        profile: "standard",
        mode: "repository",
      });

      expect(QEResultSchema.safeParse(result).success).toBe(true);

      const change = result.generatedTestChanges?.find(
        (c) => c.filePath === "tests/perm.test.ts",
      );
      expect(change).toBeDefined();
      expect(change!.classification).toBe("PERMANENT_REGRESSION");
      expect(change!.failureClassification).toBe("TEST_DEFECT");
      expect(change!.retained).toBe(false);

      // 12. File removed from working tree
      expect(existsSync(join(repoDir, "tests/perm.test.ts"))).toBe(false);
    },
  );

  it(
    "3. unresolved import → generated file cleaned up",
    { timeout: 30_000 },
    async () => {
      const repoDir = createTempRepo();
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(join(repoDir, "src/app.ts"), "export const x = 1;\n");
      writeFileSync(
        join(repoDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { test: "echo ok" } }),
      );
      gitCommit(repoDir, "init");

      const gateway = createScenarioGateway({
        plan: {
          objectives: [{ id: "obj-1", description: "Verify" }],
          recommendedActions: [],
          identifiedRisks: [],
          expectedCapabilities: [],
          unavailableValidations: [],
        },
        testGen: {
          shouldGenerate: true,
          reason: "Gap",
          plans: [
            {
              objective: "Test",
              targetBehavior: "Behavior",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/bad.test.ts",
              classification: "CANDIDATE",
              expectedEvidence: "Test result",
            },
          ],
          proposals: [
            {
              filePath: "tests/bad.test.ts",
              operation: "CREATE",
              classification: "CANDIDATE",
              rationale: "Test missing module",
              content: `import { ghost } from '../src/ghost';
test('ghost', () => { expect(ghost).toBeDefined(); });`,
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
        requirements: [{ id: "req-1", description: "Feature works" }],
        profile: "standard",
        mode: "repository",
      });

      // File cleaned up
      expect(existsSync(join(repoDir, "tests/bad.test.ts"))).toBe(false);

      // But evidence preserved
      const genEvidence = result.evidence.find(
        (e) => e.generatedTestProvenance != null,
      );
      expect(genEvidence).toBeDefined();
      expect(genEvidence!.status).toBe("INCONCLUSIVE");
    },
  );

  it(
    "2. unresolved import → test not executed",
    { timeout: 30_000 },
    async () => {
      const repoDir = createTempRepo();
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(join(repoDir, "src/app.ts"), "export const x = 1;\n");
      writeFileSync(
        join(repoDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { test: "echo ok" } }),
      );
      gitCommit(repoDir, "init");

      const gateway = createScenarioGateway({
        plan: {
          objectives: [{ id: "obj-1", description: "Verify" }],
          recommendedActions: [],
          identifiedRisks: [],
          expectedCapabilities: [],
          unavailableValidations: [],
        },
        testGen: {
          shouldGenerate: true,
          reason: "Gap",
          plans: [
            {
              objective: "Test",
              targetBehavior: "Behavior",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/noexec.test.ts",
              classification: "CANDIDATE",
              expectedEvidence: "Test result",
            },
          ],
          proposals: [
            {
              filePath: "tests/noexec.test.ts",
              operation: "CREATE",
              classification: "CANDIDATE",
              rationale: "Test",
              content: `import { missing } from '../src/missing';
test('x', () => { expect(missing).toBe(1); });`,
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
        requirements: [{ id: "req-1", description: "Feature works" }],
        profile: "standard",
        mode: "repository",
      });

      const change = result.generatedTestChanges?.find(
        (c) => c.filePath === "tests/noexec.test.ts",
      );
      expect(change).toBeDefined();
      // Test was not executed — caught by static validation
      expect(change!.executionTargetingMode).toBe("UNVERIFIED");
    },
  );
});

// ==========================================================================
// Legitimate Regression Detection Preserved
// ==========================================================================

describe("Legitimate Regression Detection Preserved", () => {
  it("9. valid generated test with real assertion failure can support product defect", () => {
    const ev = makeEvidence({
      id: "ev-target",
      summary: "Expected 2 to be 3",
    });

    const result = investigateGeneratedTestFailure({
      generatedTestId: "gen-1",
      generatedFilePath: "tests/regression.test.ts",
      testContent: 'test("reg", () => { expect(add(1,1)).toBe(2); });',
      executionEvidence: ev,
      requirementIds: ["req-1"],
      classification: "PERMANENT_REGRESSION",
      baselineComparison: {
        classification: "INTRODUCED",
        baselineEvidenceId: "ev-baseline",
      },
    });

    expect(result.failureClassification).toBe("REGRESSION");
    expect(result.finding).toBeDefined();
    expect(result.finding!.category).toBe("REGRESSION");
    expect(result.finding!.evidenceIds).toContain("ev-target");
    expect(result.finding!.evidenceIds).toContain("ev-baseline");
  });

  it("10b. valid generated regression with INTRODUCED can still support FAIL", () => {
    const ev = makeEvidence({
      id: "ev-target",
      summary: "Expected 2 to be 3",
    });

    const result = investigateGeneratedTestFailure({
      generatedTestId: "gen-1",
      generatedFilePath: "tests/regression.test.ts",
      testContent: 'test("reg", () => { expect(add(1,1)).toBe(2); });',
      executionEvidence: ev,
      requirementIds: ["req-1"],
      classification: "PERMANENT_REGRESSION",
      baselineComparison: {
        classification: "INTRODUCED",
        baselineEvidenceId: "ev-baseline",
      },
    });

    // REGRESSION is confirmed — this is a legitimate product defect finding
    expect(result.failureClassification).toBe("REGRESSION");
    expect(result.finding!.category).toBe("REGRESSION");
    expect(result.finding!.severity).toBe("HIGH");
  });

  it(
    "9b. valid generated test with valid import is retained",
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
          recommendedActions: [],
          identifiedRisks: [],
          expectedCapabilities: [],
          unavailableValidations: [],
        },
        testGen: {
          shouldGenerate: true,
          reason: "Coverage",
          plans: [
            {
              objective: "Test add",
              targetBehavior: "Addition",
              requirementIds: ["req-1"],
              targetTestFramework: "Vitest",
              targetLocation: "tests/add.test.ts",
              classification: "CANDIDATE",
              expectedEvidence: "Test result",
            },
          ],
          proposals: [
            {
              filePath: "tests/add.test.ts",
              operation: "CREATE",
              classification: "CANDIDATE",
              rationale: "Test add function",
              content: `import { add } from '../src/utils';
test('adds numbers', () => { expect(add(1, 2)).toBe(3); });`,
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
        requirements: [{ id: "req-1", description: "Feature works" }],
        profile: "standard",
        mode: "repository",
      });

      const change = result.generatedTestChanges?.find(
        (c) => c.filePath === "tests/add.test.ts",
      );
      expect(change).toBeDefined();
      // Import is valid, so static validation passes and test may execute
      expect(change!.failureClassification).not.toBe("TEST_DEFECT");
      expect(change!.retained).toBe(true);
    },
  );
});
