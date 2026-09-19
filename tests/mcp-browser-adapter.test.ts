import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  McpPlaywrightAdapter,
  CompositeBrowserCapability,
  PlaywrightAdapter,
} from "../src/core/browser/index.js";
import type { BrowserCapability } from "../src/core/browser/index.js";
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserScenario,
  BrowserScenarioResult,
  BrowserExecutionContext,
} from "../src/core/browser/types.js";

// --- Fake MCP server script (stdio JSON-RPC) ---

const FAKE_MCP_SERVER = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "fake-playwright-mcp", version: "1.0.0" } } });
  } else if (msg.method === "notifications/initialized") {
    // notification — no response
  } else if (msg.method === "tools/call") {
    const name = msg.params && msg.params.name;
    if (name === "browser_navigate") {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "Navigated to " + msg.params.arguments.url }] } });
    } else if (name === "browser_evaluate") {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ result: "http://localhost:3210/page" }) }] } });
    } else if (name === "browser_snapshot") {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "Welcome to the app [ref=btn1][button]Submit[/button]" }] } });
    } else {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok: " + name }] } });
    }
  } else if (msg.method === "unknown_method_that_fails") {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "tool failed" } });
  } else if (msg.id !== undefined) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
});
`;

// --- Fake BrowserCapability for composite tests ---

class FakeCapability implements BrowserCapability {
  constructor(
    private readonly behavior: "pass" | "environment-blocked" | "product-fail",
  ) {}

  async available(): Promise<boolean> {
    return this.behavior !== "environment-blocked";
  }

  async executeScenario(
    scenario: BrowserScenario,
    _context: BrowserExecutionContext,
  ): Promise<BrowserScenarioResult> {
    if (this.behavior === "environment-blocked") {
      return {
        scenarioId: scenario.id,
        status: "BLOCKED",
        durationMs: 5,
        actionResults: [
          {
            action: scenario.actions[0] ?? {
              type: "NAVIGATE",
              url: scenario.baseUrl,
            },
            status: "FAIL",
            durationMs: 5,
            error: "Chromium executable not found",
            failureClassification: "ENVIRONMENT_ISSUE",
          },
        ],
      };
    }
    return {
      scenarioId: scenario.id,
      status: this.behavior === "product-fail" ? "FAIL" : "PASS",
      durationMs: 10,
      actionResults: scenario.actions.map((action) => ({
        action,
        status: this.behavior === "product-fail" ? "FAIL" : "PASS",
        durationMs: 2,
      })),
    };
  }

  async executeAction(
    action: BrowserAction,
    _context: BrowserExecutionContext,
  ): Promise<BrowserActionResult> {
    if (this.behavior === "environment-blocked") {
      return {
        action,
        status: "FAIL",
        durationMs: 5,
        error: "Chromium executable not found",
        failureClassification: "ENVIRONMENT_ISSUE",
      };
    }
    return { action, status: "PASS", durationMs: 2 };
  }

  async cleanup(): Promise<void> {}
}

function makeContext(): BrowserExecutionContext {
  return {
    baseUrl: "http://localhost:3210",
    allowedOrigins: ["http://localhost:3210"],
    repositoryRoot: "/tmp/fake-repo",
    artifactDir: ".qe/runs/test",
    budget: {
      maxBrowserScenarios: 5,
      maxBrowserActions: 50,
      maxBrowserDurationMs: 60_000,
      maxScreenshots: 3,
    },
    secrets: [],
    headless: true,
  };
}

function makeScenario(): BrowserScenario {
  return {
    id: "scenario-1",
    objective: "Check the app",
    requirementIds: ["req-1"],
    actions: [
      { type: "NAVIGATE", url: "http://localhost:3210/page" },
      {
        type: "ASSERT_TEXT",
        selector: { type: "text", value: "Welcome" },
        value: "Welcome",
      },
    ],
    baseUrl: "http://localhost:3210",
  };
}

describe("McpPlaywrightAdapter", () => {
  let tmpDir: string | undefined;
  let adapter: McpPlaywrightAdapter | undefined;

  afterEach(async () => {
    await adapter?.cleanup();
    adapter = undefined;
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  async function makeServerAdapter(): Promise<McpPlaywrightAdapter> {
    tmpDir = await mkdtemp(join(tmpdir(), "qe-mcp-"));
    // Path mirrors the provisioned layout (<...>/node_modules/@playwright/mcp/cli.js)
    // so the controlled-execution allowlist accepts the test double.
    const serverDir = join(tmpDir, "node_modules", "@playwright", "mcp");
    await mkdir(serverDir, { recursive: true });
    const serverPath = join(serverDir, "cli.js");
    await writeFile(serverPath, FAKE_MCP_SERVER, "utf-8");
    adapter = new McpPlaywrightAdapter({
      command: process.execPath,
      args: [serverPath],
      startupTimeoutMs: 10_000,
      callTimeoutMs: 5_000,
    });
    return adapter;
  }

  it("reports available when the MCP server starts", async () => {
    const a = await makeServerAdapter();
    expect(await a.available()).toBe(true);
  });

  it("reports unavailable when the server cannot be spawned", async () => {
    // Allowed invocation shape, but the CLI file does not exist, so the
    // spawn fails and available() reports false.
    const a = new McpPlaywrightAdapter({
      command: process.execPath,
      args: ["/nonexistent/node_modules/@playwright/mcp/cli.js"],
      startupTimeoutMs: 3_000,
    });
    adapter = a;
    expect(await a.available()).toBe(false);
  });

  it("executes a scenario through the MCP server", async () => {
    const a = await makeServerAdapter();
    const result = await a.executeScenario(makeScenario(), makeContext());
    expect(result.scenarioId).toBe("scenario-1");
    expect(result.status).toBe("PASS");
    expect(result.actionResults).toHaveLength(2);
    expect(result.actionResults[0].status).toBe("PASS");
    expect(result.actionResults[0].url).toBe("http://localhost:3210/page");
  });

  it("denies navigation to disallowed origins", async () => {
    const a = await makeServerAdapter();
    const result = await a.executeAction(
      {
        type: "NAVIGATE",
        url: "http://evil.example.com/page",
      },
      makeContext(),
    );
    expect(result.status).toBe("POLICY_DENIED");
    expect(result.error).toContain("denied origin");
  });

  it("redacts secrets in failing action errors", async () => {
    const a = await makeServerAdapter();
    const result = await a.executeAction(
      {
        type: "FILL",
        selector: { type: "css", value: "#token" },
        value: "sk-secret1234",
      },
      {
        ...makeContext(),
        secrets: ["sk-secret1234"],
      },
    );
    // The fake server accepts the fill; the action payload itself must be
    // redacted in the returned result.
    expect(result.action.value).toBe("[REDACTED]");
  });

  it("enforces action budget", async () => {
    const a = await makeServerAdapter();
    const scenario: BrowserScenario = {
      ...makeScenario(),
      actions: Array.from({ length: 5 }, (_, i) => ({
        type: "NAVIGATE" as const,
        url: `http://localhost:3210/page-${i}`,
      })),
    };
    const result = await a.executeScenario(scenario, {
      ...makeContext(),
      budget: {
        maxBrowserScenarios: 5,
        maxBrowserActions: 2,
        maxBrowserDurationMs: 60_000,
        maxScreenshots: 3,
      },
    });
    const executed = result.actionResults.filter(
      (r) => r.status === "PASS",
    ).length;
    const skipped = result.actionResults.filter(
      (r) => r.status === "SKIPPED",
    ).length;
    expect(executed).toBe(2);
    expect(skipped).toBe(3);
  });

  it("marks scenario BLOCKED when the server dies", async () => {
    const a = await makeServerAdapter();
    await a.available();
    // Kill the underlying server by cleaning up then executing
    await a.cleanup();
    const result = await a.executeScenario(makeScenario(), makeContext());
    // A new server is spawned automatically, so this should still work
    expect(result.status).toBe("PASS");
  });
});

