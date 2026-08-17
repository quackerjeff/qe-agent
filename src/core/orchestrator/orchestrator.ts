import type { Logger } from "../../logging/index.js";
import type { ModelGateway } from "../../models/gateway/types.js";
import type {
  QERequest,
  QEResult,
  RepositoryProfile,
  Evidence,
  Finding,
  RequirementAssessment,
  ChangeAnalysis,
  RiskAssessment,
  RiskLevel,
  ValidationPlan,
  ValidationAction,
  ExecutionMetrics,
  ModelCallMetadata,
  LifecycleTransition,
  BaselineComparison,
  GeneratedTestChange,
  TestGenerationMetrics,
} from "../../types/index.js";
import { QEResultSchema } from "../../types/index.js";
import { createExecutionId } from "../../logging/index.js";
import { QEStateMachine } from "../lifecycle/index.js";
import { BudgetManager, createBudgetForProfile } from "./budget-manager.js";
import { BudgetAwareGateway } from "./budget-aware-gateway.js";
import { buildReasoningContext } from "./context-builder.js";
import {
  collectDiff,
  getCurrentRef,
  getFileDiff,
  executeBaselineComparison,
  createWorktree,
  cleanupWorktree,
  type GitDiffData,
} from "../git/index.js";
import { analyzeRepository } from "../../repository/index.js";
import { ExecutionController } from "../../execution/index.js";
import type {
  CommandProposal,
  ExecutionContext,
} from "../../execution/index.js";
import { createExecutionEvidence } from "../../execution/index.js";
import {
  analyzeChange,
  buildDeterministicChangeAnalysis,
} from "../reasoning/change-analyzer.js";
import { assessRisk } from "../reasoning/risk-assessor.js";
import {
  planValidation,
  applyProfileLimits,
} from "../reasoning/validation-planner.js";
import {
  investigateFailure,
  classifyWithBaseline,
} from "../reasoning/failure-investigator.js";
import { analyzeGaps } from "../reasoning/gap-analyzer.js";
import { produceVerdict } from "../reasoning/verdict-engine.js";
import { generateAndExecuteTests } from "../test-generation/index.js";
import type { BrowserCapability } from "../browser/capability.js";
import type {
  BrowserScenario,
  BrowserScenarioResult,
  BrowserBudget,
  BrowserExecutionContext,
} from "../browser/types.js";
import {
  ManagedProcess,
  type ManagedProcessOptions,
} from "../browser/managed-process.js";
import { investigateBrowserFailure } from "../browser/failure-investigator.js";
import { validateBrowserActions } from "../browser/action-validator.js";

export interface QEOrchestratorOptions {
  gateway: ModelGateway;
  logger?: Logger;
  maxModelCalls?: number;
  repositoryProfile?: RepositoryProfile;
  controller?: ExecutionController;
  browserCapability?: BrowserCapability;
  browserConfig?: {
    enabled: "auto" | boolean;
    baseUrl?: string;
    allowedOrigins?: string[];
    headless?: boolean;
  };
}

export class QEOrchestrator {
  private readonly gateway: ModelGateway;
  private readonly logger?: Logger;
  private readonly maxModelCalls?: number;
  private readonly injectedProfile?: RepositoryProfile;
  private readonly injectedController?: ExecutionController;
  private readonly browserCapability?: BrowserCapability;
  private readonly browserConfig?: QEOrchestratorOptions["browserConfig"];

  constructor(options: QEOrchestratorOptions) {
    this.gateway = options.gateway;
    this.logger = options.logger;
    this.maxModelCalls = options.maxModelCalls;
    this.injectedProfile = options.repositoryProfile;
    this.injectedController = options.controller;
    this.browserCapability = options.browserCapability;
    this.browserConfig = options.browserConfig;
  }

