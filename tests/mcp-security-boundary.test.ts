import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { McpPlaywrightAdapter } from "../src/core/browser/mcp-playwright-adapter.js";
import {
  validateMcpInvocation,
  PINNED_MCP_PACKAGE,
} from "../src/core/browser/mcp-launcher.js";
import type { BrowserExecutionContext } from "../src/core/browser/types.js";

function makeContext(
  repositoryRoot = "/tmp/fake-repo",
): BrowserExecutionContext {
  return {
    baseUrl: "http://localhost:3210",
    allowedOrigins: ["http://localhost:3210"],
    repositoryRoot,
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

function fakeServerScript(evaluateBehavior: string): string {
  return `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
  } else if (msg.method === "tools/call") {
    const name = msg.params && msg.params.name;
    if (name === "browser_evaluate") {
      ${evaluateBehavior}
    } else {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } });
    }
  } else if (msg.id !== undefined) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
});
`;
}

describe("MCP pre-read URL enforcement (fail closed)", () => {
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

  async function makeAdapter(evaluateBehavior: string): Promise<{
    adapter: McpPlaywrightAdapter;
    context: BrowserExecutionContext;
  }> {
    tmpDir = await mkdtemp(join(tmpdir(), "qe-mcp-failclosed-"));
    const serverDir = join(tmpDir, "node_modules", "@playwright", "mcp");
    await mkdir(serverDir, { recursive: true });
    const serverPath = join(serverDir, "cli.js");
    await writeFile(serverPath, fakeServerScript(evaluateBehavior), "utf-8");
    // Command policy confines execution inside a real repository root.
    const repoRoot = join(tmpDir, "repo");
    await mkdir(repoRoot, { recursive: true });
    adapter = new McpPlaywrightAdapter({
      command: process.execPath,
      args: [serverPath],
      startupTimeoutMs: 10_000,
      callTimeoutMs: 5_000,
    });
    return { adapter, context: makeContext(repoRoot) };
  }

  it("denies assertions when browser_evaluate fails", async () => {
    const { adapter: a, context } = await makeAdapter(
      `send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "evaluation failed" } });`,
    );
    const result = await a.executeAction(
      {
        type: "ASSERT_TEXT",
        selector: { type: "text", value: "Welcome" },
        value: "Welcome",
      },
      context,
    );
    expect(result.status).toBe("POLICY_DENIED");
    expect(result.error).toMatch(/could not establish current origin/i);
  });

  it("denies screenshots when browser_evaluate returns garbage", async () => {
    const { adapter: a, context } = await makeAdapter(
      `send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "garbage with no url at all!!!" }] } });`,
    );
    const result = await a.executeAction(
      { type: "SCREENSHOT", description: "page" },
      context,
    );
    expect(result.status).toBe("POLICY_DENIED");
  });

  it("fails (non-passing) ASSERT_URL when the URL cannot be established", async () => {
    const { adapter: a, context } = await makeAdapter(
      `send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "evaluation failed" } });`,
    );
    const result = await a.executeAction(
      { type: "ASSERT_URL", url: "http://localhost:3210" },
      context,
    );
    expect(result.status).not.toBe("PASS");
  });

  it("denies ASSERT_URL on a denied origin", async () => {
    const { adapter: a, context } = await makeAdapter(
      `send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: '"http://evil.example.com/stolen"' }] } });`,
    );
    const result = await a.executeAction(
      { type: "ASSERT_URL", url: "http://evil.example.com/stolen" },
      context,
    );
    expect(result.status).toBe("POLICY_DENIED");
    expect(result.error).toMatch(/denied before read/i);
  });
});