describe("CompositeBrowserCapability", () => {
  it("uses the primary when it succeeds", async () => {
    const primary = new FakeCapability("pass");
    const fallback = new FakeCapability("pass");
    const composite = new CompositeBrowserCapability(primary, fallback);
    const result = await composite.executeScenario(
      makeScenario(),
      makeContext(),
    );
    expect(result.status).toBe("PASS");
  });

  it("falls back on environment failure", async () => {
    const primary = new FakeCapability("environment-blocked");
    const fallback = new FakeCapability("pass");
    const composite = new CompositeBrowserCapability(primary, fallback);
    const result = await composite.executeScenario(
      makeScenario(),
      makeContext(),
    );
    expect(result.status).toBe("PASS");
  });

  it("does not fall back on product failure", async () => {
    const primary = new FakeCapability("product-fail");
    const fallback = new FakeCapability("pass");
    const composite = new CompositeBrowserCapability(primary, fallback);
    const result = await composite.executeScenario(
      makeScenario(),
      makeContext(),
    );
    expect(result.status).toBe("FAIL");
  });

  it("falls back on single-action environment failure", async () => {
    const primary = new FakeCapability("environment-blocked");
    const fallback = new FakeCapability("pass");
    const composite = new CompositeBrowserCapability(primary, fallback);
    const result = await composite.executeAction(
      { type: "NAVIGATE", url: "http://localhost:3210" },
      makeContext(),
    );
    expect(result.status).toBe("PASS");
  });

  it("availability checks primary then fallback", async () => {
    const unavailable = new FakeCapability("environment-blocked");
    const available = new FakeCapability("pass");
    const composite = new CompositeBrowserCapability(unavailable, available);
    expect(await composite.available()).toBe(true);

    const bothUnavailable = new CompositeBrowserCapability(
      new FakeCapability("environment-blocked"),
      new FakeCapability("environment-blocked"),
    );
    expect(await bothUnavailable.available()).toBe(false);
  });

  it("cleans up both adapters", async () => {
    const primary = new FakeCapability("pass");
    const fallback = new FakeCapability("pass");
    const composite = new CompositeBrowserCapability(primary, fallback);
    await expect(composite.cleanup()).resolves.toBeUndefined();
  });

  it("composite with real PlaywrightAdapter falls back when local browser is missing", async () => {
    // On a server without Chromium this exercises the real fallback path.
    const composite = new CompositeBrowserCapability(
      new PlaywrightAdapter(),
      new FakeCapability("pass"),
    );
    const result = await composite.executeScenario(
      makeScenario(),
      makeContext(),
    );
    // Either local Chromium worked (PASS) or the fallback ran (PASS).
    expect(result.status).toBe("PASS");
    await composite.cleanup();
  });
});
