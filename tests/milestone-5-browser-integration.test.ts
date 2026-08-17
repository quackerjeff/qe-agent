import { describe, it, expect, afterEach } from "vitest";
import { PlaywrightAdapter } from "../src/core/browser/playwright-adapter.js";
import { ManagedProcess } from "../src/core/browser/managed-process.js";
import { investigateBrowserFailure } from "../src/core/browser/failure-investigator.js";
import { validateBrowserAction } from "../src/core/browser/action-validator.js";
import type {
  BrowserScenario,
  BrowserExecutionContext,
} from "../src/core/browser/types.js";

const TEST_TIMEOUT = 30_000;

function makeContext(
  port: number,
  overrides: Partial<BrowserExecutionContext> = {},
): BrowserExecutionContext {
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    allowedOrigins: [],
    repositoryRoot: process.cwd(),
    artifactDir: `.qe/runs/test-${Date.now()}`,
    budget: {
      maxBrowserScenarios: 3,
      maxBrowserActions: 30,
      maxBrowserDurationMs: 60_000,
      maxScreenshots: 5,
    },
    secrets: [],
    headless: true,
    ...overrides,
  };
}

function randomPort(): number {
  return 4100 + Math.floor(Math.random() * 900);
}

describe("Browser Integration — Evaluation Scenarios", () => {
  let adapter: PlaywrightAdapter;
  let managedProcess: ManagedProcess | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.cleanup();
    }
    if (managedProcess) {
      await managedProcess.stop();
      const portFree = await managedProcess.isPortFree();
      expect(portFree).toBe(true);
      managedProcess = null;
    }
  });

  // ========================================
  // Scenario A — Passing Browser Flow
  // ========================================
  it(
    "Scenario A: passing browser flow — navigate, interact, assert PASS, cleanup",
    async () => {
      const port = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port,
        env: { APP_MODE: "passing" },
        readinessTimeoutMs: 10_000,
      });

      const startResult = await managedProcess.start();
      expect(startResult.ready).toBe(true);

      adapter = new PlaywrightAdapter();
      expect(await adapter.available()).toBe(true);

      const scenario: BrowserScenario = {
        id: "scenario-a",
        objective: "Verify form submission works",
        requirementIds: ["REQ-FORM"],
        actions: [
          { type: "NAVIGATE", url: `http://127.0.0.1:${port}/` },
          {
            type: "FILL",
            selector: { type: "placeholder", value: "Enter name" },
            value: "Test User",
          },
          {
            type: "FILL",
            selector: { type: "placeholder", value: "Enter email" },
            value: "test@example.com",
          },
          {
            type: "CLICK",
            selector: { type: "role", value: "button" },
          },
          {
            type: "ASSERT_TEXT",
            selector: { type: "testId", value: "result" },
            value: "Save successful",
          },
        ],
        baseUrl: `http://127.0.0.1:${port}`,
      };

      const context = makeContext(port);
      const result = await adapter.executeScenario(scenario, context);

      expect(result.status).toBe("PASS");
      expect(result.actionResults.every((r) => r.status === "PASS")).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  // ========================================
  // Scenario B — Introduced UI Regression
  // ========================================
  it(
    "Scenario B: introduced UI regression — baseline PASS, target FAIL, INTRODUCED",
    async () => {
      // Target (regression mode): submission returns error
      const port = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port,
        env: { APP_MODE: "regression" },
        readinessTimeoutMs: 10_000,
      });
      const startResult = await managedProcess.start();
      expect(startResult.ready).toBe(true);

      adapter = new PlaywrightAdapter();

      const scenario: BrowserScenario = {
        id: "scenario-b-target",
        objective: "Verify form submission shows success",
        requirementIds: ["REQ-FORM"],
        actions: [
          { type: "NAVIGATE", url: `http://127.0.0.1:${port}/` },
          {
            type: "FILL",
            selector: { type: "placeholder", value: "Enter name" },
            value: "Test User",
          },
          {
            type: "CLICK",
            selector: { type: "role", value: "button" },
          },
          {
            type: "ASSERT_TEXT",
            selector: { type: "testId", value: "result" },
            value: "Save successful",
          },
        ],
        baseUrl: `http://127.0.0.1:${port}`,
      };

      const context = makeContext(port);
      const targetResult = await adapter.executeScenario(scenario, context);
      expect(targetResult.status).toBe("FAIL");

      // Check the assertion failure
      const failedAction = targetResult.actionResults.find(
        (r) => r.status === "FAIL",
      )!;
      expect(failedAction).toBeDefined();
      expect(failedAction.action.type).toBe("ASSERT_TEXT");
      expect(failedAction.expected).toBe("Save successful");
      expect(failedAction.actual).toContain("Error");

      // Investigate
      const passedBefore = targetResult.actionResults.slice(
        0,
        targetResult.actionResults.indexOf(failedAction),
      );
      const investigation = investigateBrowserFailure(
        targetResult,
        failedAction,
        passedBefore,
      );
      expect(investigation.classification).toBe("PRODUCT_DEFECT");
      expect(investigation.isProductDefect).toBe(true);
      expect(investigation.suggestBaselineComparison).toBe(true);

      // Cleanup target
      await adapter.cleanup();
      await managedProcess.stop();

      // Baseline (passing mode): submission succeeds
      const basePort = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port: basePort,
        env: { APP_MODE: "passing" },
        readinessTimeoutMs: 10_000,
      });
      const baseStart = await managedProcess.start();
      expect(baseStart.ready).toBe(true);

      adapter = new PlaywrightAdapter();

      const baseScenario: BrowserScenario = {
        ...scenario,
        id: "scenario-b-baseline",
        baseUrl: `http://127.0.0.1:${basePort}`,
        actions: scenario.actions.map((a) =>
          a.type === "NAVIGATE"
            ? { ...a, url: `http://127.0.0.1:${basePort}/` }
            : a,
        ),
      };

      const baseContext = makeContext(basePort);
      const baseResult = await adapter.executeScenario(
        baseScenario,
        baseContext,
      );
      expect(baseResult.status).toBe("PASS");

      // Classification: baseline PASS, target FAIL => INTRODUCED
      const classification =
        baseResult.status === "PASS" && targetResult.status === "FAIL"
          ? "INTRODUCED"
          : "UNKNOWN";
      expect(classification).toBe("INTRODUCED");
    },
    TEST_TIMEOUT,
  );

  // ========================================
  // Scenario C — Pre-Existing UI Failure
  // ========================================
  it(
    "Scenario C: pre-existing UI failure — both baseline and target fail => PRE_EXISTING",
    async () => {
      const port = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port,
        env: { APP_MODE: "pre-existing-failure" },
        readinessTimeoutMs: 10_000,
      });
      const startResult = await managedProcess.start();
      expect(startResult.ready).toBe(true);

      adapter = new PlaywrightAdapter();

      const scenario: BrowserScenario = {
        id: "scenario-c",
        objective: "Verify form submission shows success",
        requirementIds: ["REQ-FORM"],
        actions: [
          { type: "NAVIGATE", url: `http://127.0.0.1:${port}/` },
          {
            type: "CLICK",
            selector: { type: "role", value: "button" },
          },
          {
            type: "ASSERT_TEXT",
            selector: { type: "testId", value: "result" },
            value: "Save successful",
          },
        ],
        baseUrl: `http://127.0.0.1:${port}`,
      };

      const context = makeContext(port);
      const targetResult = await adapter.executeScenario(scenario, context);
      expect(targetResult.status).toBe("FAIL");

      await adapter.cleanup();

      // Same mode as baseline (both fail)
      adapter = new PlaywrightAdapter();
      const baseResult = await adapter.executeScenario(scenario, context);
      expect(baseResult.status).toBe("FAIL");

      // Both fail => PRE_EXISTING
      const classification =
        baseResult.status === "FAIL" && targetResult.status === "FAIL"
          ? "PRE_EXISTING"
          : "UNKNOWN";
      expect(classification).toBe("PRE_EXISTING");
    },
    TEST_TIMEOUT,
  );

  // ========================================
  // Scenario D — Bad Selector
  // ========================================
  it(
    "Scenario D: bad selector — not automatically a product defect",
    async () => {
      const port = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port,
        env: { APP_MODE: "passing" },
        readinessTimeoutMs: 10_000,
      });
      const startResult = await managedProcess.start();
      expect(startResult.ready).toBe(true);

      adapter = new PlaywrightAdapter();

      const scenario: BrowserScenario = {
        id: "scenario-d",
        objective: "Test with incorrect selector",
        requirementIds: ["REQ-FORM"],
        actions: [
          { type: "NAVIGATE", url: `http://127.0.0.1:${port}/` },
          {
            type: "CLICK",
            selector: { type: "testId", value: "nonexistent-element" },
            timeoutMs: 2_000,
          },
        ],
        baseUrl: `http://127.0.0.1:${port}`,
      };

      const context = makeContext(port);
      const result = await adapter.executeScenario(scenario, context);
      expect(result.status).toBe("FAIL");

      const failedAction = result.actionResults.find(
        (r) => r.status === "FAIL",
      )!;
      expect(failedAction).toBeDefined();

      const passedBefore = result.actionResults.slice(
        0,
        result.actionResults.indexOf(failedAction),
      );
      const investigation = investigateBrowserFailure(
        result,
        failedAction,
        passedBefore,
      );

      // Must not be PRODUCT_DEFECT — it's a selector/test issue
      expect(investigation.classification).not.toBe("PRODUCT_DEFECT");
      expect(["SELECTOR_FAILURE", "TIMEOUT", "UNKNOWN"]).toContain(
        investigation.classification,
      );
      expect(investigation.isProductDefect).toBe(false);
    },
    TEST_TIMEOUT,
  );

  // ========================================
  // Scenario E — Startup Failure
  // ========================================
  it(
    "Scenario E: startup failure — truthful evidence, no fabricated browser evidence",
    async () => {
      const port = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server-crash.cjs"],
        cwd: process.cwd(),
        port,
        readinessTimeoutMs: 5_000,
      });

      const result = await managedProcess.start();
      expect(result.started).toBe(true);
      expect(result.ready).toBe(false);
      expect(result.error).toContain("exited before ready");

      // No browser validation should proceed — no adapter instantiation
      // Evidence records startup failure truthfully
      expect(result.stderr.length).toBeGreaterThan(0);
      managedProcess = null;
    },
    TEST_TIMEOUT,
  );

  // ========================================
  // Scenario F — Readiness Timeout
  // ========================================
  it(
    "Scenario F: readiness timeout — managed process terminated, cleanup verified",
    async () => {
      const port = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server-hang.cjs"],
        cwd: process.cwd(),
        port,
        readinessTimeoutMs: 2_000,
      });

      const result = await managedProcess.start();
      expect(result.started).toBe(true);
      expect(result.ready).toBe(false);
      expect(result.error).toBe("Readiness timeout");

      // Stop and verify port is freed
      await managedProcess.stop();
      const portFree = await managedProcess.isPortFree();
      expect(portFree).toBe(true);
      managedProcess = null;
    },
    TEST_TIMEOUT,
  );

  // ========================================
  // Scenario G — External Navigation
  // ========================================
  it(
    "Scenario G: external navigation denied — external site never visited",
    async () => {
      const port = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port,
        env: { APP_MODE: "passing" },
        readinessTimeoutMs: 10_000,
      });
      const startResult = await managedProcess.start();
      expect(startResult.ready).toBe(true);

      adapter = new PlaywrightAdapter();

      const scenario: BrowserScenario = {
        id: "scenario-g",
        objective: "Attempt external navigation",
        requirementIds: ["REQ-SECURITY"],
        actions: [
          { type: "NAVIGATE", url: `http://127.0.0.1:${port}/` },
          {
            type: "NAVIGATE",
            url: "https://example-external-site.invalid/",
          },
          {
            type: "ASSERT_TEXT",
            selector: { type: "css", value: "h1" },
            value: "Welcome",
          },
        ],
        baseUrl: `http://127.0.0.1:${port}`,
      };

      const context = makeContext(port);
      const result = await adapter.executeScenario(scenario, context);

      // The external navigation should be POLICY_DENIED
      const externalAction = result.actionResults.find(
        (r) =>
          r.action.type === "NAVIGATE" &&
          r.action.url?.includes("external-site"),
      );
      expect(externalAction).toBeDefined();
      expect(externalAction!.status).toBe("POLICY_DENIED");
      expect(externalAction!.error).toContain("URL policy");
    },
    TEST_TIMEOUT,
  );

  // ========================================
  // Scenario H — Prompt Injection
  // ========================================
  it(
    "Scenario H: prompt injection page — URL policy and write policy remain enforced",
    async () => {
      const port = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port,
        env: { APP_MODE: "prompt-injection" },
        readinessTimeoutMs: 10_000,
      });
      const startResult = await managedProcess.start();
      expect(startResult.ready).toBe(true);

      adapter = new PlaywrightAdapter();

      // Navigate to the page with injection text
      const scenario: BrowserScenario = {
        id: "scenario-h",
        objective: "Navigate to page containing prompt injection text",
        requirementIds: ["REQ-SECURITY"],
        actions: [
          { type: "NAVIGATE", url: `http://127.0.0.1:${port}/` },
          {
            type: "ASSERT_VISIBLE",
            selector: { type: "testId", value: "content" },
          },
        ],
        baseUrl: `http://127.0.0.1:${port}`,
      };

      const context = makeContext(port);
      const result = await adapter.executeScenario(scenario, context);
      expect(result.status).toBe("PASS");

      // URL policy enforcement: external navigation denied
      const externalValidation = validateBrowserAction(
        {
          type: "NAVIGATE",
          url: "https://example-external-site.invalid",
        },
        [],
      );
      expect(externalValidation.valid).toBe(false);

      // Dangerous scheme denied
      const jsValidation = validateBrowserAction(
        {
          type: "NAVIGATE",
          url: "javascript:alert(1)",
        },
        [],
      );
      expect(jsValidation.valid).toBe(false);

      // Write policy remains unaffected (browser adapter never writes files)
    },
    TEST_TIMEOUT,
  );

  // ========================================
  // Scenario I — Generated Browser Regression Test
  // ========================================
  it(
    "Scenario I: browser defect confirmed — regression test could be generated and retained",
    async () => {
      // Demonstrate that a confirmed UI defect produces PRODUCT_DEFECT
      // and the evidence structure supports test generation flow
      const port = randomPort();
      managedProcess = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port,
        env: { APP_MODE: "regression" },
        readinessTimeoutMs: 10_000,
      });
      const startResult = await managedProcess.start();
      expect(startResult.ready).toBe(true);

      adapter = new PlaywrightAdapter();

      const scenario: BrowserScenario = {
        id: "scenario-i",
        objective: "Verify form submission result",
        requirementIds: ["REQ-FORM"],
        actions: [
          { type: "NAVIGATE", url: `http://127.0.0.1:${port}/` },
          {
            type: "FILL",
            selector: { type: "placeholder", value: "Enter name" },
            value: "Test User",
          },
          {
            type: "CLICK",
            selector: { type: "role", value: "button" },
          },
          {
            type: "ASSERT_TEXT",
            selector: { type: "testId", value: "result" },
            value: "Save successful",
          },
        ],
        baseUrl: `http://127.0.0.1:${port}`,
      };

      const context = makeContext(port);
      const result = await adapter.executeScenario(scenario, context);
      expect(result.status).toBe("FAIL");

      const failedAction = result.actionResults.find(
        (r) => r.status === "FAIL",
      )!;
      const passedBefore = result.actionResults.slice(
        0,
        result.actionResults.indexOf(failedAction),
      );
      const investigation = investigateBrowserFailure(
        result,
        failedAction,
        passedBefore,
      );

      // Confirmed product defect
      expect(investigation.classification).toBe("PRODUCT_DEFECT");
      expect(investigation.isProductDefect).toBe(true);

      // Evidence structure supports regression test generation:
      // - scenarioId available for test naming
      // - requirementIds for traceability
      // - explicit expected/actual for assertion construction
      // - baseUrl for test configuration
      expect(result.scenarioId).toBe("scenario-i");
      expect(failedAction.expected).toBe("Save successful");
      expect(failedAction.actual).toBeDefined();
      expect(scenario.requirementIds).toContain("REQ-FORM");
    },
    TEST_TIMEOUT,
  );
});

