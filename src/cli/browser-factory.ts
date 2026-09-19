import type { QEConfig } from "../config/index.js";
import type { BrowserCapability } from "../core/browser/index.js";
import {
  PlaywrightAdapter,
  McpPlaywrightAdapter,
  CompositeBrowserCapability,
} from "../core/browser/index.js";
import { PINNED_MCP_PACKAGE } from "../core/browser/mcp-launcher.js";

/**
 * Pinned Playwright MCP invocation (stdio JSON-RPC) used when no
 * operator-provisioned installation is available. Pinned to an explicit
 * release — never `@latest` (supply-chain pin). Network fetch occurs on
 * first use; see ADR-012 for provisioning.
 */
export const DEFAULT_MCP_COMMAND = "npx";
export const DEFAULT_MCP_ARGS = [PINNED_MCP_PACKAGE, "--headless"];

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
 *
 * Repository-controlled `browser.mcpCommand` / `browser.mcpArgs` are
 * intentionally NOT honored: the evaluated repository is untrusted and
 * must not select an executable. When present they are ignored (with a
 * stderr warning). The MCP server is operator-provisioned and launched
 * through the controlled-execution boundary
 * (`src/core/browser/mcp-launcher.ts`), which enforces the executable
 * and implementation allowlists.
 */
export function createBrowserCapability(
  config: QEConfig,
): BrowserCapability | undefined {
  const adapter = config.browser.adapter ?? "auto";

  const local = new PlaywrightAdapter();

  if (adapter === "local") {
    return local;
  }

  if (config.browser.mcpCommand) {
    // Prohibited: repository-controlled executable selection. Ignore
    // and fall back to the provisioned Playwright MCP.
    process.stderr.write(
      "[qe] warning: browser.mcpCommand in .qe/config.yml is ignored — " +
        "repository config must not select executables (ADR-012). " +
        "Using provisioned Playwright MCP instead.\n",
    );
  }

  const mcp = new McpPlaywrightAdapter({
    command: DEFAULT_MCP_COMMAND,
    args: DEFAULT_MCP_ARGS,
  });

  if (adapter === "mcp") {
    return mcp;
  }

  return new CompositeBrowserCapability(local, mcp);
}
