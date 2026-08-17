import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FakeModelGateway } from "../src/models/gateway/fake.js";
import type { ReasoningTask } from "../src/models/gateway/types.js";
import { QEOrchestrator } from "../src/core/orchestrator/orchestrator.js";
import { PlaywrightAdapter } from "../src/core/browser/playwright-adapter.js";
import type { QERequest, QEResult } from "../src/types/index.js";

const TEST_TIMEOUT = 60_000;

function randomPort(): number {
  return 6100 + Math.floor(Math.random() * 900);
}

// Create a git repo with a "passing" baseline commit and a "regression" target commit.
// The server fixture uses APP_MODE env var, so the git content doesn't change the
// fixture server behavior — but the worktree is created from a real baseline ref.
// The orchestrator discovers a START command from package.json.
function createBrowserTestRepo(opts: {
  targetMode: string;
  baselineMode: string;
}): {
  dir: string;
  baselineRef: string;
  targetRef: string;
  targetPort: number;
  baselinePort: number;
} {
  const dir = mkdtempSync(join(tmpdir(), "qe-browser-baseline-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

  const targetPort = randomPort();
  const baselinePort = randomPort();

  // Write a package.json with a START command that uses the fixture server.
  // The fixtures are in the QE agent repo, so we use absolute paths.
  const fixtureServerPath = join(
    process.cwd(),
    "fixtures/browser-eval/server.cjs",
  );

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "browser-baseline-test",
      version: "1.0.0",
      scripts: {
        start: `APP_MODE=${opts.baselineMode} node ${fixtureServerPath}`,
      },
    }),
  );

  writeFileSync(join(dir, "index.js"), "// baseline app\n");

  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "baseline commit"], { cwd: dir });
  const baselineRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
    .toString()
    .trim();

  // Target commit — change the start script to use target mode
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "browser-baseline-test",
      version: "1.0.0",
      scripts: {
        start: `APP_MODE=${opts.targetMode} node ${fixtureServerPath}`,
      },
    }),
  );

  writeFileSync(join(dir, "index.js"), "// target app with changes\n");

  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "target commit"], { cwd: dir });
  const targetRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
    .toString()
    .trim();

  return { dir, baselineRef, targetRef, targetPort, baselinePort };
}

function createFakeGateway(): FakeModelGateway {
  return new FakeModelGateway(<T>(task: ReasoningTask<T>): T | undefined => {
    switch (task.role) {
      case "change_analyst":
        return {
          summary: "UI behavior change",
          affectedComponents: [
            { name: "frontend", impact: "Form submission behavior changed" },
          ],
          behaviorChanges: [
            { description: "Submit result page changed", risk: "HIGH" },
          ],
          potentialBlastRadius: [],
          unknowns: [],
        } as unknown as T;

      case "risk_analyst":
        return {
          level: "HIGH",
          factors: [
            {
              factor: "ui-change",
              reason: "UI behavior changed",
              weight: "high",
            },
          ],
          confidence: 0.8,
          summary: "High risk due to UI changes",
        } as unknown as T;

      case "test_strategist":
        return {
          objectives: [{ id: "obj-browser", description: "Verify UI" }],
          recommendedActions: [
            {
              id: "browser-form-test",
              commandId: undefined,
              type: "BROWSER",
              purpose: "Verify form submission",
              priority: 1,
              riskAddressed: ["ui-change"],
              requirementIds: ["REQ-FORM"],
              browserActions: [
                { type: "NAVIGATE", url: "__BASE_URL__/" },
                { type: "CLICK", selector: { type: "role", value: "button" } },
                {
                  type: "ASSERT_TEXT",
                  selector: { type: "testId", value: "result" },
                  value: "Save successful",
                },
              ],
            },
          ],
          identifiedRisks: ["ui-change"],
          expectedCapabilities: ["browser"],
          unavailableValidations: [],
        } as unknown as T;

      case "failure_investigator":
        return {
          likelyCause: "PRODUCT_DEFECT",
          explanation: "Browser test failed",
          confidence: 0.85,
          suggestRetry: false,
          suggestBaselineComparison: true,
          affectedFiles: [],
          relatedRequirementIds: ["REQ-FORM"],
        } as unknown as T;

      case "gap_analyst":
        return {
          gaps: [],
          requirementAssessments: [
            {
              requirementId: "REQ-FORM",
              status: "PARTIALLY_VERIFIED",
              evidenceIds: [],
              explanation: "Browser validation ran",
            },
          ],
        } as unknown as T;

      case "verdict_reviewer":
        return {
          recommendedVerdict: "FAIL",
          confidence: "HIGH",
          reasoning: "Browser regression detected",
          concerns: [],
          recommendedNextActions: ["Fix regression"],
          summary: "Browser regression found",
        } as unknown as T;

      default:
        return undefined;
    }
  });
}

