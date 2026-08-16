import { z } from "zod";

export const QELifecycleState = z.enum([
  "INITIALIZING",
  "DISCOVERING",
  "UNDERSTANDING_CHANGE",
  "ASSESSING_RISK",
  "PLANNING",
  "EXECUTING",
  "INVESTIGATING",
  "GENERATING_TESTS",
  "RETESTING",
  "ANALYZING_GAPS",
  "FORMING_VERDICT",
  "REPORTING",
  "COMPLETE",
  "BLOCKED",
]);

export type QELifecycleState = z.infer<typeof QELifecycleState>;

export const TERMINAL_STATES: ReadonlySet<QELifecycleState> = new Set([
  "COMPLETE",
  "BLOCKED",
]);

export interface StateTransition {
  from: QELifecycleState;
  to: QELifecycleState;
  timestamp: string;
  reason?: string;
}
