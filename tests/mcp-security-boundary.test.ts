import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { McpPlaywrightAdapter } from "../src/core/browser/mcp-playwright-adapter.js";
import {
  validateMcpInvocation,
  PINNED_MCP_PACKAGE,
} from "../src/core/browser/mcp-launcher.js";
import type { BrowserExecutionContext } from "../src/core/browser/types.js";

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

describe("MCP screenshot path confinement", () => {
  it("sanitizes traversal descriptions into the artifact boundary", () => {
    const p = McpPlaywrightAdapter.buildScreenshotPath(
      "../../etc/passwd",
      makeContext(),
      0,
    )!;
    expect(p).toContain(resolve("/tmp/fake-repo", ".qe/runs/test"));
    expect(p.endsWith(".png")).toBe(true);
    expect(p).not.toContain("..");
    // Only the sanitized basename fragment is used.
    expect(p).toMatch(/etc-passwd-0\.png$/);
  });

  it("neutralizes absolute-path descriptions", () => {
    const p = McpPlaywrightAdapter.buildScreenshotPath(
      "/etc/shadow",
      makeContext(),
      1,
    )!;
    expect(p.startsWith(resolve("/tmp/fake-repo") + "/")).toBe(true);
    expect(p).toMatch(/etc-shadow-1\.png$/);
  });

  it("falls back for empty/meaningless descriptions", () => {
    const p = McpPlaywrightAdapter.buildScreenshotPath(
      "///...",
      makeContext(),
      2,
    )!;
    expect(p).toMatch(/screenshot-2\.png$/);
  });

  it("rejects artifact dirs escaping the repository", () => {
    const p = McpPlaywrightAdapter.buildScreenshotPath(
      "ok",
      {
        ...makeContext(),
        artifactDir: "../../outside",
      },
      0,
    );
    expect(p).toBeNull();
  });
});

describe("MCP invocation allowlist", () => {
  it("accepts the pinned npx default", () => {
    expect(() =>
      validateMcpInvocation("npx", [PINNED_MCP_PACKAGE, "--headless"]),
    ).not.toThrow();
  });

  it("accepts node with a provisioned @playwright/mcp CLI", () => {
    expect(() =>
      validateMcpInvocation(process.execPath, [
        "/cache/_npx/abc/node_modules/@playwright/mcp/cli.js",
        "--headless",
      ]),
    ).not.toThrow();
  });

  it("rejects arbitrary executables", () => {
    expect(
      () =>
        // @ts-expect-error intentional violation
        new McpPlaywrightAdapter({ command: "/tmp/evil.sh", args: [] }),
    ).toThrow(/denied/i);
    expect(() => validateMcpInvocation("curl", ["http://x"])).toThrow();
  });

  it("rejects unpinned packages and extra flags", () => {
    expect(() =>
      validateMcpInvocation("npx", ["@playwright/mcp@latest", "--headless"]),
    ).toThrow();
    expect(() =>
      validateMcpInvocation("npx", [PINNED_MCP_PACKAGE, "--allow-evil"]),
    ).toThrow();
  });
});
