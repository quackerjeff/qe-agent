import { BrowserActionSchema, type BrowserAction } from "./types.js";
import { evaluateUrlPolicy } from "./url-policy.js";

export interface ActionValidationResult {
  valid: boolean;
  reason: string;
}

export function validateBrowserAction(
  action: unknown,
  allowedOrigins: string[],
): ActionValidationResult {
  const parsed = BrowserActionSchema.safeParse(action);
  if (!parsed.success) {
    return {
      valid: false,
      reason: `Invalid action schema: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    };
  }

  const act = parsed.data;

  if (act.type === "NAVIGATE") {
    if (!act.url) {
      return { valid: false, reason: "NAVIGATE action requires url" };
    }
    const policy = evaluateUrlPolicy(act.url, allowedOrigins);
    if (!policy.allowed) {
      return { valid: false, reason: `URL policy: ${policy.reason}` };
    }
  }

  const needsSelector = [
    "CLICK",
    "FILL",
    "SELECT",
    "CHECK",
    "UNCHECK",
    "ASSERT_TEXT",
    "ASSERT_VISIBLE",
    "ASSERT_HIDDEN",
    "ASSERT_VALUE",
  ];
  if (needsSelector.includes(act.type) && !act.selector) {
    return {
      valid: false,
      reason: `${act.type} action requires a selector`,
    };
  }

  if (act.type === "FILL" && (act.value === undefined || act.value === null)) {
    return { valid: false, reason: "FILL action requires a value" };
  }

  if (act.type === "PRESS" && !act.key) {
    return { valid: false, reason: "PRESS action requires a key" };
  }

  if (act.type === "SELECT" && !act.value) {
    return { valid: false, reason: "SELECT action requires a value" };
  }

  return { valid: true, reason: "Action validated" };
}

export function validateBrowserActions(
  actions: unknown[],
  allowedOrigins: string[],
): { valid: BrowserAction[]; rejected: { index: number; reason: string }[] } {
  const valid: BrowserAction[] = [];
  const rejected: { index: number; reason: string }[] = [];

  for (let i = 0; i < actions.length; i++) {
    const result = validateBrowserAction(actions[i], allowedOrigins);
    if (result.valid) {
      valid.push(BrowserActionSchema.parse(actions[i]));
    } else {
      rejected.push({ index: i, reason: result.reason });
    }
  }

  return { valid, rejected };
}
