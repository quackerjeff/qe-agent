import type { QEConfig } from "../config/index.js";
import type { BrowserCapability } from "../core/browser/index.js";
import {
  PlaywrightAdapter,
  McpPlaywrightAdapter,
  CompositeBrowserCapability,
} from "../core/browser/index.js";

/**
 * Default Playwright MCP server invocation (stdio JSON-RPC).
 * Matches how OpenCode and other harnesses launch Playwright MCP.
 */
export const DEFAULT_MCP_COMMAND = "npx";
export const DEFAULT_MCP_ARGS = ["@playwright/mcp@latest", "--headless"];

/**
 * Build the browser capability from QE configuration.
 *
 * - "local": local Playwright/Chromium only (no fallback);
 * - "mcp": Playwright MCP server only (no local browser);
 * - "auto" (default): local-first with automatic MCP fallback when the
 *   local browser cannot be launched.
 *
 * The orchestrator never spawns an MCP server unless the browser
 * capability is actually used; construction here is lazy and
 * `available()` is only probed at execution time.
 */
export function createBrowserCapability(
  config: QEConfig,
): BrowserCapability | undefined {
  const adapter = config.browser.adapter ?? "auto";

  const local = new PlaywrightAdapter();

  if (adapter === "local") {
    return local;
  }

  const mcp = new McpPlaywrightAdapter({
    command: config.browser.mcpCommand ?? DEFAULT_MCP_COMMAND,
    args: config.browser.mcpArgs ?? DEFAULT_MCP_ARGS,
  });

  if (adapter === "mcp") {
    return mcp;
  }

  return new CompositeBrowserCapability(local, mcp);
}
