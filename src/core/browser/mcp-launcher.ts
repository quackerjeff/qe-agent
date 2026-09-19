import { basename } from "node:path";
import {
  ExecutionController,
  type ManagedProcessHandle,
} from "../../execution/index.js";

/**
 * Controlled-execution boundary for the Playwright MCP server (ADR-012).
 *
 * The MCP server is a long-lived stdio child process. It is spawned
 * through the canonical Execution Controller
 * (`ExecutionController.spawnManaged`), which enforces the same command
 * policy, filtered environment, bounded output, evidence capture, and
 * process-group lifecycle as one-shot execution — implemented once in
 * `src/execution/managed-process.ts` beneath both paths so policy
 * cannot drift.
 *
 * On top of the controller, this module adds the MCP-specific
 * provisioning policy: an executable allowlist (node/npx only) and an
 * implementation allowlist (the provisioned `@playwright/mcp` CLI or
 * the pinned npx package). Repository-controlled configuration
 * (`browser.mcpCommand` / `browser.mcpArgs` in `.qe/config.yml`) is
 * NEVER honored here — the evaluated repository is untrusted
 * (AGENTS.md "Security"). Only operator-controlled sources (explicit
 * `QE_PLAYWRIGHT_MCP_CLI` env, harness settings / npx cache discovered
 * at runtime, or the pinned network default) may provide an
 * invocation, and every invocation is validated with
 * `validateMcpInvocation` before reaching the controller.
 */

/** Pinned @playwright/mcp release. No `latest` tag — supply-chain pin. */
export const PINNED_PLAYWRIGHT_MCP_VERSION = "0.4.1";

/** Pinned npx invocation used only when nothing is installed locally. */
export const PINNED_MCP_PACKAGE = `@playwright/mcp@${PINNED_PLAYWRIGHT_MCP_VERSION}`;

/** Executable basenames permitted to launch the MCP server. */
const ALLOWED_EXECUTABLES = new Set(["node", "npx", "npm"]);

/** Extra CLI flags permitted after the MCP implementation argument. */
const ALLOWED_EXTRA_ARGS = new Set(["--headless", "--isolated"]);

const MCP_CLI_SUFFIX = "@playwright/mcp/cli.js";

function executableAllowed(command: string): boolean {
  const base = basename(command).toLowerCase();
  // Allow the current Node binary by absolute path as well.
  if (command === process.execPath) return true;
  return ALLOWED_EXECUTABLES.has(base);
}

function isMcpCliPath(arg: string): boolean {
  return (
    arg.endsWith(MCP_CLI_SUFFIX) ||
    arg.includes("@playwright/mcp") ||
    arg.includes("@playwright\\mcp")
  );
}

function isPinnedPackageArg(arg: string): boolean {
  return arg === PINNED_MCP_PACKAGE;
}

/**
 * Validate an MCP server invocation. Throws on violation.
 * Accepts exactly:
 * - `node <.../@playwright/mcp/cli.js> [--headless|--isolated]*`, or
 * - `npx @playwright/mcp@<pinned> [--headless|--isolated]*`
 *   (`npm exec` form with the same args is also accepted).
 */
export function validateMcpInvocation(command: string, args: string[]): void {
  if (!executableAllowed(command)) {
    throw new Error(
      `MCP executable denied: '${command}' is not an approved launcher (node/npx)`,
    );
  }
  if (args.length === 0) {
    throw new Error("MCP invocation denied: empty argument list");
  }
  const [impl, ...rest] = args;
  const base = basename(command).toLowerCase();
  if (base === "npx" || base === "npm" || command === "npx") {
    if (!isPinnedPackageArg(impl)) {
      throw new Error(
        `MCP package denied: '${impl}' — only '${PINNED_MCP_PACKAGE}' via npx is approved`,
      );
    }
  } else {
    // node <cli.js>
    if (!isMcpCliPath(impl)) {
      throw new Error(
        `MCP implementation denied: '${impl}' is not the provisioned @playwright/mcp CLI`,
      );
    }
  }
  for (const a of rest) {
    if (!ALLOWED_EXTRA_ARGS.has(a)) {
      throw new Error(`MCP argument denied: '${a}' is not approved`);
    }
  }
}

export interface ControlledMcpSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  /** Canonical Execution Controller — the MCP server flows through it. */
  controller: ExecutionController;
  /** Repository root the execution policy confines the server to. */
  repositoryRoot: string;
  secrets?: string[];
  /** Startup/handshake budget, carried as the proposal timeout. */
  startupTimeoutMs?: number;
  /** Max stderr bytes retained for diagnostics (default 64 KiB). */
  maxStderrBytes?: number;
}

/**
 * Validate the invocation, then spawn the MCP server via the
 * Execution Controller's managed-process capability. The working
 * directory defaults to the repository root so command policy (which
 * confines execution inside the root) is satisfied; an explicit cwd
 * outside the root fails closed at the controller boundary.
 */
export async function launchControlledMcp(
  options: ControlledMcpSpawnOptions,
): Promise<ManagedProcessHandle> {
  validateMcpInvocation(options.command, options.args);
  return options.controller.spawnManaged(
    {
      executable: options.command,
      args: options.args,
      workingDirectory: options.cwd ?? options.repositoryRoot,
      timeoutMs: options.startupTimeoutMs ?? 15_000,
      purpose: "Playwright MCP browser server (ADR-012)",
      mutability: "TEST_ARTIFACTS",
      network: "ALLOWED",
    },
    {
      repositoryRoot: options.repositoryRoot,
      executionMode: "local",
      secrets: options.secrets ?? [],
      maxOutputBytes: 1_048_576,
    },
  );
}
