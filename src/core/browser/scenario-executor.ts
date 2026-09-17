import type {
  BrowserAction,
  BrowserActionResult,
  BrowserScenario,
  BrowserScenarioResult,
  BrowserExecutionContext,
} from "./types.js";
import { validateBrowserAction } from "./action-validator.js";

/**
 * Shared scenario execution loop for BrowserCapability adapters.
 *
 * Enforces the budget (action count + wall clock), validates each action
 * against the URL policy, and aggregates per-action results into a
 * scenario status. Adapters provide only `executeAction`; this loop is
 * the single owner of orchestration so adapters cannot drift on budget
 * or policy semantics.
 */
export async function executeScenarioActions(
  scenario: BrowserScenario,
  context: BrowserExecutionContext,
  executeAction: (
    action: BrowserAction,
    context: BrowserExecutionContext,
  ) => Promise<BrowserActionResult>,
  onEnvironmentError?: (err: unknown) => void,
): Promise<BrowserScenarioResult> {
  const startTime = Date.now();
  const actionResults: BrowserActionResult[] = [];
  let scenarioStatus: BrowserScenarioResult["status"] = "PASS";
  let actionsExecuted = 0;
  const budgetDeadline = startTime + context.budget.maxBrowserDurationMs;

  try {
    for (const action of scenario.actions) {
      if (actionsExecuted >= context.budget.maxBrowserActions) {
        actionResults.push(skippedResult(action, "Action budget exceeded"));
        continue;
      }

      if (Date.now() >= budgetDeadline) {
        actionResults.push(skippedResult(action, "Duration budget exceeded"));
        continue;
      }

      const validation = validateBrowserAction(action, context.allowedOrigins);
      if (!validation.valid) {
        actionResults.push({
          action,
          status: "POLICY_DENIED",
          durationMs: 0,
          error: validation.reason,
        });
        scenarioStatus = "FAIL";
        continue;
      }

      const result = await executeAction(action, context);
      actionResults.push(result);
      actionsExecuted++;

      if (result.status === "FAIL" || result.status === "POLICY_DENIED") {
        scenarioStatus = "FAIL";
      }
    }
  } catch (err) {
    scenarioStatus = "BLOCKED";
    onEnvironmentError?.(err);
    actionResults.push({
      action: scenario.actions[0] ?? {
        type: "NAVIGATE",
        url: scenario.baseUrl,
      },
      status: "FAIL",
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
      failureClassification: "ENVIRONMENT_ISSUE",
    });
  }

  return {
    scenarioId: scenario.id,
    status: scenarioStatus,
    actionResults,
    durationMs: Date.now() - startTime,
  };
}

function skippedResult(
  action: BrowserAction,
  reason: string,
): BrowserActionResult {
  return {
    action,
    status: "SKIPPED",
    durationMs: 0,
    error: reason,
  };
}
