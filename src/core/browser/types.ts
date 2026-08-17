import { z } from "zod";

export const BrowserActionType = z.enum([
  "NAVIGATE",
  "CLICK",
  "FILL",
  "SELECT",
  "CHECK",
  "UNCHECK",
  "PRESS",
  "ASSERT_TEXT",
  "ASSERT_VISIBLE",
  "ASSERT_HIDDEN",
  "ASSERT_URL",
  "ASSERT_VALUE",
  "SCREENSHOT",
]);
export type BrowserActionType = z.infer<typeof BrowserActionType>;

export const BrowserSelectorType = z.enum([
  "role",
  "label",
  "text",
  "testId",
  "placeholder",
  "css",
]);
export type BrowserSelectorType = z.infer<typeof BrowserSelectorType>;

export const BrowserSelectorSchema = z.object({
  type: BrowserSelectorType,
  value: z.string().min(1).max(500),
  options: z
    .object({
      exact: z.boolean().optional(),
      name: z.string().optional(),
    })
    .optional(),
});
export type BrowserSelector = z.infer<typeof BrowserSelectorSchema>;

export const BrowserActionSchema = z.object({
  type: BrowserActionType,
  selector: BrowserSelectorSchema.optional(),
  url: z.string().max(2048).optional(),
  value: z.string().max(10_000).optional(),
  key: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  timeoutMs: z.number().positive().max(30_000).optional(),
});
export type BrowserAction = z.infer<typeof BrowserActionSchema>;

export const BrowserFailureClassification = z.enum([
  "PRODUCT_DEFECT",
  "TEST_DEFECT",
  "SELECTOR_FAILURE",
  "ENVIRONMENT_ISSUE",
  "APPLICATION_NOT_READY",
  "AUTHENTICATION_FAILURE",
  "NETWORK_FAILURE",
  "TIMEOUT",
  "UNKNOWN",
]);
export type BrowserFailureClassification = z.infer<
  typeof BrowserFailureClassification
>;

export const BrowserActionResultSchema = z.object({
  action: BrowserActionSchema,
  status: z.enum(["PASS", "FAIL", "SKIPPED", "POLICY_DENIED"]),
  durationMs: z.number().nonnegative(),
  url: z.string().optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  error: z.string().optional(),
  screenshotPath: z.string().optional(),
  failureClassification: BrowserFailureClassification.optional(),
});
export type BrowserActionResult = z.infer<typeof BrowserActionResultSchema>;

export const BrowserScenarioSchema = z.object({
  id: z.string().min(1),
  objective: z.string().min(1),
  requirementIds: z.array(z.string()),
  actions: z.array(BrowserActionSchema),
  baseUrl: z.string().min(1),
});
export type BrowserScenario = z.infer<typeof BrowserScenarioSchema>;

export const BrowserScenarioResultSchema = z.object({
  scenarioId: z.string().min(1),
  status: z.enum(["PASS", "FAIL", "BLOCKED", "SKIPPED"]),
  actionResults: z.array(BrowserActionResultSchema),
  durationMs: z.number().nonnegative(),
  consoleErrors: z.array(z.string()).optional(),
  pageErrors: z.array(z.string()).optional(),
  failedRequests: z
    .array(
      z.object({
        url: z.string(),
        status: z.number().optional(),
        method: z.string().optional(),
      }),
    )
    .optional(),
  screenshots: z
    .array(z.object({ path: z.string(), description: z.string() }))
    .optional(),
});
export type BrowserScenarioResult = z.infer<typeof BrowserScenarioResultSchema>;

export const BrowserBudgetSchema = z.object({
  maxBrowserScenarios: z.number().nonnegative(),
  maxBrowserActions: z.number().nonnegative(),
  maxBrowserDurationMs: z.number().nonnegative(),
  maxScreenshots: z.number().nonnegative(),
});
export type BrowserBudget = z.infer<typeof BrowserBudgetSchema>;

export interface BrowserExecutionContext {
  baseUrl: string;
  allowedOrigins: string[];
  repositoryRoot: string;
  artifactDir: string;
  budget: BrowserBudget;
  secrets: string[];
  headless: boolean;
}

export interface ManagedProcessInfo {
  pid: number;
  command: string;
  port: number;
  startedAt: string;
}
