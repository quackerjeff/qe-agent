import { describe, it, expect, afterEach } from "vitest";
import {
  evaluateUrlPolicy,
  isDangerousScheme,
} from "../src/core/browser/url-policy.js";
import {
  validateBrowserAction,
  validateBrowserActions,
} from "../src/core/browser/action-validator.js";
import {
  BrowserActionSchema,
  BrowserScenarioSchema,
  BrowserScenarioResultSchema,
  BrowserBudgetSchema,
  BrowserActionResultSchema,
  BrowserFailureClassification,
} from "../src/core/browser/types.js";
import { investigateBrowserFailure } from "../src/core/browser/failure-investigator.js";
import { ManagedProcess } from "../src/core/browser/managed-process.js";
import { createBudgetForProfile } from "../src/core/orchestrator/budget-manager.js";
import { QEConfigSchema } from "../src/config/schema.js";
import { QEStateMachine } from "../src/core/lifecycle/index.js";

// ======================================================================
// URL Policy Tests
// ======================================================================

describe("URL Policy", () => {
  describe("localhost origins", () => {
    it("allows localhost HTTP", () => {
      const result = evaluateUrlPolicy("http://localhost:3000/", []);
      expect(result.allowed).toBe(true);
    });

    it("allows 127.0.0.1 HTTP", () => {
      const result = evaluateUrlPolicy("http://127.0.0.1:8080/path", []);
      expect(result.allowed).toBe(true);
    });

    it("allows 0.0.0.0", () => {
      const result = evaluateUrlPolicy("http://0.0.0.0:3000", []);
      expect(result.allowed).toBe(true);
    });

    it("allows [::1]", () => {
      const result = evaluateUrlPolicy("http://[::1]:3000", []);
      expect(result.allowed).toBe(true);
    });

    it("allows localhost HTTPS", () => {
      const result = evaluateUrlPolicy("https://localhost:3000/", []);
      expect(result.allowed).toBe(true);
    });
  });

  describe("dangerous schemes", () => {
    it("denies file: scheme", () => {
      const result = evaluateUrlPolicy("file:///etc/passwd", []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Dangerous URL scheme");
    });

    it("denies javascript: scheme", () => {
      const result = evaluateUrlPolicy("javascript:alert(1)", []);
      expect(result.allowed).toBe(false);
    });

    it("denies data: scheme", () => {
      const result = evaluateUrlPolicy("data:text/html,<h1>hi</h1>", []);
      expect(result.allowed).toBe(false);
    });

    it("denies ftp: scheme", () => {
      const result = evaluateUrlPolicy("ftp://example.com/file", []);
      expect(result.allowed).toBe(false);
    });

    it("denies blob: scheme", () => {
      const result = evaluateUrlPolicy("blob:http://localhost/uuid", []);
      expect(result.allowed).toBe(false);
    });
  });

  describe("external origins", () => {
    it("denies external origin without allowlist", () => {
      const result = evaluateUrlPolicy("https://example.com/", []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("External origin denied");
    });

    it("allows explicitly allowlisted origin", () => {
      const result = evaluateUrlPolicy("https://staging.example.com/", [
        "https://staging.example.com",
      ]);
      expect(result.allowed).toBe(true);
    });

    it("allows allowlisted origin by hostname only", () => {
      const result = evaluateUrlPolicy("https://staging.example.com/path", [
        "staging.example.com",
      ]);
      expect(result.allowed).toBe(true);
    });

    it("denies origin not in allowlist", () => {
      const result = evaluateUrlPolicy("https://evil.com/", [
        "https://safe.com",
      ]);
      expect(result.allowed).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("denies empty URL", () => {
      const result = evaluateUrlPolicy("", []);
      expect(result.allowed).toBe(false);
    });

    it("denies malformed URL", () => {
      const result = evaluateUrlPolicy("not a url", []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Malformed URL");
    });
  });

  describe("isDangerousScheme", () => {
    it("identifies file: as dangerous", () => {
      expect(isDangerousScheme("file:///etc/passwd")).toBe(true);
    });

    it("identifies http: as not dangerous", () => {
      expect(isDangerousScheme("http://localhost")).toBe(false);
    });

    it("handles malformed URL gracefully", () => {
      expect(isDangerousScheme("not a url")).toBe(false);
    });
  });
});

// ======================================================================
// Action Validation Tests
// ======================================================================

describe("Action Validation", () => {
  describe("NAVIGATE", () => {
    it("validates a valid NAVIGATE action", () => {
      const result = validateBrowserAction(
        { type: "NAVIGATE", url: "http://localhost:3000/" },
        [],
      );
      expect(result.valid).toBe(true);
    });

    it("rejects NAVIGATE without url", () => {
      const result = validateBrowserAction({ type: "NAVIGATE" }, []);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("requires url");
    });

    it("rejects NAVIGATE to external URL", () => {
      const result = validateBrowserAction(
        { type: "NAVIGATE", url: "https://evil.com/" },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("URL policy");
    });

    it("rejects NAVIGATE to dangerous scheme", () => {
      const result = validateBrowserAction(
        { type: "NAVIGATE", url: "javascript:alert(1)" },
        [],
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("interactive actions", () => {
    it("validates CLICK with selector", () => {
      const result = validateBrowserAction(
        {
          type: "CLICK",
          selector: { type: "role", value: "button" },
        },
        [],
      );
      expect(result.valid).toBe(true);
    });

    it("rejects CLICK without selector", () => {
      const result = validateBrowserAction({ type: "CLICK" }, []);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("requires a selector");
    });

    it("validates FILL with selector and value", () => {
      const result = validateBrowserAction(
        {
          type: "FILL",
          selector: { type: "label", value: "Name" },
          value: "Test User",
        },
        [],
      );
      expect(result.valid).toBe(true);
    });

    it("rejects FILL without value", () => {
      const result = validateBrowserAction(
        {
          type: "FILL",
          selector: { type: "label", value: "Name" },
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("requires a value");
    });

    it("rejects SELECT without value", () => {
      const result = validateBrowserAction(
        {
          type: "SELECT",
          selector: { type: "label", value: "Country" },
        },
        [],
      );
      expect(result.valid).toBe(false);
    });

    it("rejects PRESS without key", () => {
      const result = validateBrowserAction({ type: "PRESS" }, []);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("requires a key");
    });
  });

  describe("assertion actions", () => {
    it("validates ASSERT_TEXT with selector", () => {
      const result = validateBrowserAction(
        {
          type: "ASSERT_TEXT",
          selector: { type: "testId", value: "result" },
          value: "Success",
        },
        [],
      );
      expect(result.valid).toBe(true);
    });

    it("rejects ASSERT_VISIBLE without selector", () => {
      const result = validateBrowserAction({ type: "ASSERT_VISIBLE" }, []);
      expect(result.valid).toBe(false);
    });

    it("rejects ASSERT_HIDDEN without selector", () => {
      const result = validateBrowserAction({ type: "ASSERT_HIDDEN" }, []);
      expect(result.valid).toBe(false);
    });

    it("rejects ASSERT_VALUE without selector", () => {
      const result = validateBrowserAction({ type: "ASSERT_VALUE" }, []);
      expect(result.valid).toBe(false);
    });
  });

  describe("schema rejection", () => {
    it("rejects unknown action type", () => {
      const result = validateBrowserAction({ type: "DESTROY_ALL" }, []);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Invalid action schema");
    });

    it("rejects empty selector value", () => {
      const result = validateBrowserAction(
        {
          type: "CLICK",
          selector: { type: "role", value: "" },
        },
        [],
      );
      expect(result.valid).toBe(false);
    });

    it("rejects oversized URL", () => {
      const result = validateBrowserAction(
        { type: "NAVIGATE", url: "http://localhost/" + "x".repeat(3000) },
        [],
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("batch validation", () => {
    it("separates valid and rejected actions", () => {
      const actions = [
        { type: "NAVIGATE", url: "http://localhost:3000/" },
        { type: "CLICK" }, // missing selector
        {
          type: "FILL",
          selector: { type: "label", value: "Name" },
          value: "Test",
        },
        { type: "NAVIGATE", url: "https://evil.com/" }, // external
      ];

      const result = validateBrowserActions(actions, []);
      expect(result.valid).toHaveLength(2);
      expect(result.rejected).toHaveLength(2);
      expect(result.rejected[0].index).toBe(1);
      expect(result.rejected[1].index).toBe(3);
    });
  });
});

// ======================================================================
// Browser Types Schema Tests
// ======================================================================

describe("Browser Schemas", () => {
  it("validates a browser action", () => {
    const result = BrowserActionSchema.safeParse({
      type: "NAVIGATE",
      url: "http://localhost:3000",
    });
    expect(result.success).toBe(true);
  });

  it("validates a browser scenario", () => {
    const result = BrowserScenarioSchema.safeParse({
      id: "test-1",
      objective: "Test form submission",
      requirementIds: ["REQ-1"],
      actions: [
        { type: "NAVIGATE", url: "http://localhost:3000" },
        { type: "CLICK", selector: { type: "role", value: "button" } },
      ],
      baseUrl: "http://localhost:3000",
    });
    expect(result.success).toBe(true);
  });

  it("validates a browser scenario result", () => {
    const result = BrowserScenarioResultSchema.safeParse({
      scenarioId: "test-1",
      status: "PASS",
      actionResults: [
        {
          action: { type: "NAVIGATE", url: "http://localhost:3000" },
          status: "PASS",
          durationMs: 100,
        },
      ],
      durationMs: 200,
    });
    expect(result.success).toBe(true);
  });

  it("validates a browser action result with failure classification", () => {
    const result = BrowserActionResultSchema.safeParse({
      action: { type: "CLICK", selector: { type: "role", value: "button" } },
      status: "FAIL",
      durationMs: 5000,
      error: "Element not found",
      failureClassification: "SELECTOR_FAILURE",
    });
    expect(result.success).toBe(true);
  });

  it("validates browser budget", () => {
    const result = BrowserBudgetSchema.safeParse({
      maxBrowserScenarios: 3,
      maxBrowserActions: 30,
      maxBrowserDurationMs: 120_000,
      maxScreenshots: 5,
    });
    expect(result.success).toBe(true);
  });

  it("validates all failure classifications", () => {
    const classifications = [
      "PRODUCT_DEFECT",
      "TEST_DEFECT",
      "SELECTOR_FAILURE",
      "ENVIRONMENT_ISSUE",
      "APPLICATION_NOT_READY",
      "AUTHENTICATION_FAILURE",
      "NETWORK_FAILURE",
      "TIMEOUT",
      "UNKNOWN",
    ];
    for (const c of classifications) {
      expect(BrowserFailureClassification.safeParse(c).success).toBe(true);
    }
  });

  it("rejects invalid failure classification", () => {
    expect(BrowserFailureClassification.safeParse("INVALID").success).toBe(
      false,
    );
  });
});

// ======================================================================
// Failure Investigation Tests
// ======================================================================

describe("Browser Failure Investigation", () => {
  const makeScenarioResult = (
    overrides: Partial<{
      consoleErrors: string[];
      pageErrors: string[];
      failedRequests: { url: string; status?: number; method?: string }[];
    }> = {},
  ) => ({
    scenarioId: "test-1",
    status: "FAIL" as const,
    actionResults: [],
    durationMs: 1000,
    ...overrides,
  });

  const makeActionResult = (
    type: string,
    status: "PASS" | "FAIL" | "SKIPPED" | "POLICY_DENIED",
    overrides: Record<string, unknown> = {},
  ) => ({
    action: {
      type: type as "NAVIGATE",
      ...(type !== "NAVIGATE" &&
      type !== "PRESS" &&
      type !== "SCREENSHOT" &&
      type !== "ASSERT_URL"
        ? { selector: { type: "role" as const, value: "button" } }
        : {}),
      ...(type === "NAVIGATE" ? { url: "http://localhost:3000" } : {}),
      ...(type === "PRESS" ? { key: "Enter" } : {}),
    },
    status,
    durationMs: 100,
    ...overrides,
  });

  it("classifies assertion failure as PRODUCT_DEFECT when previous actions passed", () => {
    const result = investigateBrowserFailure(
      makeScenarioResult(),
      makeActionResult("ASSERT_TEXT", "FAIL", {
        expected: "Success",
        actual: "Error",
      }),
      [makeActionResult("NAVIGATE", "PASS"), makeActionResult("CLICK", "PASS")],
    );
    expect(result.classification).toBe("PRODUCT_DEFECT");
    expect(result.isProductDefect).toBe(true);
    expect(result.suggestBaselineComparison).toBe(true);
  });

  it("classifies selector error as SELECTOR_FAILURE", () => {
    const result = investigateBrowserFailure(
      makeScenarioResult(),
      makeActionResult("CLICK", "FAIL", {
        error: "waiting for selector - no element matching",
        failureClassification: "SELECTOR_FAILURE",
      }),
      [makeActionResult("NAVIGATE", "PASS")],
    );
    expect(result.classification).toBe("SELECTOR_FAILURE");
    expect(result.isProductDefect).toBe(false);
  });

  it("classifies timeout error as TIMEOUT", () => {
    const result = investigateBrowserFailure(
      makeScenarioResult(),
      makeActionResult("NAVIGATE", "FAIL", {
        error: "Navigation timeout exceeded",
        failureClassification: "TIMEOUT",
      }),
      [],
    );
    expect(result.classification).toBe("TIMEOUT");
    expect(result.suggestRetry).toBe(true);
  });

  it("classifies connection refused as NETWORK_FAILURE", () => {
    const result = investigateBrowserFailure(
      makeScenarioResult(),
      makeActionResult("NAVIGATE", "FAIL", {
        error: "net::ERR_CONNECTION_REFUSED",
        failureClassification: "NETWORK_FAILURE",
      }),
      [],
    );
    expect(result.classification).toBe("NETWORK_FAILURE");
    expect(result.suggestRetry).toBe(true);
  });

  it("classifies policy-denied action as TEST_DEFECT", () => {
    const result = investigateBrowserFailure(
      makeScenarioResult(),
      makeActionResult("NAVIGATE", "POLICY_DENIED"),
      [],
    );
    expect(result.classification).toBe("TEST_DEFECT");
    expect(result.isProductDefect).toBe(false);
  });

  it("classifies all-previous-failed as APPLICATION_NOT_READY", () => {
    const result = investigateBrowserFailure(
      makeScenarioResult(),
      makeActionResult("CLICK", "FAIL"),
      [makeActionResult("NAVIGATE", "FAIL"), makeActionResult("CLICK", "FAIL")],
    );
    expect(result.classification).toBe("APPLICATION_NOT_READY");
    expect(result.suggestRetry).toBe(true);
  });

  it("classifies 401 error as AUTHENTICATION_FAILURE", () => {
    const result = investigateBrowserFailure(
      makeScenarioResult(),
      makeActionResult("NAVIGATE", "FAIL", {
        error: "401 Unauthorized",
        failureClassification: "AUTHENTICATION_FAILURE",
      }),
      [],
    );
    expect(result.classification).toBe("AUTHENTICATION_FAILURE");
  });

  it("returns meaningful explanation for product defect", () => {
    const result = investigateBrowserFailure(
      makeScenarioResult(),
      makeActionResult("ASSERT_TEXT", "FAIL", {
        expected: "Success",
        actual: "Error",
        description: "Check result text",
      }),
      [makeActionResult("NAVIGATE", "PASS")],
    );
    expect(result.explanation).toContain("Assertion failed");
    expect(result.explanation).toContain("product defect");
  });
});

// ======================================================================
// Managed Process Tests
// ======================================================================

describe("ManagedProcess", () => {
  let managedProcess: ManagedProcess | null = null;

  afterEach(async () => {
    if (managedProcess) {
      await managedProcess.stop();
      managedProcess = null;
    }
  });

  it("starts a simple HTTP server and detects readiness", async () => {
    const port = 3200 + Math.floor(Math.random() * 100);
    managedProcess = new ManagedProcess({
      executable: "node",
      args: ["fixtures/browser-eval/server.cjs"],
      cwd: process.cwd(),
      port,
      readinessTimeoutMs: 10_000,
      readinessIntervalMs: 200,
    });

    const result = await managedProcess.start();
    expect(result.started).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.info).toBeDefined();
    expect(result.info!.pid).toBeGreaterThan(0);
    expect(result.info!.port).toBe(port);
    expect(managedProcess.started).toBe(true);
    expect(managedProcess.ready).toBe(true);
  }, 15_000);

  it("stops a running process and frees the port", async () => {
    const port = 3300 + Math.floor(Math.random() * 100);
    managedProcess = new ManagedProcess({
      executable: "node",
      args: ["fixtures/browser-eval/server.cjs"],
      cwd: process.cwd(),
      port,
      readinessTimeoutMs: 10_000,
      readinessIntervalMs: 200,
    });

    await managedProcess.start();
    await managedProcess.stop();

    const portFree = await managedProcess.isPortFree();
    expect(portFree).toBe(true);
    expect(managedProcess.started).toBe(false);
    managedProcess = null;
  }, 20_000);

  it("detects startup failure from crash", async () => {
    const port = 3400 + Math.floor(Math.random() * 100);
    managedProcess = new ManagedProcess({
      executable: "node",
      args: ["fixtures/browser-eval/server-crash.cjs"],
      cwd: process.cwd(),
      port,
      readinessTimeoutMs: 3_000,
      readinessIntervalMs: 200,
    });

    const result = await managedProcess.start();
    expect(result.started).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.error).toContain("exited before ready");
    managedProcess = null;
  }, 10_000);

  it("detects readiness timeout from hanging server", async () => {
    const port = 6500 + Math.floor(Math.random() * 100);
    managedProcess = new ManagedProcess({
      executable: "node",
      args: ["fixtures/browser-eval/server-hang.cjs"],
      cwd: process.cwd(),
      port,
      readinessTimeoutMs: 2_000,
      readinessIntervalMs: 200,
    });

    const result = await managedProcess.start();
    expect(result.started).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.error).toBe("Readiness timeout");
  }, 10_000);

  it("captures bounded output", async () => {
    const port = 3600 + Math.floor(Math.random() * 100);
    managedProcess = new ManagedProcess({
      executable: "node",
      args: ["fixtures/browser-eval/server.cjs"],
      cwd: process.cwd(),
      port,
      maxOutputLines: 5,
      readinessTimeoutMs: 10_000,
      readinessIntervalMs: 200,
    });

    const result = await managedProcess.start();
    expect(result.started).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(5);
  }, 15_000);
});

// ======================================================================
// Browser Budget Tests
// ======================================================================

describe("Browser Budget Profiles", () => {
  it("quick profile has conservative browser limits", () => {
    const budget = createBudgetForProfile("quick");
    expect(budget.maxBrowserScenarios).toBe(1);
    expect(budget.maxBrowserActions).toBe(10);
    expect(budget.maxBrowserDurationMs).toBe(30_000);
    expect(budget.maxScreenshots).toBe(2);
  });

  it("standard profile has moderate browser limits", () => {
    const budget = createBudgetForProfile("standard");
    expect(budget.maxBrowserScenarios).toBe(3);
    expect(budget.maxBrowserActions).toBe(30);
    expect(budget.maxBrowserDurationMs).toBe(120_000);
    expect(budget.maxScreenshots).toBe(5);
  });

  it("deep profile has broader browser limits", () => {
    const budget = createBudgetForProfile("deep");
    expect(budget.maxBrowserScenarios).toBe(8);
    expect(budget.maxBrowserActions).toBe(80);
    expect(budget.maxBrowserDurationMs).toBe(300_000);
    expect(budget.maxScreenshots).toBe(10);
  });
});

// ======================================================================
// Config Tests
// ======================================================================

describe("Browser Config", () => {
  it("accepts browser config with all fields", () => {
    const config = QEConfigSchema.parse({
      version: 1,
      browser: {
        enabled: true,
        baseUrl: "http://localhost:3000",
        allowedOrigins: ["https://staging.example.com"],
        headless: false,
      },
    });
    expect(config.browser.enabled).toBe(true);
    expect(config.browser.baseUrl).toBe("http://localhost:3000");
    expect(config.browser.allowedOrigins).toEqual([
      "https://staging.example.com",
    ]);
    expect(config.browser.headless).toBe(false);
  });

  it("defaults browser.enabled to 'auto'", () => {
    const config = QEConfigSchema.parse({ version: 1 });
    expect(config.browser.enabled).toBe("auto");
  });

  it("defaults browser.headless to true", () => {
    const config = QEConfigSchema.parse({ version: 1 });
    expect(config.browser.headless).toBe(true);
  });

  it("accepts browser.enabled as boolean false", () => {
    const config = QEConfigSchema.parse({
      version: 1,
      browser: { enabled: false },
    });
    expect(config.browser.enabled).toBe(false);
  });
});

// ======================================================================
// Lifecycle State Machine Tests
// ======================================================================

describe("Lifecycle BROWSER_VALIDATING state", () => {
  it("allows transition from ANALYZING_GAPS to BROWSER_VALIDATING", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING", "discover");
    sm.transition("ASSESSING_RISK", "risk");
    sm.transition("PLANNING", "plan");
    sm.transition("EXECUTING", "exec");
    sm.transition("ANALYZING_GAPS", "gaps");
    expect(sm.canTransitionTo("BROWSER_VALIDATING")).toBe(true);
    sm.transition("BROWSER_VALIDATING", "browser");
    expect(sm.state).toBe("BROWSER_VALIDATING");
  });

  it("allows transition from BROWSER_VALIDATING to ANALYZING_GAPS", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING", "discover");
    sm.transition("ASSESSING_RISK", "risk");
    sm.transition("PLANNING", "plan");
    sm.transition("EXECUTING", "exec");
    sm.transition("ANALYZING_GAPS", "gaps");
    sm.transition("BROWSER_VALIDATING", "browser");
    expect(sm.canTransitionTo("ANALYZING_GAPS")).toBe(true);
    sm.transition("ANALYZING_GAPS", "re-analyze");
    expect(sm.state).toBe("ANALYZING_GAPS");
  });

  it("allows transition from BROWSER_VALIDATING to FORMING_VERDICT", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING", "discover");
    sm.transition("ASSESSING_RISK", "risk");
    sm.transition("PLANNING", "plan");
    sm.transition("EXECUTING", "exec");
    sm.transition("ANALYZING_GAPS", "gaps");
    sm.transition("BROWSER_VALIDATING", "browser");
    expect(sm.canTransitionTo("FORMING_VERDICT")).toBe(true);
  });

  it("allows transition from ANALYZING_GAPS to GENERATING_TESTS (bypass browser)", () => {
    const sm = new QEStateMachine();
    sm.transition("DISCOVERING", "discover");
    sm.transition("ASSESSING_RISK", "risk");
    sm.transition("PLANNING", "plan");
    sm.transition("EXECUTING", "exec");
    sm.transition("ANALYZING_GAPS", "gaps");
    expect(sm.canTransitionTo("GENERATING_TESTS")).toBe(true);
  });
});
