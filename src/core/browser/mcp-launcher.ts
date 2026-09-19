import { spawn, type ChildProcess } from "node:child_process";
import { basename } from "node:path";

/**
 * Controlled-execution boundary for the Playwright MCP server (ADR-012).
 *
 * The MCP server is a long-lived stdio child process, so it cannot flow
 * through the one-shot Execution Controller (`ExecutionController.execute`).
 * Instead it is launched here under the same safety properties:
 *
 * - allowlisted executables only (node / npx / npm);
 * - allowlisted MCP implementation only (pinned `@playwright/mcp` package
 *   or a `.../@playwright/mcp/cli.js` path);
 * - filtered environment (Execution Controller allowlist);
 * - bounded stderr capture;
 * - process-group (detached) spawn with process-tree cleanup helper.
 *
 * Repository-controlled configuration (`browser.mcpCommand` /
 * `browser.mcpArgs` in `.qe/config.yml`) is NEVER honored here — the
 * evaluated repository is untrusted (AGENTS.md "Security"). Only
 * operator-controlled sources (explicit `QE_PLAYWRIGHT_MCP_CLI` env,
 * harness settings / npx cache discovered at runtime, or the pinned
 * network default) may provide an invocation, and every invocation is
 * validated with `validateMcpInvocation` before spawn.
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

const SAFE_ENV_VARS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "HOSTNAME",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "SYSTEMROOT",
  "COMSPEC",
  "WINDIR",
  "PROGRAMFILES",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "XDG_RUNTIME_DIR",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
]);

function filteredEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const key of SAFE_ENV_VARS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) env[k] = v;
  }
  return env as NodeJS.ProcessEnv;
}

export interface ControlledMcpSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  /** Max stderr bytes retained for diagnostics (default 64 KiB). */
  maxStderrBytes?: number;
}

/**
 * Spawn the MCP server after validating the invocation. Returns the
 * child process plus a bounded stderr collector. The child is spawned
 * detached so `killMcpProcessTree` can terminate the whole group.
 */
export function launchControlledMcp(options: ControlledMcpSpawnOptions): {
  proc: ChildProcess;
  stderrTail: () => string;
} {
  validateMcpInvocation(options.command, options.args);
  const proc = spawn(options.command, options.args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: filteredEnv(),
    shell: false,
    detached: true,
  });
  const maxBytes = options.maxStderrBytes ?? 65536;
  const chunks: Buffer[] = [];
  let total = 0;
  proc.stderr?.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
    total += chunk.length;
    while (total > maxBytes && chunks.length > 0) {
      const first = chunks.shift()!;
      total -= first.length;
    }
  });
  return {
    proc,
    stderrTail: () => Buffer.concat(chunks).toString("utf-8"),
  };
}

/** Terminate an MCP process tree: SIGTERM the group, then SIGKILL. */
export async function killMcpProcessTree(
  proc: ChildProcess,
  graceMs = 2000,
): Promise<void> {
  if (!proc.pid) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already dead
    }
    return;
  }
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => {
      proc.once("exit", () => resolve(true));
    }),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), graceMs),
    ),
  ]);
  if (!exited) {
    try {
      if (proc.pid) process.kill(-proc.pid, "SIGKILL");
      else proc.kill("SIGKILL");
    } catch {
      // already dead
    }
  }
}
