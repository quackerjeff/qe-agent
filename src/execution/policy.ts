import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import type { CommandProposal, PolicyResult } from "./types.js";

const DANGEROUS_EXECUTABLES = new Set([
  "rm",
  "rmdir",
  "mkfs",
  "fdisk",
  "dd",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "useradd",
  "userdel",
  "usermod",
  "passwd",
  "chown",
  "chmod",
  "mount",
  "umount",
  "systemctl",
  "init",
  "kill",
  "killall",
  "pkill",
]);

const DANGEROUS_GIT_SUBCOMMANDS = new Set([
  "push",
  "reset",
  "clean",
  "checkout",
]);

const MAX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function evaluatePolicy(
  proposal: CommandProposal,
  repositoryRoot: string,
): PolicyResult {
  if (!proposal.executable || proposal.executable.trim().length === 0) {
    return { outcome: "DENIED", reason: "Empty executable" };
  }

  const execBasename = proposal.executable.split("/").pop() ?? "";

  if (DANGEROUS_EXECUTABLES.has(execBasename)) {
    return {
      outcome: "DENIED",
      reason: `Executable '${execBasename}' is on the dangerous command list`,
    };
  }

  if (
    execBasename === "git" &&
    proposal.args.length > 0 &&
    DANGEROUS_GIT_SUBCOMMANDS.has(proposal.args[0])
  ) {
    return {
      outcome: "DENIED",
      reason: `Destructive git operation '${proposal.args[0]}' is denied`,
    };
  }

  const wdResult = validateWorkingDirectory(
    proposal.workingDirectory,
    repositoryRoot,
  );
  if (wdResult) return wdResult;

  if (proposal.timeoutMs > MAX_TIMEOUT_MS) {
    return {
      outcome: "DENIED",
      reason: `Timeout ${proposal.timeoutMs}ms exceeds maximum ${MAX_TIMEOUT_MS}ms`,
    };
  }

  if (proposal.timeoutMs <= 0) {
    return { outcome: "DENIED", reason: "Timeout must be positive" };
  }

  if (
    proposal.mutability === "REPOSITORY_WRITE" &&
    proposal.network === "ALLOWED"
  ) {
    return {
      outcome: "REQUIRES_APPROVAL",
      reason: "Repository write with network access requires approval",
    };
  }

  return { outcome: "ALLOWED", reason: "Policy check passed" };
}

function validateWorkingDirectory(
  workingDir: string,
  repositoryRoot: string,
): PolicyResult | undefined {
  const resolvedWd = resolve(workingDir);
  let realRoot: string;
  try {
    realRoot = realpathSync(repositoryRoot);
  } catch {
    return {
      outcome: "DENIED",
      reason: `Repository root '${repositoryRoot}' does not exist`,
    };
  }

  let realWd: string;
  try {
    realWd = realpathSync(resolvedWd);
  } catch {
    return {
      outcome: "DENIED",
      reason: `Working directory '${resolvedWd}' does not exist`,
    };
  }

  if (!realWd.startsWith(realRoot + "/") && realWd !== realRoot) {
    return {
      outcome: "DENIED",
      reason: `Working directory '${resolvedWd}' is outside repository root '${realRoot}'`,
    };
  }

  return undefined;
}
