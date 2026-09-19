import { type ChildProcess } from "node:child_process";
import { mkdirSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
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
import { launchControlledMcp, validateMcpInvocation } from "./mcp-launcher.js";
import {
  ExecutionController,
  type ManagedProcessHandle,
} from "../../execution/index.js";

/**
 * Extract the first JSON value embedded in tool output that wraps results
 * in prose/code fences (e.g. `### Result\n"http://..."`). Handles objects,
 * arrays, and bare quoted strings.
 */
function extractFirstJsonValue(text: string): unknown {
  const candidates: string[] = [];

  // Bare quoted string (JSON string value).
  const strMatch = text.match(/"(?:[^"\\]|\\.)*"/);
  if (strMatch) candidates.push(strMatch[0]);

  // First balanced object or array.
  const start = text.search(/[{[]/);
  if (start >= 0) {
    const open = text[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

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
  /**
   * Canonical Execution Controller the server is spawned through.
   * Defaults to a dedicated controller instance; every spawn flows
   * through `ExecutionController.spawnManaged` either way.
   */
  controller?: ExecutionController;
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
  private handle: ManagedProcessHandle | null = null;
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
  private readonly controller: ExecutionController;
  private screenshotCount = 0;

  constructor(options: McpPlaywrightOptions) {
    // Controlled-execution boundary: reject non-provisioned invocations
    // at construction time so no unapproved executable can be spawned.
    validateMcpInvocation(options.command, options.args);
    this.options = options;
    this.controller = options.controller ?? new ExecutionController();
  }

  /**
   * Build a confined screenshot path beneath the QE artifact directory.
   * The model-controlled `description` is sanitized to a basename
   * fragment only — traversal segments, absolute paths, and special
   * characters can never escape the artifact boundary. Returns null
   * when the resolved path would leave the repository root.
   */
  static buildScreenshotPath(
    description: string | undefined,
    context: BrowserExecutionContext,
    index: number,
  ): string | null {
    const fragment = (description ?? "screenshot")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const safeFragment = fragment.length > 0 ? fragment : "screenshot";
    const repoRoot = resolve(context.repositoryRoot);
    const artifactBase = resolve(repoRoot, context.artifactDir);
    const dir = join(artifactBase, "browser", "screenshots");
    const filePath = join(dir, `${safeFragment}-${index}.png`);
    const resolvedPath = resolve(filePath);
    if (resolvedPath !== repoRoot && !resolvedPath.startsWith(repoRoot + "/")) {
      return null;
    }
    if (resolve(dir) !== repoRoot && !resolve(dir).startsWith(repoRoot + "/")) {
      return null;
    }
    return resolvedPath;
  }

  /** Ensure the screenshot directory exists within the boundary. */
  private ensureScreenshotDir(context: BrowserExecutionContext): boolean {
    try {
      const repoRoot = resolve(context.repositoryRoot);
      const dir = join(
        resolve(repoRoot, context.artifactDir),
        "browser",
        "screenshots",
      );
      if (
        resolve(dir) !== repoRoot &&
        !resolve(dir).startsWith(repoRoot + "/")
      ) {
        return false;
      }
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const realDir = realpathSync(dir);
      if (realDir !== repoRoot && !realDir.startsWith(repoRoot + "/")) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
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
    await this.ensureServer(context);
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
      await this.ensureServer(context);

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
          return await this.postActionResult(
            this.redactActionSecrets(action, context.secrets),
            context,
            startTime,
          );

        case "SELECT":
          await this.callTool("browser_select_option", {
            element: action.description ?? "select target",
            ref: this.selectorToRef(action.selector!),
            values: [action.value ?? ""],
          });
          return await this.postActionResult(action, context, startTime);

        case "CHECK":
        case "UNCHECK":
          await this.callTool(
            action.type === "CHECK" ? "browser_check" : "browser_uncheck",
            {
              element: action.description ?? "checkbox",
              ref: this.selectorToRef(action.selector!),
            },
          );
          return await this.postActionResult(action, context, startTime);

        case "PRESS":
          await this.callTool("browser_press_key", { key: action.key! });
          return await this.postActionResult(action, context, startTime);

        case "ASSERT_TEXT": {
          const preCheck = await this.verifyCurrentUrlPolicy(
            action,
            context,
            startTime,
          );
          if (preCheck) return preCheck;
          return await this.assertSnapshotText(action, context, startTime);
        }

        case "ASSERT_VISIBLE":
        case "ASSERT_HIDDEN": {
          const preCheck = await this.verifyCurrentUrlPolicy(
            action,
            context,
            startTime,
          );
          if (preCheck) return preCheck;
          return await this.assertSnapshotVisibility(
            action,
            context,
            startTime,
          );
        }

        case "ASSERT_URL": {
          let currentUrl: string;
          try {
            currentUrl = await this.currentUrl();
          } catch {
            return {
              action,
              status: "FAIL",
              durationMs: elapsed(),
              error: "Could not establish current origin before URL assertion",
              failureClassification: "ENVIRONMENT_ISSUE",
            };
          }
          const policy = evaluateUrlPolicy(currentUrl, context.allowedOrigins);
          if (!policy.allowed) {
            return {
              action,
              status: "POLICY_DENIED",
              durationMs: elapsed(),
              url: currentUrl,
              error: `Current origin denied before read: ${currentUrl}`,
            };
          }
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

        case "ASSERT_VALUE": {
          const preCheck = await this.verifyCurrentUrlPolicy(
            action,
            context,
            startTime,
          );
          if (preCheck) return preCheck;
          return await this.assertSnapshotValue(action, context, startTime);
        }

        case "SCREENSHOT": {
          const preCheck = await this.verifyCurrentUrlPolicy(
            action,
            context,
            startTime,
          );
          if (preCheck) return preCheck;
          const confined = McpPlaywrightAdapter.buildScreenshotPath(
            action.description,
            context,
            this.screenshotCount,
          );
          if (!confined || !this.ensureScreenshotDir(context)) {
            return {
              action,
              status: "FAIL",
              durationMs: elapsed(),
              error: "Artifact path outside repository boundary",
            };
          }
          // Pass only the confined absolute path; the model-controlled
          // description never reaches the MCP server as a path.
          await this.callTool("browser_take_screenshot", {
            filename: confined,
          });
          this.screenshotCount++;
          return {
            action,
            status: "PASS",
            durationMs: elapsed(),
            url: await this.currentUrl().catch(() => undefined),
            screenshotPath: confined,
          };
        }

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
    const handle = this.handle;
    this.process = null;
    this.handle = null;

    try {
      proc.stdin?.end();
    } catch {
      // best-effort
    }
    // Process-tree cleanup through the controller-owned handle.
    await Promise.race([
      (async () => {
        await handle?.killTree();
      })(),
      new Promise<void>((resolve) => setTimeout(() => resolve(), 4_000)),
    ]);
    try {
      if (!proc.killed) proc.kill("SIGKILL");
    } catch {
      // already dead
    }
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

  /**
   * Verify the current origin before reading or capturing browser state.
   * Returns a POLICY_DENIED result when the page has left the allowed
   * origins — or when the current URL cannot be established at all
   * (fail closed: an unknown origin is never treated as allowed) —
   * or null when it is safe to proceed.
   */
  private async verifyCurrentUrlPolicy(
    action: BrowserAction,
    context: BrowserExecutionContext,
    startTime: number,
  ): Promise<BrowserActionResult | null> {
    let currentUrl: string;
    try {
      currentUrl = await this.currentUrl();
    } catch {
      return {
        action,
        status: "POLICY_DENIED",
        durationMs: Date.now() - startTime,
        error:
          "Could not establish current origin before read — denying capture",
      };
    }
    const policy = evaluateUrlPolicy(currentUrl, context.allowedOrigins);
    if (!policy.allowed) {
      return {
        action,
        status: "POLICY_DENIED",
        durationMs: Date.now() - startTime,
        url: currentUrl,
        error: `Current origin denied before read: ${currentUrl}`,
      };
    }
    return null;
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

  private async ensureServer(context?: BrowserExecutionContext): Promise<void> {
    if (this.process && !this.process.killed) return;

    // Canonical execution boundary: the MCP server is spawned through
    // the Execution Controller's managed-process capability (policy,
    // filtered environment, bounded output, evidence, process-group
    // lifecycle). The repository root confines command policy; without
    // a browser context the server's own directory is the root.
    const repositoryRoot =
      context?.repositoryRoot ?? this.options.cwd ?? process.cwd();
    const handle = await launchControlledMcp({
      command: this.options.command,
      args: this.options.args,
      cwd: this.options.cwd,
      controller: this.controller,
      repositoryRoot,
      secrets: context?.secrets,
      startupTimeoutMs: this.options.startupTimeoutMs,
    });
    const proc = handle.proc;

    proc.on("error", (err) => {
      this.failAllPending(err);
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.handleChunk(chunk.toString("utf-8"));
    });

    proc.on("exit", () => {
      this.failAllPending(new Error("MCP server exited unexpectedly"));
    });

    this.handle = handle;
    this.process = proc;
    this.buffer = "";

    // MCP initialize handshake
    const startupTimeoutMs = this.options.startupTimeoutMs ?? 15_000;
    try {
      await this.request(
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "qe-agent", version: "0.1.0" },
        },
        startupTimeoutMs,
      );
    } catch (err) {
      await this.cleanup();
      throw err;
    }

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
    // MCP evaluate returns a formatted block wrapping the JSON result
    // (### Result fences + code blocks). Extract the first JSON value —
    // an object, array, or bare quoted string — from the wrapper.
    const extracted = extractFirstJsonValue(text);
    if (extracted !== undefined) {
      if (typeof extracted === "string") return extracted;
      if (
        extracted !== null &&
        typeof extracted === "object" &&
        "result" in extracted
      ) {
        const inner = (extracted as { result: unknown }).result;
        return typeof inner === "string" ? inner : String(inner);
      }
    }
    return text.trim();
  }
}
