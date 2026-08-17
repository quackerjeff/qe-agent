import type {
  BrowserActionResult,
  BrowserScenarioResult,
  BrowserFailureClassification,
} from "./types.js";

export interface BrowserFailureInvestigation {
  classification: BrowserFailureClassification;
  explanation: string;
  isProductDefect: boolean;
  suggestBaselineComparison: boolean;
  suggestRetry: boolean;
}

export function investigateBrowserFailure(
  scenarioResult: BrowserScenarioResult,
  failedAction: BrowserActionResult,
  previousActions: BrowserActionResult[],
): BrowserFailureInvestigation {
  const actionClassification =
    failedAction.failureClassification ??
    classifyFromContext(failedAction, previousActions, scenarioResult);

  return {
    classification: actionClassification,
    explanation: buildExplanation(
      actionClassification,
      failedAction,
      previousActions,
      scenarioResult,
    ),
    isProductDefect: actionClassification === "PRODUCT_DEFECT",
    suggestBaselineComparison:
      actionClassification === "PRODUCT_DEFECT" ||
      actionClassification === "UNKNOWN",
    suggestRetry:
      actionClassification === "TIMEOUT" ||
      actionClassification === "NETWORK_FAILURE" ||
      actionClassification === "APPLICATION_NOT_READY",
  };
}

function classifyFromContext(
  failedAction: BrowserActionResult,
  previousActions: BrowserActionResult[],
  scenarioResult: BrowserScenarioResult,
): BrowserFailureClassification {
  const errorMsg = (failedAction.error ?? "").toLowerCase();
  const actionType = failedAction.action.type;

  if (failedAction.status === "POLICY_DENIED") {
    return "TEST_DEFECT";
  }

  const allPreviousFailed =
    previousActions.length > 0 &&
    previousActions.every((a) => a.status === "FAIL");
  if (allPreviousFailed && previousActions.length > 0) {
    return "APPLICATION_NOT_READY";
  }

  if (errorMsg.includes("timeout") || errorMsg.includes("exceeded")) {
    if (actionType === "NAVIGATE") {
      return "APPLICATION_NOT_READY";
    }
    return "TIMEOUT";
  }

  if (
    errorMsg.includes("econnrefused") ||
    errorMsg.includes("net::err_connection_refused") ||
    errorMsg.includes("net::err_name_not_resolved")
  ) {
    return "NETWORK_FAILURE";
  }

  if (isAssertionAction(actionType)) {
    const hasPageErrors = (scenarioResult.pageErrors?.length ?? 0) > 0;
    const hasNetworkFailures = (scenarioResult.failedRequests?.length ?? 0) > 0;

    if (hasPageErrors || hasNetworkFailures) {
      return "PRODUCT_DEFECT";
    }

    const previousAllPassed = previousActions.every(
      (a) => a.status === "PASS" || a.status === "SKIPPED",
    );
    if (previousAllPassed && previousActions.length > 0) {
      return "PRODUCT_DEFECT";
    }

    return "PRODUCT_DEFECT";
  }

  if (isSelectorAction(actionType)) {
    if (
      errorMsg.includes("not found") ||
      errorMsg.includes("no element") ||
      errorMsg.includes("strict mode") ||
      errorMsg.includes("waiting for selector") ||
      errorMsg.includes("locator resolved to")
    ) {
      return "SELECTOR_FAILURE";
    }
  }

  if (
    errorMsg.includes("401") ||
    errorMsg.includes("403") ||
    errorMsg.includes("unauthorized") ||
    errorMsg.includes("forbidden")
  ) {
    return "AUTHENTICATION_FAILURE";
  }

  return "UNKNOWN";
}

function isAssertionAction(type: string): boolean {
  return [
    "ASSERT_TEXT",
    "ASSERT_VISIBLE",
    "ASSERT_HIDDEN",
    "ASSERT_URL",
    "ASSERT_VALUE",
  ].includes(type);
}

function isSelectorAction(type: string): boolean {
  return [
    "CLICK",
    "FILL",
    "SELECT",
    "CHECK",
    "UNCHECK",
    "ASSERT_TEXT",
    "ASSERT_VISIBLE",
    "ASSERT_HIDDEN",
    "ASSERT_VALUE",
  ].includes(type);
}

function buildExplanation(
  classification: BrowserFailureClassification,
  failedAction: BrowserActionResult,
  previousActions: BrowserActionResult[],
  scenarioResult: BrowserScenarioResult,
): string {
  const actionDesc = `${failedAction.action.type}${failedAction.action.description ? ` (${failedAction.action.description})` : ""}`;
  const passedCount = previousActions.filter((a) => a.status === "PASS").length;

  switch (classification) {
    case "PRODUCT_DEFECT":
      return `Assertion failed on ${actionDesc} after ${passedCount} successful actions. Expected: ${failedAction.expected ?? "N/A"}, Actual: ${failedAction.actual ?? "N/A"}. This may indicate a product defect.`;

    case "SELECTOR_FAILURE":
      return `Selector could not resolve for ${actionDesc}. The target element was not found on the page. This is likely a test/selector issue, not a product defect.`;

    case "TEST_DEFECT":
      return `${actionDesc} was rejected by policy or has an invalid configuration. This is a test setup issue.`;

    case "ENVIRONMENT_ISSUE":
      return `${actionDesc} failed due to an environment problem. ${failedAction.error ?? ""}`;

    case "APPLICATION_NOT_READY":
      return `${actionDesc} failed because the application appears not ready. Previous actions also failed, suggesting the app did not start properly.`;

    case "AUTHENTICATION_FAILURE":
      return `${actionDesc} encountered an authentication barrier (401/403). Credentials may be missing or invalid.`;

    case "NETWORK_FAILURE":
      return `${actionDesc} failed due to a network error. The application may not be reachable.`;

    case "TIMEOUT":
      return `${actionDesc} timed out. The operation did not complete within the allowed time.${(scenarioResult.consoleErrors?.length ?? 0) > 0 ? " Console errors were detected." : ""}`;

    case "UNKNOWN":
    default:
      return `${actionDesc} failed with an unclassified error: ${failedAction.error ?? "unknown"}. Baseline comparison recommended.`;
  }
}
