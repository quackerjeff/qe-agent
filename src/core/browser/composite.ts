import type { BrowserCapability } from "./capability.js";
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserScenario,
  BrowserScenarioResult,
  BrowserExecutionContext,
} from "./types.js";

/**
 * Local-first browser capability with fallback (ADR-008).
 *
 * Prefers the local Playwright/Chromium adapter. When the local browser
 * cannot be launched (e.g. a headless server without a Chromium binary),
 * falls back to the configured fallback capability — typically the
 * Playwright MCP adapter. If the primary adapter reports an
 * ENVIRONMENT_ISSUE on its first executed action, the scenario is
 * retried once with the fallback.
 */
export class CompositeBrowserCapability implements BrowserCapability {
  constructor(
    private readonly primary: BrowserCapability,
    private readonly fallback: BrowserCapability,
  ) {}

  async available(): Promise<boolean> {
    if (await this.primary.available()) return true;
    return this.fallback.available();
  }

  async executeScenario(
    scenario: BrowserScenario,
    context: BrowserExecutionContext,
  ): Promise<BrowserScenarioResult> {
    const result = await this.primary.executeScenario(scenario, context);

    if (this.isEnvironmentFailure(result)) {
      const fallbackResult = await this.fallback.executeScenario(
        scenario,
        context,
      );
      return this.annotate(fallbackResult, result);
    }

    return result;
  }

  async executeAction(
    action: BrowserAction,
    context: BrowserExecutionContext,
  ): Promise<BrowserActionResult> {
    const result = await this.primary.executeAction(action, context);
    if (
      result.status === "FAIL" &&
      result.failureClassification === "ENVIRONMENT_ISSUE"
    ) {
      return this.fallback.executeAction(action, context);
    }
    return result;
  }

  async cleanup(): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this.primary.cleanup();
    } catch (err) {
      errors.push(err);
    }
    try {
      await this.fallback.cleanup();
    } catch (err) {
      errors.push(err);
    }
    if (errors.length > 0) {
      throw errors[0];
    }
  }

  private isEnvironmentFailure(result: BrowserScenarioResult): boolean {
    return (
      result.status === "BLOCKED" &&
      result.actionResults.some(
        (r) => r.failureClassification === "ENVIRONMENT_ISSUE",
      )
    );
  }

  private annotate(
    fallbackResult: BrowserScenarioResult,
    primaryResult: BrowserScenarioResult,
  ): BrowserScenarioResult {
    const primaryError = primaryResult.actionResults.find(
      (r) => r.failureClassification === "ENVIRONMENT_ISSUE",
    )?.error;

    return {
      ...fallbackResult,
      actionResults: fallbackResult.actionResults.map((r) =>
        r.status === "FAIL" && r.failureClassification === "ENVIRONMENT_ISSUE"
          ? {
              ...r,
              error: `${r.error ?? "environment failure"}${primaryError ? ` (local browser unavailable: ${primaryError})` : ""}`,
            }
          : r,
      ),
    };
  }
}
