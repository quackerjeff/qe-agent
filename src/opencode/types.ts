import { z } from "zod";
import type { Verdict } from "../types/domain.js";

/**
 * OpenCode harness integration types.
 *
 * OpenCode is an invocation mechanism for the QE Agent, not part of the
 * QE core (see ADR-011). These types describe the OpenCode execution
 * context and the result of publishing a QE verdict back into an
 * OpenCode session.
 */

export const OpenCodeContextSchema = z.object({
  /** Base URL of a running OpenCode server (e.g. http://127.0.0.1:4096). */
  serverUrl: z.string().url().default("http://127.0.0.1:4096"),
  /** OpenCode session ID to deliver the QE summary into. */
  sessionId: z.string().min(1),
  /** Optional username for HTTP basic auth (OPENCODE_SERVER_USERNAME). */
  username: z.string().optional(),
  /** Optional password for HTTP basic auth (OPENCODE_SERVER_PASSWORD). */
  password: z.string().optional(),
  /** Optional session title used when creating a new session. */
  sessionTitle: z.string().optional(),
});

export type OpenCodeContext = z.infer<typeof OpenCodeContextSchema>;

/**
 * How a QE verdict is reported into an OpenCode session.
 * Text delivery is deterministic; the verdict wording is fixed.
 */
export type OpenCodeMessageUrgency = "normal" | "warning" | "error";

export const VERDICT_TO_URGENCY: Record<Verdict, OpenCodeMessageUrgency> = {
  PASS: "normal",
  PASS_WITH_CONCERNS: "warning",
  NEEDS_REVIEW: "warning",
  FAIL: "error",
  BLOCKED: "error",
};

export interface MessageSendRequest {
  sessionId: string;
  text: string;
}

export interface MessageSendResponse {
  messageId: string;
  delivered: boolean;
}

export interface OpenCodePublishingResult {
  messageDelivered: boolean;
  messageId?: string;
  sessionId: string;
  warnings: string[];
  dryRun: boolean;
}
