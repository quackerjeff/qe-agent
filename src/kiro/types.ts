import type { Verdict } from "../types/domain.js";

/**
 * Kiro (Amazon Kiro CLI / IDE) harness integration types.
 *
 * Kiro is an invocation mechanism for the QE Agent, not part of the QE
 * core (see ADR-013). Unlike the GitHub and OpenCode integrations, Kiro
 * has no server API to push results into — delivery targets are the
 * Kiro CLI itself: headless chat sessions (`kiro-cli chat
 * --no-interactive`) and agent hooks (`.kiro/hooks/*.json`). These types
 * describe the Kiro execution context and delivery results.
 */

export interface KiroContext {
  /** Kiro CLI executable (default: kiro-cli). */
  executable: string;
  /** Resume a specific Kiro session by ID instead of starting a new one. */
  sessionId?: string;
  /** Trust tool categories for headless execution (e.g. ["read", "grep"]). */
  trustTools?: string[];
  /** Trust all tools for headless execution. */
  trustAllTools?: boolean;
  /** Agent profile to use (from .kiro/agents/). */
  agent?: string;
  /** Fail when configured MCP servers fail to start (exit code 3). */
  requireMcpStartup?: boolean;
  /** Timeout for the headless Kiro run in milliseconds. */
  timeoutMs?: number;
}

/** Kiro CLI exit codes (https://kiro.dev/docs/reference/exit-codes/). */
export const KIRO_EXIT_SUCCESS = 0;
export const KIRO_EXIT_FAILURE = 1;
export const KIRO_EXIT_MCP_STARTUP_FAILURE = 3;

/** Hook exit code that blocks a PreToolUse tool execution. */
export const KIRO_HOOK_EXIT_BLOCK = 2;

export const VERDICT_TO_KIRO_EXIT: Record<Verdict, number> = {
  PASS: KIRO_EXIT_SUCCESS,
  PASS_WITH_CONCERNS: KIRO_EXIT_SUCCESS,
  NEEDS_REVIEW: KIRO_EXIT_FAILURE,
  FAIL: KIRO_EXIT_FAILURE,
  BLOCKED: KIRO_EXIT_FAILURE,
};

export interface KiroPromptRequest {
  /** The prompt text to send to the Kiro CLI headless chat. */
  prompt: string;
  context: KiroContext;
}

export interface KiroPromptResponse {
  /** Stdout produced by the Kiro CLI run. */
  stdout: string;
  /** Stderr produced by the Kiro CLI run (warnings, banners). */
  stderr: string;
  /** Process exit code (see KIRO_EXIT_* constants). */
  exitCode: number;
  /** Whether the run completed within its exit-code semantics (0 or 3). */
  ok: boolean;
}

export interface KiroPublishingResult {
  promptDelivered: boolean;
  exitCode?: number;
  sessionId?: string;
  warnings: string[];
  dryRun: boolean;
}
