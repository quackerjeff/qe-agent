import { spawn, type ChildProcess } from "node:child_process";
import type { BrowserCapability } from "./capability.js";
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserScenario,
  BrowserScenarioResult,
  BrowserExecutionContext,
  BrowserFailureClassification,
} from "./types.js";
import { executeScenarioActions } from "./scenario-executor.js";
import { evaluateUrlPolicy } from "./url-policy.js";
import { redactSecrets } from "../../execution/secret-redactor.js";

/**
 * BrowserCapability implementation backed by a Playwright MCP server
 * (e.g. `npx @playwright/mcp`) spoken to over stdio JSON-RPC.
 *
 * Used as a fallback when a local Chromium binary is unavailable
 * (ADR-012). The MCP server owns the actual browser; this adapter only
 * translates the QE Agent's deterministic action vocabulary into MCP
 * tool calls. Budget and URL-policy enforcement live in the shared
 * scenario executor; secret redaction uses the canonical redactor.
 */

export interface McpPlaywrightOptions {
  /** Executable to launch the MCP server (default: npx). */
  command: string;
  /** Arguments for the MCP server executable. */
  args: string[];
  /** Working directory for the MCP server process. */
  cwd?: string;
  /** Startup timeout for the server + initialize handshake (ms). */
  startupTimeoutMs?: number;
  /** Per-tool-call timeout (ms). */
  callTimeoutMs?: number;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
}

export class McpPlaywrightAdapter implements BrowserCapability {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private buffer = "";
  private readonly options: McpPlaywrightOptions;

  constructor(options: McpPlaywrightOptions) {
    this.options = options;
  }

  async available(): Promise<boolean> {
    try {
      await this.ensureServer();
      return true;
    } catch {
      await this.cleanup();
      return false;
    }
  }

  async executeScenario(
    scenario: BrowserScenario,
    context: BrowserExecutionContext,
  ): Promise<BrowserScenarioResult> {
    await this.ensureServer();
    return executeScenarioActions(scenario, context, (action) =>
      this.executeAction(action, context),
    );
  }

  async executeAction(
    action: BrowserAction,
    context: BrowserExecutionContext,
  ): Promise<BrowserActionResult> {
    const startTime = Date.now();
    const elapsed = () => Date.now() - startTime;

    try {
      await this.ensureServer();

      switch (action.type) {
        case "NAVIGATE":
          return await this.navigate(action, context, startTime);

        case "CLICK":
          await this.callTool("browser_click", {
            element: action.description ?? "click target",
            ref: this.selectorToRef(action.selector!),
          });
          return await this.postActionResult(action, context, startTime);

        case "FILL":
          await this.callTool("browser_fill", {
            element: action.description ?? "fill target",
            ref: this.selectorToRef(action.selector!),
            value: action.value ?? "",
          });
          return {
            action: this.redactActionSecrets(action, context.secrets),
            status: "PASS",
            durationMs: elapsed(),
          };

        case "SELECT":
          await this.callTool("browser_select_option", {
            element: action.description ?? "select target",
            ref: this.selectorToRef(action.selector!),
            values: [action.value ?? ""],
          });
          return { action, status: "PASS", durationMs: elapsed() };

        case "CHECK":
        case "UNCHECK":
          await this.callTool(
            action.type === "CHECK" ? "browser_check" : "browser_uncheck",
            {
              element: action.description ?? "checkbox",
              ref: this.selectorToRef(action.selector!),
            },
          );
          return { action, status: "PASS", durationMs: elapsed() };

        case "PRESS":
          await this.callTool("browser_press_key", { key: action.key! });
          return await this.postActionResult(action, context, startTime);

        case "ASSERT_TEXT":
          return await this.assertSnapshotText(action, context, startTime);

        case "ASSERT_VISIBLE":
        case "ASSERT_HIDDEN":
          return await this.assertSnapshotVisibility(
            action,
            context,
            startTime,
          );

        case "ASSERT_URL": {
          const currentUrl = await this.currentUrl();
          const expected = action.url ?? action.value ?? "";
          const pass = currentUrl.includes(expected);
          return {
            action,
            status: pass ? "PASS" : "FAIL",
            durationMs: elapsed(),
            url: currentUrl,
            expected: redactSecrets(expected, context.secrets),
            actual: redactSecrets(currentUrl, context.secrets),
          };
        }

        case "ASSERT_VALUE":
          return await this.assertSnapshotValue(action, context, startTime);

        case "SCREENSHOT":
          // MCP-managed browser captures screenshots server-side;
          // no local artifact is written by QE.
          await this.callTool("browser_take_screenshot", {
            filename: `${action.description ?? "screenshot"}.png`,
          });
          return { action, status: "PASS", durationMs: elapsed() };

        default:
          return {
            action,
            status: "FAIL",
            durationMs: elapsed(),
            error: `Unknown action type: ${action.type}`,
          };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        action: this.redactActionSecrets(action, context.secrets),
        status: "FAIL",
        durationMs: elapsed(),
        error: redactSecrets(errorMsg, context.secrets),
        failureClassification: this.classifyError(errorMsg),
      };
    }
  }

