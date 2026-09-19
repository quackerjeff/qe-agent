import { access, constants, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { QEConfig } from "../config/index.js";
import type { BrowserCapability } from "../core/browser/index.js";
import {
  PlaywrightAdapter,
  McpPlaywrightAdapter,
  CompositeBrowserCapability,
} from "../core/browser/index.js";
import {
  PINNED_MCP_PACKAGE,
  validateMcpInvocation,
} from "../core/browser/mcp-launcher.js";

/**
 * Pinned Playwright MCP invocation (stdio JSON-RPC) used only when no
 * local installation is detected and no operator override is set.
 * Pinned to an explicit release — never `@latest` (supply-chain pin).
 * Network fetch occurs on first use; see ADR-012 for provisioning.
 */
export const DEFAULT_MCP_COMMAND = "npx";
export const DEFAULT_MCP_ARGS = [PINNED_MCP_PACKAGE, "--headless"];

/**
 * Home directory for runtime discovery. Honors an explicit override
 * (used by tests) before falling back to the real home directory.
 */
function discoveryHome(): string {
  return process.env.QE_DISCOVERY_HOME ?? process.env.HOME ?? homedir();
}

/**
 * Discover the Playwright MCP server invocation, with no hardcoded
 * machine-specific locations. Resolution order:
 *
 * 1. QE_PLAYWRIGHT_MCP_CLI env var — explicit operator-controlled path
 *    to the @playwright/mcp cli.js (highest precedence; never from
 *    repository configuration);
 * 2. any @playwright/mcp CLI in the npm npx cache;
 * 3. null → the pinned npx default (network fetch on first use).
 *
 * Every candidate is re-validated against the controlled-execution
 * allowlist before use. Returns null when nothing is installed locally.
 */
export async function detectInstalledPlaywrightMcp(): Promise<{
  command: string;
  args: string[];
} | null> {
  // 1. Explicit operator override.
  const envCli = process.env.QE_PLAYWRIGHT_MCP_CLI;
  if (envCli) {
    try {
      await access(envCli, constants.R_OK);
      const candidate = { command: process.execPath, args: [envCli] };
      try {
        validateMcpInvocation(candidate.command, candidate.args);
        return {
          command: candidate.command,
          args: [...candidate.args, "--headless"],
        };
      } catch {
        // not the provisioned CLI — fall through to discovery
      }
    } catch {
      // configured but not readable — fall through to discovery
    }
  }

  // 2. npm npx cache.
  try {
    const npxCache = join(discoveryHome(), ".npm", "_npx");
    for (const entry of await readdir(npxCache, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cli = join(
        npxCache,
        entry.name,
        "node_modules",
        "@playwright",
        "mcp",
        "cli.js",
      );
      try {
        await access(cli, constants.R_OK);
        return { command: process.execPath, args: [cli, "--headless"] };
      } catch {
        // not in this cache entry — continue
      }
    }
  } catch {
    // no npx cache — fall through
  }

  return null;
}

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
 * stderr warning). The MCP invocation is operator-provisioned
 * (`QE_PLAYWRIGHT_MCP_CLI` override → npx-cache discovery → pinned npx
 * default) and launched through the Execution Controller's
 * managed-process capability, which enforces the executable and
 * implementation allowlists.
 */
export async function createBrowserCapability(
  config: QEConfig,
): Promise<BrowserCapability | undefined> {
  const adapter = config.browser.adapter ?? "auto";

  const local = new PlaywrightAdapter();

  if (adapter === "local") {
    return local;
  }

  if (config.browser.mcpCommand) {
    // Prohibited: repository-controlled executable selection. Ignore
    // and fall back to operator-controlled provisioning.
    process.stderr.write(
      "[qe] warning: browser.mcpCommand in .qe/config.yml is ignored — " +
        "repository config must not select executables (ADR-012). " +
        "Using provisioned Playwright MCP instead.\n",
    );
  }

  const installed = await detectInstalledPlaywrightMcp();
  const mcp = new McpPlaywrightAdapter({
    command: installed?.command ?? DEFAULT_MCP_COMMAND,
    args: installed?.args ?? DEFAULT_MCP_ARGS,
  });

  if (adapter === "mcp") {
    return mcp;
  }

  return new CompositeBrowserCapability(local, mcp);
}
