import type { QELifecycleState, StateTransition } from "./states.js";
import { TERMINAL_STATES } from "./states.js";

const VALID_TRANSITIONS: ReadonlyMap<
  QELifecycleState,
  readonly QELifecycleState[]
> = new Map([
  ["INITIALIZING", ["DISCOVERING", "BLOCKED"]],
  ["DISCOVERING", ["UNDERSTANDING_CHANGE", "ASSESSING_RISK", "BLOCKED"]],
  ["UNDERSTANDING_CHANGE", ["ASSESSING_RISK", "BLOCKED"]],
  ["ASSESSING_RISK", ["PLANNING", "BLOCKED"]],
  ["PLANNING", ["EXECUTING", "BLOCKED"]],
  ["EXECUTING", ["INVESTIGATING", "ANALYZING_GAPS", "BLOCKED"]],
  ["INVESTIGATING", ["EXECUTING", "ANALYZING_GAPS", "BLOCKED"]],
  ["GENERATING_TESTS", ["RETESTING", "ANALYZING_GAPS", "BLOCKED"]],
  ["RETESTING", ["INVESTIGATING", "ANALYZING_GAPS", "BLOCKED"]],
  ["ANALYZING_GAPS", ["GENERATING_TESTS", "FORMING_VERDICT", "BLOCKED"]],
  ["FORMING_VERDICT", ["REPORTING", "BLOCKED"]],
  ["REPORTING", ["COMPLETE", "BLOCKED"]],
  ["COMPLETE", []],
  ["BLOCKED", []],
]);

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: QELifecycleState,
    public readonly to: QELifecycleState,
  ) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class QEStateMachine {
  private current: QELifecycleState = "INITIALIZING";
  private readonly transitions: StateTransition[] = [];

  get state(): QELifecycleState {
    return this.current;
  }

  get history(): readonly StateTransition[] {
    return this.transitions;
  }

  get isTerminal(): boolean {
    return TERMINAL_STATES.has(this.current);
  }

  transition(to: QELifecycleState, reason?: string): void {
    const allowed = VALID_TRANSITIONS.get(this.current);
    if (!allowed || !allowed.includes(to)) {
      throw new InvalidTransitionError(this.current, to);
    }

    const record: StateTransition = {
      from: this.current,
      to,
      timestamp: new Date().toISOString(),
      reason,
    };

    this.transitions.push(record);
    this.current = to;
  }

  canTransitionTo(to: QELifecycleState): boolean {
    const allowed = VALID_TRANSITIONS.get(this.current);
    return allowed !== undefined && allowed.includes(to);
  }
}