describe("Browser Baseline via QEOrchestrator", () => {
  let repoIntroduced: ReturnType<typeof createBrowserTestRepo>;
  let repoPreExisting: ReturnType<typeof createBrowserTestRepo>;

  beforeAll(() => {
    repoIntroduced = createBrowserTestRepo({
      targetMode: "regression",
      baselineMode: "passing",
    });
    repoPreExisting = createBrowserTestRepo({
      targetMode: "pre-existing-failure",
      baselineMode: "pre-existing-failure",
    });
  });

  afterAll(() => {
    try {
      execFileSync("rm", ["-rf", repoIntroduced.dir]);
    } catch {
      // cleanup best-effort
    }
    try {
      execFileSync("rm", ["-rf", repoPreExisting.dir]);
    } catch {
      // cleanup best-effort
    }
  });

  // Test A: Browser INTRODUCED
  it(
    "A: baseline PASS + target FAIL produces INTRODUCED in QEResult.baselineComparisons",
    async () => {
      const gateway = createFakeGateway();
      const adapter = new PlaywrightAdapter();

      const orchestrator = new QEOrchestrator({
        gateway,
        browserCapability: adapter,
        browserConfig: {
          enabled: true,
          headless: true,
        },
      });

      const request: QERequest = {
        repositoryPath: repoIntroduced.dir,
        requirements: [
          { id: "REQ-FORM", description: "Form submission works" },
        ],
        baselineRef: repoIntroduced.baselineRef,
        targetRef: repoIntroduced.targetRef,
        profile: "standard",
        mode: "change",
      };

      const result: QEResult = await orchestrator.run(request);

      // Assert baselineComparisons exists and contains INTRODUCED
      expect(result.baselineComparisons).toBeDefined();
      expect(result.baselineComparisons!.length).toBeGreaterThanOrEqual(1);

      const browserComparison = result.baselineComparisons!.find(
        (bc) => bc.classification === "INTRODUCED",
      );
      expect(browserComparison).toBeDefined();
      expect(browserComparison!.classification).toBe("INTRODUCED");
      expect(browserComparison!.targetEvidenceId).toBeTruthy();
      expect(browserComparison!.baselineEvidenceId).toBeTruthy();
      expect(browserComparison!.targetEvidenceId).not.toBe(
        browserComparison!.baselineEvidenceId,
      );

      // Verify target evidence exists in the result
      const targetEvidence = result.evidence.find(
        (e) => e.id === browserComparison!.targetEvidenceId,
      );
      expect(targetEvidence).toBeDefined();
      expect(targetEvidence!.type).toBe("BROWSER_RESULT");
      expect(targetEvidence!.status).toBe("FAIL");

      // Verify baseline evidence exists in the result
      const baselineEvidence = result.evidence.find(
        (e) => e.id === browserComparison!.baselineEvidenceId,
      );
      expect(baselineEvidence).toBeDefined();
      expect(baselineEvidence!.type).toBe("BROWSER_RESULT");
      expect(baselineEvidence!.status).toBe("PASS");

      // Verify the finding was upgraded to REGRESSION
      const regressionFinding = result.findings.find(
        (f) => f.category === "REGRESSION",
      );
      expect(regressionFinding).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  // Test B: Browser PRE_EXISTING
  it(
    "B: baseline FAIL + target FAIL produces PRE_EXISTING in QEResult.baselineComparisons",
    async () => {
      const gateway = createFakeGateway();
      const adapter = new PlaywrightAdapter();

      const orchestrator = new QEOrchestrator({
        gateway,
        browserCapability: adapter,
        browserConfig: {
          enabled: true,
          headless: true,
        },
      });

      const request: QERequest = {
        repositoryPath: repoPreExisting.dir,
        requirements: [
          { id: "REQ-FORM", description: "Form submission works" },
        ],
        baselineRef: repoPreExisting.baselineRef,
        targetRef: repoPreExisting.targetRef,
        profile: "standard",
        mode: "change",
      };

      const result: QEResult = await orchestrator.run(request);

      // Assert baselineComparisons exists and contains PRE_EXISTING
      expect(result.baselineComparisons).toBeDefined();
      expect(result.baselineComparisons!.length).toBeGreaterThanOrEqual(1);

      const browserComparison = result.baselineComparisons!.find(
        (bc) => bc.classification === "PRE_EXISTING",
      );
      expect(browserComparison).toBeDefined();
      expect(browserComparison!.classification).toBe("PRE_EXISTING");
      expect(browserComparison!.targetEvidenceId).toBeTruthy();
      expect(browserComparison!.baselineEvidenceId).toBeTruthy();
      expect(browserComparison!.targetEvidenceId).not.toBe(
        browserComparison!.baselineEvidenceId,
      );

      // Verify both evidence entries exist
      const targetEvidence = result.evidence.find(
        (e) => e.id === browserComparison!.targetEvidenceId,
      );
      expect(targetEvidence).toBeDefined();

      const baselineEvidence = result.evidence.find(
        (e) => e.id === browserComparison!.baselineEvidenceId,
      );
      expect(baselineEvidence).toBeDefined();

      // Should NOT have REGRESSION findings — it's pre-existing
      const regressionFinding = result.findings.find(
        (f) => f.category === "REGRESSION",
      );
      expect(regressionFinding).toBeUndefined();
    },
    TEST_TIMEOUT,
  );

  // Test C: Command baseline comparison still works
  it(
    "C: command-based baseline comparison is not regressed",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "qe-cmd-baseline-"));
      execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@test.com"], {
        cwd: dir,
      });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "cmd-baseline-test",
          version: "1.0.0",
          scripts: { test: "echo test-ok" },
        }),
      );
      writeFileSync(join(dir, "index.js"), "// baseline\n");
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "-m", "baseline"], { cwd: dir });
      const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
        .toString()
        .trim();

      // Make a target that fails the test
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "cmd-baseline-test",
          version: "1.0.0",
          scripts: { test: "exit 1" },
        }),
      );
      writeFileSync(join(dir, "index.js"), "// target with bug\n");
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "-m", "target"], { cwd: dir });
      const targetRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
        .toString()
        .trim();

      const gateway = new FakeModelGateway(
        <T>(task: ReasoningTask<T>): T | undefined => {
          switch (task.role) {
            case "change_analyst":
              return {
                summary: "Code change",
                affectedComponents: [],
                behaviorChanges: [],
                potentialBlastRadius: [],
                unknowns: [],
              } as unknown as T;
            case "risk_analyst":
              return {
                level: "MEDIUM",
                factors: [
                  {
                    factor: "code-change",
                    reason: "Changed",
                    weight: "medium",
                  },
                ],
                confidence: 0.8,
                summary: "Medium risk",
              } as unknown as T;
            case "test_strategist":
              return {
                objectives: [{ id: "obj-1", description: "Verify tests" }],
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
              } as unknown as T;
            case "failure_investigator":
              return {
                likelyCause: "PRODUCT_DEFECT",
                explanation: "Test failed",
                confidence: 0.85,
                suggestRetry: false,
                suggestBaselineComparison: true,
                affectedFiles: [],
                relatedRequirementIds: [],
              } as unknown as T;
            case "gap_analyst":
              return {
                gaps: [],
                requirementAssessments: [
                  {
                    requirementId: "req-1",
                    status: "PARTIALLY_VERIFIED",
                    evidenceIds: [],
                    explanation: "Test ran",
                  },
                ],
              } as unknown as T;
            case "verdict_reviewer":
              return {
                recommendedVerdict: "FAIL",
                confidence: "HIGH",
                reasoning: "Test regression",
                concerns: [],
                recommendedNextActions: [],
                summary: "Regression found",
              } as unknown as T;
            default:
              return undefined;
          }
        },
      );

      const orchestrator = new QEOrchestrator({ gateway });

      const request: QERequest = {
        repositoryPath: dir,
        requirements: [{ id: "req-1", description: "Tests pass" }],
        baselineRef: baseRef,
        targetRef,
        profile: "standard",
        mode: "change",
      };

      const result: QEResult = await orchestrator.run(request);

      expect(result.baselineComparisons).toBeDefined();
      const cmdComparison = result.baselineComparisons!.find(
        (bc) => bc.classification === "INTRODUCED",
      );
      expect(cmdComparison).toBeDefined();
      expect(cmdComparison!.targetEvidenceId).toBeTruthy();
      expect(cmdComparison!.baselineEvidenceId).toBeTruthy();

      // Both evidence entries exist
      expect(
        result.evidence.find((e) => e.id === cmdComparison!.targetEvidenceId),
      ).toBeDefined();
      expect(
        result.evidence.find((e) => e.id === cmdComparison!.baselineEvidenceId),
      ).toBeDefined();

      try {
        execFileSync("rm", ["-rf", dir]);
      } catch {
        // cleanup best-effort
      }
    },
    TEST_TIMEOUT,
  );

  // Test D: Cleanup — no residual worktrees after browser baseline
  it(
    "D: no residual processes, ports, or worktrees after browser baseline",
    async () => {
      // Process cleanup is verified by Correction 6 tests.
      // Here we verify worktree cleanup, which is repo-specific.

      // Verify no baseline worktrees remain
      const worktreeOutput = execFileSync("git", ["worktree", "list"], {
        cwd: repoIntroduced.dir,
      })
        .toString()
        .trim();
      const worktreeLines = worktreeOutput.split("\n");
      // Only the main worktree should exist
      expect(worktreeLines.length).toBe(1);
      expect(worktreeLines[0]).toContain(repoIntroduced.dir);

      // Same for the pre-existing repo
      const worktreeOutput2 = execFileSync("git", ["worktree", "list"], {
        cwd: repoPreExisting.dir,
      })
        .toString()
        .trim();
      const worktreeLines2 = worktreeOutput2.split("\n");
      expect(worktreeLines2.length).toBe(1);
    },
    TEST_TIMEOUT,
  );
});
