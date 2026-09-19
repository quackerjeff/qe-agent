import type { CommandProposal } from "./types.js";

/**
 * Shared environment allowlist for all locally spawned processes.
 * Both one-shot execution (LocalExecutor) and managed long-lived
 * processes (managed-process.ts) build their environments from this
 * single source so policy cannot drift between the two.
 */
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

export function buildSafeEnvironment(
  proposal: CommandProposal,
): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};

  for (const key of SAFE_ENV_VARS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  if (proposal.environment) {
    for (const [key, val] of Object.entries(proposal.environment)) {
      env[key] = val;
    }
  }

  return env as NodeJS.ProcessEnv;
}