  async cleanup(): Promise<void> {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("MCP server shut down"));
    }
    this.pending.clear();

    if (!this.process) return;
    const proc = this.process;
    this.process = null;

    try {
      proc.stdin?.end();
    } catch {
      // best-effort
    }
    const exited = new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
    });
    proc.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(() => resolve(), 2_000)),
    ]);
    if (!proc.killed) proc.kill("SIGKILL");
  }

  // --- Action helpers ---

  private async navigate(
    action: BrowserAction,
    context: BrowserExecutionContext,
    startTime: number,
  ): Promise<BrowserActionResult> {
    const url = action.url!;
    const policy = evaluateUrlPolicy(url, context.allowedOrigins);
    if (!policy.allowed) {
      return {
        action,
        status: "POLICY_DENIED",
        durationMs: Date.now() - startTime,
        error: `Navigation to denied origin: ${url} — ${policy.reason}`,
      };
    }
    await this.callTool("browser_navigate", { url });
    return this.postActionResult(action, context, startTime);
  }

  private async postActionResult(
    action: BrowserAction,
    context: BrowserExecutionContext,
    startTime: number,
  ): Promise<BrowserActionResult> {
    const currentUrl = await this.currentUrl();
    const policy = evaluateUrlPolicy(currentUrl, context.allowedOrigins);
    if (!policy.allowed) {
      return {
        action,
        status: "POLICY_DENIED",
        durationMs: Date.now() - startTime,
        url: currentUrl,
        error: `Navigation reached denied origin: ${currentUrl}`,
      };
    }
    return {
      action,
      status: "PASS",
      durationMs: Date.now() - startTime,
      url: currentUrl,
    };
  }

  private async assertSnapshotText(
    action: BrowserAction,
    context: BrowserExecutionContext,
    startTime: number,
  ): Promise<BrowserActionResult> {
    const snapshot = await this.callTool("browser_snapshot", {});
    const expected = action.value ?? "";
    const pass =
      typeof snapshot === "string" &&
      snapshot.toLowerCase().includes(expected.toLowerCase());
    return {
      action,
      status: pass ? "PASS" : "FAIL",
      durationMs: Date.now() - startTime,
      expected: redactSecrets(expected, context.secrets),
      actual: pass
        ? redactSecrets(expected, context.secrets)
        : "(text not found in snapshot)",
    };
  }

  private async assertSnapshotVisibility(
    action: BrowserAction,
    _context: BrowserExecutionContext,
    startTime: number,
  ): Promise<BrowserActionResult> {
    const snapshot = await this.callTool("browser_snapshot", {});
    const snapshotText = typeof snapshot === "string" ? snapshot : "";
    // Best-effort visibility check from the accessibility snapshot.
    const selectorText = action.selector?.value ?? "";
    const found =
      selectorText.length > 0 && snapshotText.includes(selectorText);
    const visible = action.type === "ASSERT_VISIBLE" ? found : !found;
    return {
      action,
      status: visible ? "PASS" : "FAIL",
      durationMs: Date.now() - startTime,
      expected: action.type === "ASSERT_VISIBLE" ? "visible" : "hidden",
      actual: found ? "visible" : "not visible",
    };
  }

  private async assertSnapshotValue(
    action: BrowserAction,
    context: BrowserExecutionContext,
    startTime: number,
  ): Promise<BrowserActionResult> {
    const snapshot = await this.callTool("browser_snapshot", {});
    const snapshotText = typeof snapshot === "string" ? snapshot : "";
    const expected = action.value ?? "";
    const isSecret = this.isSecretValue(expected, context.secrets);
    if (isSecret) {
      const pass = snapshotText.includes("[secret]");
      return {
        action: this.redactActionSecrets(action, context.secrets),
        status: pass ? "PASS" : "FAIL",
        durationMs: Date.now() - startTime,
        expected: "[REDACTED]",
        actual: pass
          ? "value matched expected secret"
          : "value did not match expected secret",
      };
    }
    const pass = snapshotText.includes(expected);
    return {
      action,
      status: pass ? "PASS" : "FAIL",
      durationMs: Date.now() - startTime,
      expected: redactSecrets(expected, context.secrets),
      actual: pass
        ? redactSecrets(expected, context.secrets)
        : "(value not found in snapshot)",
    };
  }

  private selectorToRef(
    selector: NonNullable<BrowserAction["selector"]>,
  ): string {
    // The Playwright MCP tools take human-readable element descriptions or
    // refs from a prior snapshot. QE's structured selectors are mapped to
    // the most specific readable form available.
    switch (selector.type) {
      case "role":
        return selector.options?.name
          ? `${selector.value} named "${selector.options.name}"`
          : selector.value;
      case "testId":
        return `data-testid=${selector.value}`;
      default:
        return selector.value;
    }
  }

  private isSecretValue(value: string, secrets: string[]): boolean {
    return secrets.some((s) => s.length > 0 && value.includes(s));
  }

  private redactActionSecrets(
    action: BrowserAction,
    secrets: string[],
  ): BrowserAction {
    if (!action.value || !this.isSecretValue(action.value, secrets)) {
      return action;
    }
    return { ...action, value: "[REDACTED]" };
  }

  private classifyError(errorMsg: string): BrowserFailureClassification {
    const msg = errorMsg.toLowerCase();
    if (msg.includes("timeout") || msg.includes("timed out")) {
      return "TIMEOUT";
    }
    if (
      msg.includes("mcp server exited") ||
      msg.includes("not running") ||
      msg.includes("spawn") ||
      msg.includes("enoent")
    ) {
      return "ENVIRONMENT_ISSUE";
    }
    if (msg.includes("element") || msg.includes("not found")) {
      return "SELECTOR_FAILURE";
    }
    return "UNKNOWN";
  }

  // --- JSON-RPC plumbing ---

  private async ensureServer(): Promise<void> {
    if (this.process && !this.process.killed) return;

    const proc = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    proc.on("error", (err) => {
      this.failAllPending(err);
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.handleChunk(chunk.toString("utf-8"));
    });

    proc.on("exit", () => {
      this.failAllPending(new Error("MCP server exited unexpectedly"));
    });

    this.process = proc;
    this.buffer = "";

    // MCP initialize handshake
    const startupTimeoutMs = this.options.startupTimeoutMs ?? 15_000;
    await this.request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "qe-agent", version: "0.1.0" },
      },
      startupTimeoutMs,
    );

    await this.notify("notifications/initialized");
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        this.handleMessage(msg);
      } catch {
        // ignore malformed lines (server banners, etc.)
      }
    }
  }

  private handleMessage(msg: JsonRpcResponse): void {
    if (msg.id === undefined || msg.id === null) return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);

    if (msg.error) {
      entry.reject(new Error(msg.error.message));
      return;
    }
    entry.resolve(msg.result);
  }

  private failAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("MCP server not running"));
        return;
      }

      const timeout = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`MCP request '${method}' timed out`));
        },
        timeoutMs ?? this.options.callTimeoutMs ?? 30_000,
      );

      this.pending.set(id, { resolve, reject, timer: timeout });
      this.process.stdin.write(JSON.stringify(req) + "\n");
    });
  }

  private async notify(method: string): Promise<void> {
    const msg = { jsonrpc: "2.0", method } as const;
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(JSON.stringify(msg) + "\n");
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as { content?: { type: string; text?: string }[] } | undefined;

    return (result?.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
  }

  private async currentUrl(): Promise<string> {
    const text = await this.callTool("browser_evaluate", {
      function: "() => window.location.href",
    });
    try {
      const parsed = JSON.parse(text) as { result?: string };
      if (typeof parsed?.result === "string") return parsed.result;
    } catch {
      // not JSON — fall through
    }
    return text.trim();
  }
}
