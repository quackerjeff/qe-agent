import { existsSync, mkdirSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import type { BrowserCapability } from "./capability.js";
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserScenario,
  BrowserScenarioResult,
  BrowserExecutionContext,
  BrowserSelector,
  BrowserFailureClassification,
} from "./types.js";
import { validateBrowserAction } from "./action-validator.js";
import { evaluateUrlPolicy } from "./url-policy.js";

type PlaywrightBrowser = import("playwright").Browser;
type PlaywrightBrowserContext = import("playwright").BrowserContext;
type PlaywrightPage = import("playwright").Page;
type PlaywrightLocator = import("playwright").Locator;

export class PlaywrightAdapter implements BrowserCapability {
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightBrowserContext | null = null;
  private page: PlaywrightPage | null = null;
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];
  private failedRequests: { url: string; status?: number; method?: string }[] =
    [];
  private policyDenials: string[] = [];
  private screenshotsTaken = 0;

  async available(): Promise<boolean> {
    try {
      await import("playwright");
      return true;
    } catch {
      return false;
    }
  }

  async executeScenario(
    scenario: BrowserScenario,
    context: BrowserExecutionContext,
  ): Promise<BrowserScenarioResult> {
    const startTime = Date.now();
    const actionResults: BrowserActionResult[] = [];
    const screenshots: { path: string; description: string }[] = [];
    let scenarioStatus: BrowserScenarioResult["status"] = "PASS";

    this.consoleErrors = [];
    this.pageErrors = [];
    this.failedRequests = [];
    this.policyDenials = [];
    this.screenshotsTaken = 0;

    try {
      await this.ensureBrowser(context);

      let actionsExecuted = 0;
      const budgetDeadline = startTime + context.budget.maxBrowserDurationMs;

      for (const action of scenario.actions) {
        if (actionsExecuted >= context.budget.maxBrowserActions) {
          actionResults.push(
            this.skippedResult(action, "Action budget exceeded"),
          );
          continue;
        }

        if (Date.now() >= budgetDeadline) {
          actionResults.push(
            this.skippedResult(action, "Duration budget exceeded"),
          );
          continue;
        }

        const validation = validateBrowserAction(
          action,
          context.allowedOrigins,
        );
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

        const result = await this.executeAction(action, context);
        actionResults.push(result);
        actionsExecuted++;

        if (result.status === "FAIL" || result.status === "POLICY_DENIED") {
          scenarioStatus = "FAIL";
          if (
            result.status === "FAIL" &&
            this.screenshotsTaken < context.budget.maxScreenshots &&
            this.page
          ) {
            try {
              const ssPath = this.safeScreenshotPath(
                context,
                scenario.id,
                actionsExecuted,
              );
              if (ssPath) {
                await this.page.screenshot({ path: ssPath });
                this.screenshotsTaken++;
                result.screenshotPath = ssPath;
                screenshots.push({
                  path: ssPath,
                  description: `Failure at action ${actionsExecuted}: ${action.type} ${action.description ?? ""}`,
                });
              }
            } catch {
              // screenshot failure is non-fatal
            }
          }
        }
      }
    } catch (err) {
      scenarioStatus = "BLOCKED";
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
    } finally {
      await this.closeContext();
    }

    return {
      scenarioId: scenario.id,
      status: scenarioStatus,
      actionResults,
      durationMs: Date.now() - startTime,
      consoleErrors:
        this.consoleErrors.length > 0 ? [...this.consoleErrors] : undefined,
      pageErrors: this.pageErrors.length > 0 ? [...this.pageErrors] : undefined,
      failedRequests:
        this.failedRequests.length > 0 ? [...this.failedRequests] : undefined,
      screenshots: screenshots.length > 0 ? screenshots : undefined,
    };
  }

  async executeAction(
    action: BrowserAction,
    context: BrowserExecutionContext,
  ): Promise<BrowserActionResult> {
    const startTime = Date.now();

    try {
      await this.ensureBrowser(context);
      const page = this.page!;
      const timeout = action.timeoutMs ?? 5_000;

      switch (action.type) {
        case "NAVIGATE": {
          const url = action.url!;
          await page.goto(url, { timeout, waitUntil: "domcontentloaded" });
          const postNavResult = this.verifyPostActionUrl(page, context);
          if (postNavResult)
            return {
              ...postNavResult,
              action,
              durationMs: Date.now() - startTime,
            };
          return {
            action,
            status: "PASS",
            durationMs: Date.now() - startTime,
            url: page.url(),
          };
        }

        case "CLICK": {
          const locator = this.resolveSelector(page, action.selector!);
          await locator.click({ timeout });
          const postResult = this.verifyPostActionUrl(page, context);
          if (postResult)
            return {
              ...postResult,
              action,
              durationMs: Date.now() - startTime,
            };
          return {
            action,
            status: "PASS",
            durationMs: Date.now() - startTime,
            url: page.url(),
          };
        }

        case "FILL": {
          const locator = this.resolveSelector(page, action.selector!);
          await locator.fill(action.value!, { timeout });
          const postResult = this.verifyPostActionUrl(page, context);
          if (postResult)
            return {
              ...postResult,
              action: this.redactActionSecrets(action, context.secrets),
              durationMs: Date.now() - startTime,
            };
          return {
            action: this.redactActionSecrets(action, context.secrets),
            status: "PASS",
            durationMs: Date.now() - startTime,
            url: page.url(),
          };
        }

        case "SELECT": {
          const locator = this.resolveSelector(page, action.selector!);
          await locator.selectOption(action.value!, { timeout });
          const postResult = this.verifyPostActionUrl(page, context);
          if (postResult)
            return {
              ...postResult,
              action,
              durationMs: Date.now() - startTime,
            };
          return {
            action,
            status: "PASS",
            durationMs: Date.now() - startTime,
            url: page.url(),
          };
        }

        case "CHECK": {
          const locator = this.resolveSelector(page, action.selector!);
          await locator.check({ timeout });
          const postResult = this.verifyPostActionUrl(page, context);
          if (postResult)
            return {
              ...postResult,
              action,
              durationMs: Date.now() - startTime,
            };
          return {
            action,
            status: "PASS",
            durationMs: Date.now() - startTime,
            url: page.url(),
          };
        }

        case "UNCHECK": {
          const locator = this.resolveSelector(page, action.selector!);
          await locator.uncheck({ timeout });
          const postResult = this.verifyPostActionUrl(page, context);
          if (postResult)
            return {
              ...postResult,
              action,
              durationMs: Date.now() - startTime,
            };
          return {
            action,
            status: "PASS",
            durationMs: Date.now() - startTime,
            url: page.url(),
          };
        }

        case "PRESS": {
          if (action.selector) {
            const locator = this.resolveSelector(page, action.selector);
            await locator.press(action.key!, { timeout });
          } else {
            await page.keyboard.press(action.key!);
          }
          const postResult = this.verifyPostActionUrl(page, context);
          if (postResult)
            return {
              ...postResult,
              action,
              durationMs: Date.now() - startTime,
            };
          return {
            action,
            status: "PASS",
            durationMs: Date.now() - startTime,
            url: page.url(),
          };
        }

        case "ASSERT_TEXT": {
          const preCheck = this.verifyPostActionUrl(page, context);
          if (preCheck)
            return {
              ...preCheck,
              action,
              durationMs: Date.now() - startTime,
            };
          const locator = this.resolveSelector(page, action.selector!);
          const actualText = await locator
            .textContent({ timeout })
            .catch(() => null);
          const expected = action.value ?? "";
          const pass =
            actualText !== null &&
            actualText.toLowerCase().includes(expected.toLowerCase());
          return {
            action,
            status: pass ? "PASS" : "FAIL",
            durationMs: Date.now() - startTime,
            url: page.url(),
            expected: this.redactSecrets(expected, context.secrets),
            actual: this.redactSecrets(
              actualText ?? "(element not found or no text)",
              context.secrets,
            ),
          };
        }

        case "ASSERT_VISIBLE": {
          const preCheck = this.verifyPostActionUrl(page, context);
          if (preCheck)
            return {
              ...preCheck,
              action,
              durationMs: Date.now() - startTime,
            };
          const locator = this.resolveSelector(page, action.selector!);
          const visible = await locator
            .isVisible({ timeout })
            .catch(() => false);
          return {
            action,
            status: visible ? "PASS" : "FAIL",
            durationMs: Date.now() - startTime,
            url: page.url(),
            expected: "visible",
            actual: visible ? "visible" : "not visible",
          };
        }

        case "ASSERT_HIDDEN": {
          const preCheck = this.verifyPostActionUrl(page, context);
          if (preCheck)
            return {
              ...preCheck,
              action,
              durationMs: Date.now() - startTime,
            };
          const locator = this.resolveSelector(page, action.selector!);
          const visible = await locator.isVisible().catch(() => false);
          return {
            action,
            status: !visible ? "PASS" : "FAIL",
            durationMs: Date.now() - startTime,
            url: page.url(),
            expected: "hidden",
            actual: visible ? "visible" : "hidden",
          };
        }

        case "ASSERT_URL": {
          const currentUrl = page.url();
          const expected = action.url ?? action.value ?? "";
          const pass = currentUrl.includes(expected);
          return {
            action,
            status: pass ? "PASS" : "FAIL",
            durationMs: Date.now() - startTime,
            url: currentUrl,
            expected: this.redactSecrets(expected, context.secrets),
            actual: this.redactSecrets(currentUrl, context.secrets),
          };
        }

        case "ASSERT_VALUE": {
          const preCheck = this.verifyPostActionUrl(page, context);
          if (preCheck)
            return {
              ...preCheck,
              action,
              durationMs: Date.now() - startTime,
            };
          const locator = this.resolveSelector(page, action.selector!);
          const actualValue = await locator
            .inputValue({ timeout })
            .catch(() => null);
          const expected = action.value ?? "";
          const isSecret = this.isSecretValue(expected, context.secrets);
          const isPasswordField = await this.isPasswordInput(locator);

          if (isSecret || isPasswordField) {
            const pass = actualValue === expected;
            return {
              action: this.redactActionSecrets(action, context.secrets),
              status: pass ? "PASS" : "FAIL",
              durationMs: Date.now() - startTime,
              url: page.url(),
              expected: "[REDACTED]",
              actual: pass
                ? "value matched expected secret"
                : "value did not match expected secret",
            };
          }

          const pass = actualValue === expected;
          return {
            action,
            status: pass ? "PASS" : "FAIL",
            durationMs: Date.now() - startTime,
            url: page.url(),
            expected: this.redactSecrets(expected, context.secrets),
            actual: this.redactSecrets(
              actualValue ?? "(element not found)",
              context.secrets,
            ),
          };
        }

        case "SCREENSHOT": {
          const preCheck = this.verifyPostActionUrl(page, context);
          if (preCheck)
            return {
              ...preCheck,
              action,
              durationMs: Date.now() - startTime,
            };
          if (this.screenshotsTaken >= context.budget.maxScreenshots) {
            return this.skippedResult(action, "Screenshot budget exceeded");
          }
          const ssPath = this.safeScreenshotPath(
            context,
            "manual",
            this.screenshotsTaken,
          );
          if (!ssPath) {
            return {
              action,
              status: "FAIL",
              durationMs: Date.now() - startTime,
              error: "Artifact path outside repository boundary",
            };
          }
          await page.screenshot({ path: ssPath });
          this.screenshotsTaken++;
          return {
            action,
            status: "PASS",
            durationMs: Date.now() - startTime,
            url: page.url(),
            screenshotPath: ssPath,
          };
        }

        default:
          return {
            action,
            status: "FAIL",
            durationMs: Date.now() - startTime,
            error: `Unknown action type: ${action.type}`,
          };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const classification = this.classifyError(errorMsg, action);

      return {
        action: this.redactActionSecrets(action, context.secrets),
        status: "FAIL",
        durationMs: Date.now() - startTime,
        url: this.page?.url(),
        error: this.redactSecrets(errorMsg, context.secrets),
        failureClassification: classification,
      };
    }
  }

  async cleanup(): Promise<void> {
    await this.closeContext();
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // cleanup best-effort
      }
      this.browser = null;
    }
  }

  private async ensureBrowser(context: BrowserExecutionContext): Promise<void> {
    if (!this.browser) {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({ headless: context.headless });
    }

    if (!this.context || !this.page) {
      this.context = await this.browser.newContext({
        ignoreHTTPSErrors: true,
      });

      this.page = await this.context.newPage();

      // --- Correction 1: Navigation guards ---

      // Block all network requests to disallowed origins
      await this.context.route("**/*", (route) => {
        const url = route.request().url();
        const policy = evaluateUrlPolicy(url, context.allowedOrigins);
        if (policy.allowed) {
          route.continue();
        } else {
          if (this.policyDenials.length < 50) {
            this.policyDenials.push(
              `Navigation blocked: ${url} — ${policy.reason}`,
            );
          }
          route.abort("blockedbyclient");
        }
      });

      // Block popups/new pages to external origins
      this.context.on("page", async (newPage) => {
        const newUrl = newPage.url();
        const policy = evaluateUrlPolicy(
          newUrl === "about:blank" ? "about:blank" : newUrl,
          context.allowedOrigins,
        );
        if (!policy.allowed && newUrl !== "about:blank") {
          if (this.policyDenials.length < 50) {
            this.policyDenials.push(
              `Popup blocked: ${newUrl} — ${policy.reason}`,
            );
          }
          await newPage.close().catch(() => {});
        } else if (newUrl === "about:blank") {
          // Wait briefly to see where the popup navigates
          newPage.once("framenavigated", async (frame) => {
            const destUrl = frame.url();
            const destPolicy = evaluateUrlPolicy(
              destUrl,
              context.allowedOrigins,
            );
            if (!destPolicy.allowed) {
              if (this.policyDenials.length < 50) {
                this.policyDenials.push(
                  `Popup navigation blocked: ${destUrl} — ${destPolicy.reason}`,
                );
              }
              await newPage.close().catch(() => {});
            }
          });
        }
      });

      // --- End navigation guards ---

      this.page.on("console", (msg) => {
        if (msg.type() === "error" && this.consoleErrors.length < 50) {
          this.consoleErrors.push(
            this.redactSecrets(msg.text(), context.secrets),
          );
        }
      });

      this.page.on("pageerror", (err) => {
        if (this.pageErrors.length < 50) {
          this.pageErrors.push(
            this.redactSecrets(err.message, context.secrets),
          );
        }
      });

      this.page.on("response", (response) => {
        if (response.status() >= 400 && this.failedRequests.length < 50) {
          this.failedRequests.push({
            url: this.redactSecrets(response.url(), context.secrets),
            status: response.status(),
            method: response.request().method(),
          });
        }
      });
    }
  }

  private async closeContext(): Promise<void> {
    if (this.page) {
      try {
        await this.page.close();
      } catch {
        // best-effort
      }
      this.page = null;
    }
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // best-effort
      }
      this.context = null;
    }
  }

  private resolveSelector(
    page: PlaywrightPage,
    selector: BrowserSelector,
  ): PlaywrightLocator {
    switch (selector.type) {
      case "role":
        return page.getByRole(
          selector.value as Parameters<PlaywrightPage["getByRole"]>[0],
          {
            name: selector.options?.name,
            exact: selector.options?.exact,
          },
        );
      case "label":
        return page.getByLabel(selector.value, {
          exact: selector.options?.exact,
        });
      case "text":
        return page.getByText(selector.value, {
          exact: selector.options?.exact,
        });
      case "testId":
        return page.getByTestId(selector.value);
      case "placeholder":
        return page.getByPlaceholder(selector.value, {
          exact: selector.options?.exact,
        });
      case "css":
        return page.locator(selector.value);
    }
  }

  // --- Correction 3: Safe artifact paths rooted under repositoryRoot ---

  private safeScreenshotPath(
    context: BrowserExecutionContext,
    scenarioId: string,
    index: number,
  ): string | null {
    const repoRoot = resolve(context.repositoryRoot);
    const artifactBase = resolve(repoRoot, context.artifactDir);
    const dir = join(artifactBase, "browser", "screenshots");
    const filePath = join(dir, `${scenarioId}-${index}.png`);

    const resolvedPath = resolve(filePath);
    if (!resolvedPath.startsWith(repoRoot)) {
      return null;
    }

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Verify no symlink escape
    try {
      if (existsSync(dir)) {
        const realDir = realpathSync(dir);
        if (!realDir.startsWith(repoRoot)) {
          return null;
        }
      }
    } catch {
      return null;
    }

    return resolvedPath;
  }

  static validateArtifactPath(
    proposedPath: string,
    repositoryRoot: string,
  ): { valid: boolean; reason: string } {
    const repoRoot = resolve(repositoryRoot);

    if (isAbsolute(proposedPath) && !proposedPath.startsWith(repoRoot)) {
      return {
        valid: false,
        reason: "Absolute path outside repository boundary",
      };
    }

    const resolved = resolve(repoRoot, proposedPath);
    if (!resolved.startsWith(repoRoot)) {
      return { valid: false, reason: "Path traversal outside repository" };
    }

    try {
      const parent = resolve(resolved, "..");
      if (existsSync(parent)) {
        const stat = lstatSync(parent);
        if (stat.isSymbolicLink()) {
          const realParent = realpathSync(parent);
          if (!realParent.startsWith(repoRoot)) {
            return {
              valid: false,
              reason: "Symlink escape outside repository",
            };
          }
        }
      }
    } catch {
      // parent doesn't exist yet, which is fine
    }

    return { valid: true, reason: "Path within repository" };
  }

  // --- Correction 1: Post-action URL verification ---

  private verifyPostActionUrl(
    page: PlaywrightPage,
    context: BrowserExecutionContext,
  ): Omit<BrowserActionResult, "action" | "durationMs"> | null {
    const currentUrl = page.url();
    if (currentUrl === "about:blank") return null;
    const policy = evaluateUrlPolicy(currentUrl, context.allowedOrigins);
    if (!policy.allowed) {
      if (this.policyDenials.length < 50) {
        this.policyDenials.push(
          `Post-action URL denied: ${currentUrl} — ${policy.reason}`,
        );
      }
      return {
        status: "POLICY_DENIED",
        url: currentUrl,
        error: `Navigation reached denied origin: ${currentUrl}`,
      };
    }
    return null;
  }

  // --- Correction 2: Secret redaction ---

  private isSecretValue(value: string, secrets: string[]): boolean {
    return secrets.some((s) => s.length > 0 && value.includes(s));
  }

  private async isPasswordInput(locator: PlaywrightLocator): Promise<boolean> {
    try {
      const inputType = await locator.getAttribute("type");
      return inputType === "password";
    } catch {
      return false;
    }
  }

  private redactActionSecrets(
    action: BrowserAction,
    secrets: string[],
  ): BrowserAction {
    if (!action.value) return action;
    const hasSecret = this.isSecretValue(action.value, secrets);
    if (hasSecret) {
      return { ...action, value: "[REDACTED]" };
    }
    return action;
  }

  private classifyError(
    errorMsg: string,
    action: BrowserAction,
  ): BrowserFailureClassification {
    const msg = errorMsg.toLowerCase();

    if (msg.includes("timeout") || msg.includes("exceeded")) {
      return "TIMEOUT";
    }
    if (
      msg.includes("net::err_connection_refused") ||
      msg.includes("econnrefused") ||
      msg.includes("net::err_name_not_resolved")
    ) {
      return "NETWORK_FAILURE";
    }
    if (
      msg.includes("waiting for selector") ||
      msg.includes("no element matching") ||
      msg.includes("strict mode violation") ||
      msg.includes("locator resolved to")
    ) {
      return "SELECTOR_FAILURE";
    }
    if (msg.includes("navigation") || msg.includes("page.goto")) {
      if (msg.includes("timeout")) return "TIMEOUT";
      return "APPLICATION_NOT_READY";
    }
    if (
      msg.includes("blockedbyclient") ||
      msg.includes("net::err_blocked_by_client") ||
      msg.includes("net::err_failed")
    ) {
      return "NETWORK_FAILURE";
    }
    if (
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("unauthorized") ||
      msg.includes("forbidden")
    ) {
      return "AUTHENTICATION_FAILURE";
    }
    if (
      ["CLICK", "FILL", "SELECT", "CHECK", "UNCHECK"].includes(action.type) &&
      (msg.includes("not found") || msg.includes("no element"))
    ) {
      return "SELECTOR_FAILURE";
    }

    return "UNKNOWN";
  }

  private redactSecrets(text: string, secrets: string[]): string {
    let result = text;
    for (const secret of secrets) {
      if (secret.length > 0) {
        result = result.replaceAll(secret, "[REDACTED]");
      }
    }
    return result;
  }

  private skippedResult(
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
}