  async run(request: QERequest): Promise<QEResult> {
    const executionId = createExecutionId();
    const startTime = new Date().toISOString();
    const sm = new QEStateMachine();
    const budget = new BudgetManager(
      createBudgetForProfile(request.profile, this.maxModelCalls),
    );

    const budgetGateway = new BudgetAwareGateway(this.gateway, budget, 2);

    const evidence: Evidence[] = [];
    const findings: Finding[] = [];
    let repositoryProfile: RepositoryProfile | undefined;
    let changeAnalysis: ChangeAnalysis | undefined;
    let riskAssessment: RiskAssessment | undefined;
    let validationPlan: ValidationPlan | undefined;
    let requirementAssessments: RequirementAssessment[] = [];
    let remainingGaps: {
      area: string;
      description: string;
      reason: string;
      risk: RiskLevel;
    }[] = [];
    let verdictValue: QEResult["verdict"] = "BLOCKED";
    let confidenceValue: QEResult["confidence"] = "LOW";
    let summaryValue = "";
    let recommendedNextActions: string[] = [];
    const baselineComparisons: BaselineComparison[] = [];
    let generatedTestChanges: GeneratedTestChange[] = [];
    let testGenerationMetrics: TestGenerationMetrics | undefined;

    const controller =
      this.injectedController ??
      new ExecutionController({ logger: this.logger });

    try {
      // DISCOVERING
      sm.transition("DISCOVERING", "Begin repository discovery");
      this.logger?.info("Discovering repository profile", {
        executionId,
        state: sm.state,
      });

      repositoryProfile = this.injectedProfile
        ? this.injectedProfile
        : await analyzeRepository({
            targetPath: request.repositoryPath,
          });

      // Collect Git diff data if in change mode
      let diffData: GitDiffData | undefined;
      let targetRef: string;

      if (request.mode === "change" && request.baselineRef) {
        targetRef =
          request.targetRef ?? (await getCurrentRef(request.repositoryPath));

        sm.transition("UNDERSTANDING_CHANGE", "Analyze change data");
        this.logger?.info("Collecting change data", {
          executionId,
          state: sm.state,
          baseline: request.baselineRef,
          target: targetRef,
        });

        diffData = await collectDiff(
          request.baselineRef,
          targetRef,
          request.repositoryPath,
        );

        // Collect file diffs for key changed files
        const fileDiffs: Record<string, string> = {};
        const filesToDiff = diffData.changedFiles
          .filter((f) => f.changeType !== "deleted")
          .slice(0, 15);
        for (const f of filesToDiff) {
          try {
            const diff = await getFileDiff(
              request.baselineRef,
              targetRef,
              f.path,
              request.repositoryPath,
            );
            if (diff) fileDiffs[f.path] = diff;
          } catch {
            // Skip files that can't be diffed
          }
        }

        const ctx = buildReasoningContext({
          requirements: request.requirements ?? [],
          profile: repositoryProfile,
          diffData,
          fileDiffs,
          evidence,
        });

        if (budget.canAffordModelCall()) {
          const { analysis } = await analyzeChange(
            budgetGateway,
            ctx,
            diffData,
          );
          budget.recordModelCall();
          changeAnalysis = analysis;
        } else {
          changeAnalysis = buildDeterministicChangeAnalysis(diffData);
        }
      } else {
        targetRef =
          request.targetRef ?? (await getCurrentRef(request.repositoryPath));

        if (request.mode === "change") {
          sm.transition("UNDERSTANDING_CHANGE", "No baseline available");
        }
      }

      // ASSESSING_RISK
      if (sm.canTransitionTo("ASSESSING_RISK")) {
        sm.transition("ASSESSING_RISK", "Assess risk");
      }
      this.logger?.info("Assessing risk", { executionId, state: sm.state });

      const riskCtx = buildReasoningContext({
        requirements: request.requirements ?? [],
        profile: repositoryProfile,
        diffData,
        evidence,
      });

      if (budget.canAffordModelCall()) {
        const { assessment } = await assessRisk(
          budgetGateway,
          riskCtx,
          changeAnalysis,
        );
        budget.recordModelCall();
        riskAssessment = assessment;
      } else {
        riskAssessment = {
          level: "MEDIUM",
          factors: [
            {
              factor: "budget_exhausted",
              reason: "Could not perform model-based risk assessment",
              weight: "medium",
            },
          ],
          confidence: 0.3,
          summary: "Risk assessment limited due to budget constraints",
        };
      }

      // PLANNING
      sm.transition("PLANNING", "Plan validation");
      this.logger?.info("Planning validation", {
        executionId,
        state: sm.state,
      });

      const planCtx = buildReasoningContext({
        requirements: request.requirements ?? [],
        profile: repositoryProfile,
        diffData,
        evidence,
      });

      if (budget.canAffordModelCall()) {
        const { plan } = await planValidation(
          budgetGateway,
          planCtx,
          riskAssessment,
          request.profile,
          repositoryProfile.commands,
        );
        budget.recordModelCall();
        validationPlan = plan;
        validationPlan.plannedActions = applyProfileLimits(
          validationPlan.plannedActions,
          request.profile,
        );
      } else {
        validationPlan = {
          objectives: [],
          plannedActions: [],
          identifiedRisks: ["Budget exhausted before planning"],
          expectedCapabilities: [],
        };
      }

      // EXECUTING
      sm.transition("EXECUTING", "Execute validation actions");
      this.logger?.info("Executing validation actions", {
        executionId,
        state: sm.state,
        actionCount: validationPlan.plannedActions.length,
      });

      const executionResults: {
        action: ValidationAction;
        evidence: Evidence;
        stdout: string;
        stderr: string;
        exitCode: number | null;
      }[] = [];

      for (const action of validationPlan.plannedActions) {
        if (!budget.canAffordExecution(action.estimatedDurationMs)) {
          this.logger?.warn("Budget insufficient for execution", {
            action: action.id,
          });
          break;
        }

        if (!action.command) continue;

        const proposal: CommandProposal = {
          executable: action.command.executable,
          args: action.command.args,
          workingDirectory: action.command.workingDirectory,
          timeoutMs: Math.min(action.command.timeoutMs, budget.remainingMs),
          purpose: action.purpose,
          mutability: "READ_ONLY",
          network: "ALLOWED",
        };

        const execCtx: ExecutionContext = {
          repositoryRoot: request.repositoryPath,
          executionMode: "local",
          secrets: [],
          maxOutputBytes: 1_048_576,
        };

        const { result, evidence: execEvidence } = await controller.execute(
          proposal,
          execCtx,
        );
        budget.recordExecution();

        const categoryMap: Record<string, string> = {
          BUILD: "BUILD",
          TEST: "TEST",
          LINT: "LINT",
          TYPECHECK: "TYPECHECK",
          STATIC_ANALYSIS: "STATIC_ANALYSIS",
        };
        const cat = categoryMap[action.type];
        const typedEvidence = cat
          ? createExecutionEvidence(result, cat)
          : execEvidence;

        evidence.push(typedEvidence);
        executionResults.push({
          action,
          evidence: typedEvidence,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        });
      }

      // INVESTIGATING
      const failedResults = executionResults.filter(
        (r) => r.evidence.status === "FAIL",
      );

      if (failedResults.length > 0) {
        sm.transition("INVESTIGATING", "Investigate failures");
        this.logger?.info("Investigating failures", {
          executionId,
          state: sm.state,
          failureCount: failedResults.length,
        });

        for (const failed of failedResults) {
          if (!budget.canAffordModelCall()) break;

          const investigation = await investigateFailure(
            budgetGateway,
            failed.evidence,
            failed.stdout,
            failed.stderr,
            failed.exitCode,
            diffData
              ? {
                  changedFiles: diffData.changedFiles,
                  summary: changeAnalysis?.summary,
                }
              : undefined,
            request.requirements?.map((r) => ({
              id: r.id,
              description: r.description,
            })),
          );
          budget.recordModelCall();
          findings.push(investigation.finding);

          // Real baseline comparison via worktree (Correction 1)
          if (
            investigation.suggestBaselineComparison &&
            request.mode === "change" &&
            request.baselineRef &&
            failed.action.command &&
            budget.canAffordExecution() &&
            budget.canAffordRetry()
          ) {
            try {
              const comparison = await executeBaselineComparison(
                {
                  repositoryPath: request.repositoryPath,
                  baselineRef: request.baselineRef,
                  failedCommand: {
                    executable: failed.action.command.executable,
                    args: failed.action.command.args,
                    workingDirectory: failed.action.command.workingDirectory,
                    timeoutMs: Math.min(
                      failed.action.command.timeoutMs,
                      budget.remainingMs,
                    ),
                    purpose: failed.action.purpose,
                    actionType: failed.action.type,
                  },
                  targetEvidence: failed.evidence,
                  targetExitCode: failed.exitCode,
                },
                controller,
                this.logger,
              );

              budget.recordExecution();
              budget.recordRetry();
              evidence.push(comparison.baselineEvidence);

              baselineComparisons.push({
                classification: comparison.classification,
                targetEvidenceId: comparison.targetEvidenceId,
                baselineEvidenceId: comparison.baselineEvidence.id,
                validationActionId: failed.action.id,
                explanation: `Baseline ${comparison.baselineExitCode === 0 ? "passed" : "failed"}, target ${comparison.targetExitCode === 0 ? "passed" : "failed"}`,
              });

              if (comparison.classification === "INTRODUCED") {
                const existingFinding = findings.find(
                  (f) => f.id === investigation.finding.id,
                );
                if (existingFinding) {
                  existingFinding.category = "REGRESSION";
                }
              }
            } catch (err) {
              this.logger?.warn("Baseline comparison failed", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }

      // ANALYZING_GAPS
      if (sm.canTransitionTo("ANALYZING_GAPS")) {
        sm.transition("ANALYZING_GAPS", "Analyze gaps");
      }
      this.logger?.info("Analyzing gaps", { executionId, state: sm.state });

      if (
        budget.canAffordModelCall() &&
        (request.requirements?.length ?? 0) > 0
      ) {
        const gapResult = await analyzeGaps(
          budgetGateway,
          request.requirements!,
          evidence,
          findings,
          riskAssessment,
          diffData ? { changedFiles: diffData.changedFiles } : undefined,
        );
        budget.recordModelCall();
        remainingGaps = gapResult.gaps;
        requirementAssessments = gapResult.requirementAssessments;

        // Correction 5: Validate model-supplied evidence references
        requirementAssessments = validateEvidenceReferences(
          requirementAssessments,
          evidence,
        );
      } else if ((request.requirements?.length ?? 0) > 0) {
        requirementAssessments = (request.requirements ?? []).map((r) => ({
          requirementId: r.id,
          status: "NOT_VERIFIED" as const,
          evidenceIds: [],
          explanation: "Budget exhausted before gap analysis",
        }));
      }

      // BROWSER_VALIDATING (conditional)
      const browserBudget: BrowserBudget = {
        maxBrowserScenarios: budget.budget.maxBrowserScenarios ?? 0,
        maxBrowserActions: budget.budget.maxBrowserActions ?? 0,
        maxBrowserDurationMs: budget.budget.maxBrowserDurationMs ?? 0,
        maxScreenshots: budget.budget.maxScreenshots ?? 0,
      };

      const browserEnabled = this.browserConfig?.enabled ?? "auto";
      const hasBrowserCapability = this.browserCapability != null;
      const hasBrowserBudget = browserBudget.maxBrowserScenarios > 0;
      const hasBrowserActions = (validationPlan?.plannedActions ?? []).some(
        (a) => a.type === "BROWSER",
      );

      const shouldRunBrowser =
        hasBrowserCapability &&
        hasBrowserBudget &&
        browserEnabled !== false &&
        (browserEnabled === true || hasBrowserActions) &&
        sm.canTransitionTo("BROWSER_VALIDATING");

      if (shouldRunBrowser && this.browserCapability) {
        sm.transition("BROWSER_VALIDATING", "Execute browser validation");
        this.logger?.info("Running browser validation", {
          executionId,
          state: sm.state,
        });

        const browserActions = (validationPlan?.plannedActions ?? []).filter(
          (a) => a.type === "BROWSER",
        );

        let managedProcess: ManagedProcess | null = null;
        const baseUrl = this.browserConfig?.baseUrl;
        const allowedOrigins = this.browserConfig?.allowedOrigins ?? [];

        try {
          const startCommand = repositoryProfile?.commands.find(
            (c) =>
              c.category === "START" && c.executionSupport === "STRUCTURED",
          );

          let effectiveBaseUrl = baseUrl;

          if (!effectiveBaseUrl && startCommand) {
            const port = 3_100 + Math.floor(Math.random() * 900);
            const processOptions: ManagedProcessOptions = {
              executable:
                startCommand.executable ?? startCommand.command.split(" ")[0],
              args:
                startCommand.args ?? startCommand.command.split(" ").slice(1),
              cwd: request.repositoryPath,
              port,
              readinessTimeoutMs: 15_000,
            };

            managedProcess = new ManagedProcess(processOptions);
            const startResult = await managedProcess.start();

            if (startResult.started && startResult.ready) {
              effectiveBaseUrl = `http://localhost:${port}`;
              this.logger?.info("Application started for browser validation", {
                executionId,
                pid: startResult.info?.pid,
                port,
              });

              evidence.push({
                id: `browser-startup-${executionId}`,
                type: "COMMAND_RESULT",
                provenance: "executed",
                timestamp: new Date().toISOString(),
                source: `managed-process:${startCommand.command}`,
                status: "PASS",
                summary: `Application started on port ${port}`,
                details: {
                  pid: startResult.info?.pid,
                  stdout: startResult.stdout.slice(-20),
                },
              });
            } else {
              evidence.push({
                id: `browser-startup-fail-${executionId}`,
                type: "COMMAND_RESULT",
                provenance: "executed",
                timestamp: new Date().toISOString(),
                source: `managed-process:${startCommand.command}`,
                status: "FAIL",
                summary: `Application startup failed: ${startResult.error ?? "unknown"}`,
                details: {
                  stderr: startResult.stderr.slice(-20),
                  stdout: startResult.stdout.slice(-20),
                },
              });

              remainingGaps.push({
                area: "browser-validation",
                description:
                  "Browser validation unavailable due to application startup failure",
                reason: startResult.error ?? "Application failed to start",
                risk: "MEDIUM",
              });
            }
          }

          if (effectiveBaseUrl) {
            const browserCtx: BrowserExecutionContext = {
              baseUrl: effectiveBaseUrl,
              allowedOrigins,
              repositoryRoot: request.repositoryPath,
              artifactDir: `.qe/runs/${executionId}`,
              budget: browserBudget,
              secrets: [],
              headless: this.browserConfig?.headless ?? true,
            };

            let scenariosExecuted = 0;
            const failedBrowserScenarios: {
              scenario: BrowserScenario;
              result: BrowserScenarioResult;
              evidenceEntry: Evidence;
              actionId: string;
            }[] = [];

            for (const action of browserActions) {
              if (scenariosExecuted >= browserBudget.maxBrowserScenarios) break;
              if (!budget.canAffordExecution()) break;

              const scenarioId = action.id ?? `browser-${scenariosExecuted}`;
              const rawBrowserActions = (
                action as ValidationAction & { browserActions?: unknown[] }
              ).browserActions;

              const resolvedActions = rawBrowserActions
                ? rawBrowserActions.map((ba) => {
                    const obj = ba as Record<string, unknown>;
                    if (
                      obj.type === "NAVIGATE" &&
                      typeof obj.url === "string"
                    ) {
                      return {
                        ...obj,
                        url: obj.url.replace("__BASE_URL__", effectiveBaseUrl),
                      };
                    }
                    return ba;
                  })
                : [];

              const scenario: BrowserScenario = {
                id: scenarioId,
                objective: action.purpose,
                requirementIds: action.requirementIds ?? [],
                actions:
                  resolvedActions.length > 0
                    ? validateBrowserActions(resolvedActions, allowedOrigins)
                        .valid
                    : [],
                baseUrl: effectiveBaseUrl,
              };

              if (scenario.actions.length === 0) continue;

              const scenarioResult: BrowserScenarioResult =
                await this.browserCapability.executeScenario(
                  scenario,
                  browserCtx,
                );
              scenariosExecuted++;
              budget.recordExecution();

              const browserEvidence: Evidence = {
                id: `browser-${scenarioId}-${executionId}`,
                type: "BROWSER_RESULT",
                provenance: "executed",
                timestamp: new Date().toISOString(),
                source: `playwright:${scenarioId}`,
                status: scenarioResult.status === "PASS" ? "PASS" : "FAIL",
                summary: `Browser scenario ${scenarioId}: ${scenarioResult.status}`,
                details: {
                  scenarioResult,
                  objective: scenario.objective,
                },
                relatedRequirementIds: scenario.requirementIds,
                artifacts: scenarioResult.screenshots?.map((s) => ({
                  path: s.path,
                  type: "screenshot",
                })),
              };

              evidence.push(browserEvidence);

              if (scenarioResult.status === "FAIL") {
                const failedActions = scenarioResult.actionResults.filter(
                  (r) => r.status === "FAIL",
                );
                for (const failedAction of failedActions) {
                  const passedBefore = scenarioResult.actionResults
                    .slice(
                      0,
                      scenarioResult.actionResults.indexOf(failedAction),
                    )
                    .filter((a) => a.status !== "SKIPPED");

                  const investigation = investigateBrowserFailure(
                    scenarioResult,
                    failedAction,
                    passedBefore,
                  );

                  if (investigation.isProductDefect) {
                    findings.push({
                      id: `browser-finding-${scenarioId}-${Date.now()}`,
                      category: "DEFECT",
                      severity: "HIGH",
                      confidence: 0.7,
                      title: `Browser: ${failedAction.action.description ?? failedAction.action.type} failed`,
                      description: investigation.explanation,
                      evidenceIds: [browserEvidence.id],
                      affectedFiles: [],
                    });

                    failedBrowserScenarios.push({
                      scenario,
                      result: scenarioResult,
                      evidenceEntry: browserEvidence,
                      actionId: action.id ?? scenarioId,
                    });
                  }
                }
              }
            }

            // Browser baseline comparison
            if (
              failedBrowserScenarios.length > 0 &&
              request.mode === "change" &&
              request.baselineRef &&
              budget.canAffordExecution()
            ) {
              let baselineWorktree: string | undefined;
              let baselineManagedProcess: ManagedProcess | null = null;

              try {
                baselineWorktree = await createWorktree(
                  request.repositoryPath,
                  request.baselineRef,
                );
                this.logger?.info("Created browser baseline worktree", {
                  executionId,
                  path: baselineWorktree,
                  ref: request.baselineRef,
                });

                const baselineProfile = await analyzeRepository({
                  targetPath: baselineWorktree,
                });

                const baselineStartCmd = baselineProfile.commands.find(
                  (c) =>
                    c.category === "START" &&
                    c.executionSupport === "STRUCTURED",
                );

                let baselineBaseUrl: string | undefined;

                if (baselineStartCmd) {
                  const baselinePort = 3_100 + Math.floor(Math.random() * 900);
                  baselineManagedProcess = new ManagedProcess({
                    executable:
                      baselineStartCmd.executable ??
                      baselineStartCmd.command.split(" ")[0],
                    args:
                      baselineStartCmd.args ??
                      baselineStartCmd.command.split(" ").slice(1),
                    cwd: baselineWorktree,
                    port: baselinePort,
                    readinessTimeoutMs: 15_000,
                  });

                  const baselineStart = await baselineManagedProcess.start();
                  if (baselineStart.started && baselineStart.ready) {
                    baselineBaseUrl = `http://127.0.0.1:${baselinePort}`;
                    this.logger?.info("Baseline app started", {
                      executionId,
                      port: baselinePort,
                    });
                  }
                } else if (baseUrl) {
                  baselineBaseUrl = baseUrl;
                }

                if (baselineBaseUrl && this.browserCapability) {
                  const baselineCtx: BrowserExecutionContext = {
                    baseUrl: baselineBaseUrl,
                    allowedOrigins,
                    repositoryRoot: baselineWorktree,
                    artifactDir: `.qe/runs/${executionId}-baseline`,
                    budget: browserBudget,
                    secrets: [],
                    headless: this.browserConfig?.headless ?? true,
                  };

                  const seen = new Set<string>();
                  for (const failed of failedBrowserScenarios) {
                    if (seen.has(failed.scenario.id)) continue;
                    seen.add(failed.scenario.id);
                    if (!budget.canAffordExecution()) break;

                    const baselineScenario: BrowserScenario = {
                      ...failed.scenario,
                      id: `baseline-${failed.scenario.id}`,
                      baseUrl: baselineBaseUrl,
                      actions: failed.scenario.actions.map((a) =>
                        a.type === "NAVIGATE" && a.url
                          ? {
                              ...a,
                              url: a.url.replace(
                                browserCtx.baseUrl,
                                baselineBaseUrl!,
                              ),
                            }
                          : a,
                      ),
                    };

                    const baselineResult =
                      await this.browserCapability.executeScenario(
                        baselineScenario,
                        baselineCtx,
                      );
                    budget.recordExecution();

                    const baselineEvidence: Evidence = {
                      id: `browser-baseline-${failed.scenario.id}-${executionId}`,
                      type: "BROWSER_RESULT",
                      provenance: "executed",
                      timestamp: new Date().toISOString(),
                      source: `playwright:baseline-${failed.scenario.id}`,
                      status:
                        baselineResult.status === "PASS" ? "PASS" : "FAIL",
                      summary: `Baseline browser scenario ${failed.scenario.id}: ${baselineResult.status}`,
                      details: {
                        scenarioResult: baselineResult,
                        objective: failed.scenario.objective,
                      },
                      relatedRequirementIds: failed.scenario.requirementIds,
                    };

                    evidence.push(baselineEvidence);

                    const targetStatus =
                      failed.result.status === "PASS" ? "PASS" : "FAIL";
                    const baseStatus =
                      baselineResult.status === "PASS" ? "PASS" : "FAIL";
                    const comparison = classifyWithBaseline(
                      baseStatus as "PASS" | "FAIL",
                      targetStatus as "PASS" | "FAIL",
                    );

                    baselineComparisons.push({
                      classification: comparison.classification as
                        | "INTRODUCED"
                        | "PRE_EXISTING"
                        | "ENVIRONMENT_SPECIFIC"
                        | "FLAKY"
                        | "UNKNOWN",
                      targetEvidenceId: failed.evidenceEntry.id,
                      baselineEvidenceId: baselineEvidence.id,
                      validationActionId: failed.actionId,
                      explanation: `Baseline browser ${baseStatus}, target browser ${targetStatus}`,
                    });

                    if (comparison.classification === "INTRODUCED") {
                      const relatedFinding = findings.find((f) =>
                        f.evidenceIds.includes(failed.evidenceEntry.id),
                      );
                      if (relatedFinding) {
                        relatedFinding.category = "REGRESSION";
                      }
                    }
                  }

                  await this.browserCapability.cleanup();
                }
              } catch (err) {
                this.logger?.warn("Browser baseline comparison failed", {
                  executionId,
                  error: err instanceof Error ? err.message : String(err),
                });
              } finally {
                if (baselineManagedProcess) {
                  await baselineManagedProcess.stop();
                }
                if (baselineWorktree) {
                  await cleanupWorktree(
                    request.repositoryPath,
                    baselineWorktree,
                    this.logger,
                  );
                }
              }
            }

            if (scenariosExecuted === 0 && browserActions.length > 0) {
              remainingGaps.push({
                area: "browser-validation",
                description:
                  "Browser scenarios planned but none could be executed",
                reason: "No valid browser actions could be constructed",
                risk: "MEDIUM",
              });
            }
          } else if (!baseUrl && !startCommand) {
            remainingGaps.push({
              area: "browser-validation",
              description: "Browser validation unavailable",
              reason:
                "No base URL configured and no startup command discovered",
              risk: "LOW",
            });
          }
        } catch (err) {
          this.logger?.error("Browser validation failed", {
            executionId,
            error: err instanceof Error ? err.message : String(err),
          });
          evidence.push({
            id: `browser-error-${executionId}`,
            type: "BROWSER_RESULT",
            provenance: "executed",
            timestamp: new Date().toISOString(),
            source: "playwright",
            status: "FAIL",
            summary: `Browser validation error: ${err instanceof Error ? err.message : String(err)}`,
          });
        } finally {
          if (managedProcess) {
            await managedProcess.stop();
            const portFree = await managedProcess.isPortFree();
            this.logger?.info("Managed process cleanup", {
              executionId,
              portFree,
            });
          }
          await this.browserCapability.cleanup();
        }

        if (sm.canTransitionTo("ANALYZING_GAPS")) {
          sm.transition(
            "ANALYZING_GAPS",
            "Re-analyze gaps after browser validation",
          );

          if (
            budget.canAffordModelCall() &&
            (request.requirements?.length ?? 0) > 0
          ) {
            const gapResult = await analyzeGaps(
              budgetGateway,
              request.requirements!,
              evidence,
              findings,
              riskAssessment,
              diffData ? { changedFiles: diffData.changedFiles } : undefined,
            );
            budget.recordModelCall();
            remainingGaps = gapResult.gaps;
            requirementAssessments = gapResult.requirementAssessments;
            requirementAssessments = validateEvidenceReferences(
              requirementAssessments,
              evidence,
            );
          }
        }
      }

      // GENERATING_TESTS (conditional)
      const maxGenTests = budget.budget.maxGeneratedTests ?? 0;
      const hasGaps = remainingGaps.length > 0;
      const hasRequirements = (request.requirements?.length ?? 0) > 0;
      const shouldGenerate =
        maxGenTests > 0 &&
        hasGaps &&
        hasRequirements &&
        budget.canAffordModelCall() &&
        sm.canTransitionTo("GENERATING_TESTS");

      if (shouldGenerate) {
        sm.transition("GENERATING_TESTS", "Generate targeted tests");
        this.logger?.info("Generating tests", {
          executionId,
          state: sm.state,
          gapCount: remainingGaps.length,
          maxTests: maxGenTests,
        });

        const genResult = await generateAndExecuteTests({
          gateway: budgetGateway,
          controller,
          profile: repositoryProfile,
          riskAssessment,
          gaps: remainingGaps,
          findings,
          evidence,
          requirements: (request.requirements ?? []).map((r) => ({
            id: r.id,
            description: r.description,
          })),
          executionProfile: request.profile,
          repositoryPath: request.repositoryPath,
          maxGeneratedTests: maxGenTests,
          changedFiles: diffData?.changedFiles.map((f) => f.path),
          logger: this.logger,
        });

        budget.recordModelCall();
        generatedTestChanges = genResult.changes;
        testGenerationMetrics = genResult.metrics;

        for (const ev of genResult.newEvidence) {
          evidence.push(ev);
        }
        for (const f of genResult.newFindings) {
          findings.push(f);
        }

        // RETESTING
        if (genResult.changes.some((c) => c.writeOutcome === "APPLIED")) {
          sm.transition("RETESTING", "Retest after generation");
          this.logger?.info("Retesting existing coverage", {
            executionId,
            state: sm.state,
          });

          const retestActions = (validationPlan?.plannedActions ?? [])
            .filter((a) => a.command && a.type === "TEST")
            .slice(0, 2);

          for (const action of retestActions) {
            if (!budget.canAffordExecution(action.estimatedDurationMs)) break;
            if (!action.command) continue;

            const proposal: CommandProposal = {
              executable: action.command.executable,
              args: action.command.args,
              workingDirectory: action.command.workingDirectory,
              timeoutMs: Math.min(action.command.timeoutMs, budget.remainingMs),
              purpose: `Retest: ${action.purpose}`,
              mutability: "READ_ONLY",
              network: "ALLOWED",
            };

            const execCtx: ExecutionContext = {
              repositoryRoot: request.repositoryPath,
              executionMode: "local",
              secrets: [],
              maxOutputBytes: 1_048_576,
            };

            const { result } = await controller.execute(proposal, execCtx);
            budget.recordExecution();
            const typedEvidence = createExecutionEvidence(result, action.type);
            evidence.push(typedEvidence);
          }
        }

        // Re-analyze gaps after test generation + retesting
        if (
          sm.canTransitionTo("ANALYZING_GAPS") &&
          budget.canAffordModelCall() &&
          (request.requirements?.length ?? 0) > 0
        ) {
          sm.transition("ANALYZING_GAPS", "Re-analyze gaps after generation");
          this.logger?.info("Re-analyzing gaps", {
            executionId,
            state: sm.state,
          });

          const gapResult = await analyzeGaps(
            budgetGateway,
            request.requirements!,
            evidence,
            findings,
            riskAssessment,
            diffData ? { changedFiles: diffData.changedFiles } : undefined,
          );
          budget.recordModelCall();
          remainingGaps = gapResult.gaps;
          requirementAssessments = gapResult.requirementAssessments;
          requirementAssessments = validateEvidenceReferences(
            requirementAssessments,
            evidence,
          );
        }
      }

      // FORMING_VERDICT
      sm.transition("FORMING_VERDICT", "Form verdict");
      this.logger?.info("Forming verdict", { executionId, state: sm.state });

      if (budget.canAffordModelCall()) {
        const verdictResult = await produceVerdict(
          budgetGateway,
          request.requirements ?? [],
          findings,
          riskAssessment,
          remainingGaps,
          requirementAssessments,
          evidence,
          budget.exhausted,
        );
        budget.recordModelCall();
        verdictValue = verdictResult.verdict;
        confidenceValue = verdictResult.confidence;
        summaryValue = verdictResult.summary;
        recommendedNextActions = verdictResult.recommendedNextActions;

        if (verdictResult.overrideApplied) {
          this.logger?.warn("Verdict guardrail applied", {
            reason: verdictResult.overrideReason,
            modelRecommended:
              verdictResult.modelRecommendation.recommendedVerdict,
            finalVerdict: verdictResult.verdict,
          });
        }
      } else {
        verdictValue = "BLOCKED";
        confidenceValue = "LOW";
        summaryValue = "Budget exhausted before verdict could be formed";
        recommendedNextActions = ["Re-run with a larger budget"];
      }

      // REPORTING
      sm.transition("REPORTING", "Generate report");
      sm.transition("COMPLETE", "QE run complete");
    } catch (err) {
      this.logger?.error("QE run failed", {
        executionId,
        error: err instanceof Error ? err.message : String(err),
      });

      if (sm.canTransitionTo("BLOCKED")) {
        sm.transition(
          "BLOCKED",
          err instanceof Error ? err.message : "Unknown error",
        );
      }

      verdictValue = "BLOCKED";
      confidenceValue = "LOW";
      summaryValue = `QE run blocked: ${err instanceof Error ? err.message : "unknown error"}`;
    }

    const endTime = new Date().toISOString();
    const budgetSnap = budget.snapshot();

    // Correction 6: Include lifecycle transition history
    const lifecycleHistory: LifecycleTransition[] = sm.history.map((t) => ({
      from: t.from,
      to: t.to,
      timestamp: t.timestamp,
      reason: t.reason,
    }));

    // Correction 7: Collect model call metadata
    const modelCallDetails: ModelCallMetadata[] = budgetGateway.callMetadata;

    const metrics: ExecutionMetrics = {
      startTime,
      endTime,
      durationMs: budgetSnap.elapsedMs,
      modelCalls: budgetSnap.modelCalls,
      commandsExecuted: budgetSnap.executionAttempts,
      testsExecuted: testGenerationMetrics?.testsExecuted ?? 0,
      testsGenerated: testGenerationMetrics?.testsGenerated ?? 0,
      retries: budgetSnap.retries,
      stateTransitions: sm.history.length,
      lifecycleHistory,
      modelCallDetails,
    };

    // Correction 5: Validate finding evidence references too
    for (const finding of findings) {
      finding.evidenceIds = finding.evidenceIds.filter((id) =>
        evidence.some((e) => e.id === id),
      );
    }

    const result: QEResult = {
      executionId,
      repository: {
        path: request.repositoryPath,
        name: repositoryProfile
          ? request.repositoryPath.split("/").pop()
          : undefined,
      },
      baseline: request.baselineRef,
      target: request.targetRef ?? "HEAD",
      profile: request.profile,
      repositoryProfile: repositoryProfile!,
      changeAnalysis,
      riskAssessment: riskAssessment ?? {
        level: "MEDIUM",
        factors: [],
        confidence: 0,
        summary: "Risk assessment not performed",
      },
      validationPlan: validationPlan ?? {
        objectives: [],
        plannedActions: [],
        identifiedRisks: [],
        expectedCapabilities: [],
      },
      evidence,
      findings,
      baselineComparisons:
        baselineComparisons.length > 0 ? baselineComparisons : undefined,
      generatedTestChanges:
        generatedTestChanges.length > 0 ? generatedTestChanges : undefined,
      testGenerationMetrics,
      requirements: requirementAssessments,
      remainingGaps,
      verdict: verdictValue,
      confidence: confidenceValue,
      summary: summaryValue,
      recommendedNextActions,
      metrics,
    };

    QEResultSchema.parse(result);

    return result;
  }
}

function validateEvidenceReferences(
  assessments: RequirementAssessment[],
  evidence: Evidence[],
): RequirementAssessment[] {
  const evidenceIds = new Set(evidence.map((e) => e.id));

  return assessments.map((a) => {
    const validIds = a.evidenceIds.filter((id) => evidenceIds.has(id));
    const hasExecutedEvidence = validIds.some((id) => {
      const ev = evidence.find((e) => e.id === id);
      return ev && ev.provenance === "executed";
    });

    if (
      a.status === "VERIFIED" &&
      (!hasExecutedEvidence || validIds.length === 0)
    ) {
      return {
        ...a,
        evidenceIds: validIds,
        status: "NOT_VERIFIED" as const,
        explanation: `${a.explanation} [Downgraded: insufficient executed evidence for VERIFIED status]`,
      };
    }

    return { ...a, evidenceIds: validIds };
  });
}