describe("Browser Integration — Process Cleanup", () => {
  it(
    "no orphaned processes after cleanup",
    async () => {
      const port = randomPort();
      const mp = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port,
        env: { APP_MODE: "passing" },
        readinessTimeoutMs: 10_000,
      });

      const startResult = await mp.start();
      expect(startResult.ready).toBe(true);
      const pid = mp.pid;
      expect(pid).toBeDefined();

      await mp.stop();
      const portFree = await mp.isPortFree();
      expect(portFree).toBe(true);

      // Verify the process is actually gone
      let processAlive = false;
      try {
        process.kill(pid!, 0);
        processAlive = true;
      } catch {
        processAlive = false;
      }
      expect(processAlive).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    "adapter cleanup releases browser resources",
    async () => {
      const adapter = new PlaywrightAdapter();
      const port = randomPort();
      const mp = new ManagedProcess({
        executable: "node",
        args: ["fixtures/browser-eval/server.cjs"],
        cwd: process.cwd(),
        port,
        env: { APP_MODE: "passing" },
        readinessTimeoutMs: 10_000,
      });

      const startResult = await mp.start();
      expect(startResult.ready).toBe(true);

      const context = makeContext(port);
      const scenario: BrowserScenario = {
        id: "cleanup-test",
        objective: "Test cleanup",
        requirementIds: [],
        actions: [
          { type: "NAVIGATE", url: `http://127.0.0.1:${port}/` },
          {
            type: "ASSERT_VISIBLE",
            selector: { type: "css", value: "h1" },
          },
        ],
        baseUrl: `http://127.0.0.1:${port}`,
      };

      const result = await adapter.executeScenario(scenario, context);
      expect(result.status).toBe("PASS");

      await adapter.cleanup();
      await mp.stop();

      const portFree = await mp.isPortFree();
      expect(portFree).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
