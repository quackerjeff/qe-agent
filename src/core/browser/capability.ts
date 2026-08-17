import type {
  BrowserAction,
  BrowserActionResult,
  BrowserScenario,
  BrowserScenarioResult,
  BrowserExecutionContext,
} from "./types.js";

export interface BrowserCapability {
  available(): Promise<boolean>;

  executeScenario(
    scenario: BrowserScenario,
    context: BrowserExecutionContext,
  ): Promise<BrowserScenarioResult>;

  executeAction(
    action: BrowserAction,
    context: BrowserExecutionContext,
  ): Promise<BrowserActionResult>;

  cleanup(): Promise<void>;
}
