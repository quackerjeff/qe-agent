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
import {
  BudgetManager,
  createBudgetForProfile,
  VERDICT_TIME_RESERVE_MS,
} from "./budget-manager.js";
import {
  BudgetAwareGateway,
  MIN_MODEL_CALL_TIMEOUT_MS,
} from "./budget-aware-gateway.js";
import {
  buildReasoningContext,
  filterMemoryForDistillation,
} from "./context-builder.js";
import {
  buildDeterministicGrounding,
  createDiscoveryEvidence,
  createLifecycleEvidence,
  mergeGroundingWithModelAssessments,
} from "./deterministic-grounding.js";
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
import {
  analyzeGaps,
  analyzeGapsChunked,
  chunkRequirements,
  MAX_REQUIREMENTS_PER_GAP_CHUNK,
} from "../reasoning/gap-analyzer.js";
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
import { ProjectMemoryManager } from "../memory/manager.js";
import type {
  ProjectMemory,
  MemoryUpdateResult,
  MemoryWarning,
  MemoryMetrics,
} from "../memory/types.js";
import { buildMemoryDistillationTask } from "../../prompts/memory-distillation/v1.js";
import {
  persistDiagnostics,
  type RunDiagnostics,
  type GapChunkDiagnostic,
} from "./diagnostics.js";

export interface QEOrchestratorOptions {
  gateway: ModelGateway;
  logger?: Logger;
  maxModelCalls?: number;
  modelTokenLimit?: number;
  tpmLimit?: number;
  repositoryProfile?: RepositoryProfile;
  controller?: ExecutionController;
  browserCapability?: BrowserCapability;
  browserConfig?: {
    enabled: "auto" | boolean;
    baseUrl?: string;
    allowedOrigins?: string[];
    headless?: boolean;
  };
  memoryConfig?: {
    enabled: boolean;
    historySummaries?: boolean;
  };
  knownSecrets?: string[];
}

export class QEOrchestrator {
  private readonly gateway: ModelGateway;
  private readonly logger?: Logger;
  private readonly maxModelCalls?: number;
  private readonly modelTokenLimit?: number;
  private readonly tpmLimit?: number;
  private readonly injectedProfile?: RepositoryProfile;
  private readonly injectedController?: ExecutionController;
  private readonly browserCapability?: BrowserCapability;
  private readonly browserConfig?: QEOrchestratorOptions["browserConfig"];
  private readonly memoryConfig?: QEOrchestratorOptions["memoryConfig"];
  private readonly knownSecrets: string[];

  constructor(options: QEOrchestratorOptions) {
    this.gateway = options.gateway;
    this.logger = options.logger;
    this.maxModelCalls = options.maxModelCalls;
    this.modelTokenLimit = options.modelTokenLimit;
    this.tpmLimit = options.tpmLimit;
    this.injectedProfile = options.repositoryProfile;
    this.injectedController = options.controller;
    this.browserCapability = options.browserCapability;
    this.browserConfig = options.browserConfig;
    this.memoryConfig = options.memoryConfig;
    this.knownSecrets = options.knownSecrets ?? [];
  }

  async run(request: QERequest): Promise<QEResult> {
    const executionId = createExecutionId();
    const startTime = new Date().toISOString();
    const sm = new QEStateMachine();
    const budget = new BudgetManager(
      createBudgetForProfile(request.profile, this.maxModelCalls),
    );

    budget.callDeadlineReserveMs = VERDICT_TIME_RESERVE_MS;
    budget.reserveVerdictCall();

    const budgetGateway = new BudgetAwareGateway(this.gateway, budget, {
      maxRetriesPerCall: 2,
      modelTokenLimit: this.modelTokenLimit,
      tpmLimit: this.tpmLimit,
    });

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
    let memoryUpdateResults: MemoryUpdateResult[] = [];
    let gapChunkDiagnostics: GapChunkDiagnostic[] = [];
    const memoryWarnings: MemoryWarning[] = [];
    let projectMemory: ProjectMemory = {
      knowledgeFiles: [],
      historySummaries: [],
    };
    const memoryMetrics: MemoryMetrics = {
      memoryFilesRead: 0,
      memoryEntriesUsed: 0,
      memoryUpdatesProposed: 0,
      memoryUpdatesApplied: 0,
      memoryUpdatesRejected: 0,
      memoryConflicts: 0,
    };
    const memoryEnabled = this.memoryConfig?.enabled !== false;

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

      evidence.push(...createDiscoveryEvidence(repositoryProfile));
      evidence.push(
        ...createLifecycleEvidence({
          invocationMode: "cli",
          budgetActive: true,
          budgetMaxDurationMs: budget.budget.maxDurationMs,
          budgetMaxModelCalls: budget.budget.maxModelCalls,
        }),
      );

      // Load project memory early to influence reasoning
      if (memoryEnabled) {
        try {
          const memManager = new ProjectMemoryManager();
          const loadResult = await memManager.load(request.repositoryPath);
          projectMemory = loadResult.memory;
          memoryWarnings.push(...loadResult.warnings);
          memoryMetrics.memoryFilesRead = loadResult.metrics.memoryFilesRead;
          memoryMetrics.memoryEntriesUsed =
            loadResult.metrics.memoryEntriesUsed;
          this.logger?.info("Loaded project memory", {
            executionId,
            filesRead: loadResult.metrics.memoryFilesRead,
            entriesUsed: loadResult.metrics.memoryEntriesUsed,
            warnings: loadResult.warnings.length,
          });
        } catch (err) {
          this.logger?.warn("Failed to load project memory", {
            executionId,
            error: err instanceof Error ? err.message : String(err),
          });
          memoryWarnings.push({
            type: "READ_FAILURE",
            source: ".qe/",
            message: `Failed to load project memory: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

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
          projectMemory: memoryEnabled ? projectMemory : undefined,
        });

        if (budget.canAffordModelCall()) {
          try {
            const { analysis } = await analyzeChange(
              budgetGateway,
              ctx,
              diffData,
            );
            budget.recordModelCall();
            changeAnalysis = analysis;
          } catch {
            changeAnalysis = buildDeterministicChangeAnalysis(diffData);
          }
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
        projectMemory: memoryEnabled ? projectMemory : undefined,
        excludeVolatileHistory: true,
      });

      if (budget.canAffordModelCall()) {
        try {
          const { assessment } = await assessRisk(
            budgetGateway,
            riskCtx,
            changeAnalysis,
          );
          budget.recordModelCall();
          riskAssessment = assessment;
        } catch (riskErr) {
          this.logger?.warn("Risk assessment timed out or failed", {
            executionId,
            error: riskErr instanceof Error ? riskErr.message : String(riskErr),
          });
          riskAssessment = {
            level: "MEDIUM",
            factors: [
              {
                factor: "budget_timeout",
                reason: "Risk assessment did not complete within budget",
                weight: "medium",
              },
            ],
            confidence: 0.3,
            summary: "Risk assessment limited due to budget timeout",
          };
        }
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
        projectMemory: memoryEnabled ? projectMemory : undefined,
      });

      if (budget.canAffordModelCall()) {
        try {
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
        } catch (planErr) {
          this.logger?.warn("Validation planning timed out or failed", {
            executionId,
            error: planErr instanceof Error ? planErr.message : String(planErr),
          });
          validationPlan = {
            objectives: [],
            plannedActions: [],
            identifiedRisks: ["Planning did not complete within budget"],
            expectedCapabilities: [],
          };
        }
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

      let groundingResults: ReturnType<typeof buildDeterministicGrounding> = [];
      const groundingCtx = repositoryProfile
        ? {
            repositoryProfile,
            evidence,
            requirements: request.requirements ?? [],
            budgetActive: true,
          }
        : undefined;

      if (groundingCtx && (request.requirements?.length ?? 0) > 0) {
        groundingResults = buildDeterministicGrounding(groundingCtx);
      }

      if (
        budget.canAffordModelCall() &&
        (request.requirements?.length ?? 0) > 0
      ) {
        const reqCount = request.requirements!.length;
        const chunks = chunkRequirements(
          request.requirements!,
          MAX_REQUIREMENTS_PER_GAP_CHUNK,
        );

        if (chunks.length <= 1) {
          try {
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

            gapChunkDiagnostics = [
              {
                chunkIndex: 0,
                requestedRequirementIds: request.requirements!.map((r) => r.id),
                success: true,
                rawAssessments: gapResult.requirementAssessments.map((a) => ({
                  requirementId: a.requirementId,
                  status: a.status,
                  evidenceIds: [...a.evidenceIds],
                  explanation: a.explanation,
                })),
                rawGaps: gapResult.gaps.map((g) => ({
                  area: g.area,
                  description: g.description,
                  reason: g.reason,
                  risk: g.risk,
                })),
              },
            ];

            requirementAssessments = validateEvidenceReferences(
              requirementAssessments,
              evidence,
            );
          } catch (gapErr) {
            gapChunkDiagnostics = [
              {
                chunkIndex: 0,
                requestedRequirementIds: request.requirements!.map((r) => r.id),
                success: false,
                errorClass:
                  gapErr instanceof Error ? gapErr.constructor.name : "Unknown",
                errorMessage:
                  gapErr instanceof Error
                    ? gapErr.message.slice(0, 500)
                    : String(gapErr).slice(0, 500),
              },
            ];
            this.logger?.warn("Gap analysis timed out or failed", {
              executionId,
              error: gapErr instanceof Error ? gapErr.message : String(gapErr),
            });
            const passExecutionEvidenceIds = evidence
              .filter((e) => e.provenance === "executed" && e.status === "PASS")
              .map((e) => e.id);
            requirementAssessments = (request.requirements ?? []).map((r) => ({
              requirementId: r.id,
              status: "NOT_VERIFIED" as const,
              evidenceIds: passExecutionEvidenceIds,
              explanation:
                passExecutionEvidenceIds.length > 0
                  ? "Gap analysis timed out; repository-level validation passed but requirement-specific assessment could not be completed"
                  : "Gap analysis timed out; no execution evidence available for assessment",
            }));
            remainingGaps = [
              {
                area: "Gap Analysis",
                description:
                  "Requirement-to-evidence gap analysis did not complete within the execution budget.",
                reason:
                  "Primary gap analysis model call timed out before completing requirement assessments",
                risk: "MEDIUM" as const,
              },
            ];
          }
        } else {
          let chunksReserved = budget.reserveModelCalls(chunks.length);

          // Pre-dispatch time admission: skip all chunks when the
          // effective gap timeout is below the gateway's minimum.
          // Prevents dispatching chunks that will fail with
          // InsufficientTimeout and waste the shared retry budget.
          const effectiveGapTimeoutMs =
            budget.remainingMs - budget.callDeadlineReserveMs;
          if (effectiveGapTimeoutMs < MIN_MODEL_CALL_TIMEOUT_MS) {
            for (let i = 0; i < chunksReserved; i++) {
              budget.releaseReservation();
            }
            chunksReserved = 0;
            this.logger?.warn(
              "Gap chunks skipped: insufficient time for dispatch",
              {
                executionId,
                remainingMs: budget.remainingMs,
                chunksSkipped: chunks.length,
              },
            );
          }

          this.logger?.info("Chunking gap analysis", {
            executionId,
            requirementCount: reqCount,
            chunkCount: chunks.length,
            chunksReserved,
            chunkSize: MAX_REQUIREMENTS_PER_GAP_CHUNK,
          });

          const chunkedResult = await analyzeGapsChunked(
            budgetGateway,
            request.requirements!,
            evidence,
            findings,
            riskAssessment,
            diffData ? { changedFiles: diffData.changedFiles } : undefined,
            chunksReserved,
            () => budget.consumeReservation(),
            () => budget.releaseReservation(),
            this.logger
              ? {
                  info: (msg, ctx) => this.logger!.info(msg, ctx),
                  warn: (msg, ctx) => this.logger!.warn(msg, ctx),
                }
              : undefined,
          );

          remainingGaps = chunkedResult.gaps;
          requirementAssessments = chunkedResult.requirementAssessments;
          if (chunkedResult.chunkDiagnostics) {
            gapChunkDiagnostics = chunkedResult.chunkDiagnostics;
          }

          requirementAssessments = validateEvidenceReferences(
            requirementAssessments,
            evidence,
          );
        }
      } else if ((request.requirements?.length ?? 0) > 0) {
        requirementAssessments = (request.requirements ?? []).map((r) => ({
          requirementId: r.id,
          status: "NOT_VERIFIED" as const,
          evidenceIds: [],
          explanation: "Budget exhausted before gap analysis",
        }));
      }

      if (
        groundingResults.length > 0 &&
        requirementAssessments.length > 0 &&
        request.requirements
      ) {
        requirementAssessments = mergeGroundingWithModelAssessments(
          groundingResults,
          requirementAssessments,
          request.requirements,
        );
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
            budget.canAffordOptionalModelCall() &&
            (request.requirements?.length ?? 0) > 0
          ) {
            try {
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
            } catch (gapErr) {
              this.logger?.warn(
                "Re-gap-analysis after browser validation timed out; preserving prior assessments",
                {
                  executionId,
                  error:
                    gapErr instanceof Error ? gapErr.message : String(gapErr),
                },
              );
            }
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
        budget.canAffordOptionalModelCall() &&
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
          budget,
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

        // RETESTING — only when at least one generated test remains retained
        if (
          genResult.changes.some(
            (c) => c.writeOutcome === "APPLIED" && c.retained,
          )
        ) {
          sm.transition("RETESTING", "Retest after generation");
          this.logger?.info("Retesting existing coverage", {
            executionId,
            state: sm.state,
          });

          const retestActions = (validationPlan?.plannedActions ?? [])
            .filter((a) => a.command && a.type === "TEST")
            .slice(0, 2);

          for (const action of retestActions) {
            if (!budget.canAffordOptionalExecution(action.estimatedDurationMs))
              break;
            if (!action.command) continue;

            const proposal: CommandProposal = {
              executable: action.command.executable,
              args: action.command.args,
              workingDirectory: action.command.workingDirectory,
              timeoutMs: budget.optionalExecutionTimeoutMs(
                action.command.timeoutMs,
              ),
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

        // Transition out of GENERATING_TESTS so FORMING_VERDICT is reachable
        if (sm.canTransitionTo("ANALYZING_GAPS")) {
          sm.transition("ANALYZING_GAPS", "Re-analyze gaps after generation");
        }

        // Only perform the re-gap model call when generation produced evidence
        // that could materially change requirement assessment
        const generationProducedMaterialEvidence =
          genResult.changes.some(
            (c) => c.writeOutcome === "APPLIED" && c.retained,
          ) ||
          genResult.newEvidence.some(
            (e) =>
              e.status === "PASS" ||
              (e.status === "FAIL" &&
                e.generatedTestProvenance?.failureClassification !==
                  "TEST_DEFECT"),
          );

        if (
          generationProducedMaterialEvidence &&
          budget.canAffordOptionalModelCall() &&
          (request.requirements?.length ?? 0) > 0
        ) {
          this.logger?.info("Re-analyzing gaps", {
            executionId,
            state: sm.state,
          });

          try {
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
          } catch (gapErr) {
            this.logger?.warn(
              "Re-gap-analysis after test generation timed out; preserving prior assessments",
              {
                executionId,
                error:
                  gapErr instanceof Error ? gapErr.message : String(gapErr),
              },
            );
          }
        }
      }

      // FORMING_VERDICT
      budget.callDeadlineReserveMs = 0;
      budget.releaseVerdictReservation();
      sm.transition("FORMING_VERDICT", "Form verdict");
      this.logger?.info("Forming verdict", { executionId, state: sm.state });

      if (budget.canAffordModelCall()) {
        try {
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
        } catch (verdictErr) {
          this.logger?.error("Verdict formation failed", {
            executionId,
            error:
              verdictErr instanceof Error
                ? verdictErr.message
                : String(verdictErr),
          });
          verdictValue = "BLOCKED";
          confidenceValue = "LOW";
          summaryValue =
            "Verdict formation timed out; validation evidence was collected but could not be fully assessed.";
          recommendedNextActions = [
            "Re-run with a larger time budget to allow verdict formation to complete",
          ];
        }
      } else {
        verdictValue = "BLOCKED";
        confidenceValue = "LOW";
        summaryValue = "Budget exhausted before verdict could be formed";
        recommendedNextActions = ["Re-run with a larger budget"];
      }

      // Deterministic stale-memory conflict detection (Correction 4)
      if (memoryEnabled && repositoryProfile) {
        const memManager = new ProjectMemoryManager();
        const deterministicStale = memManager.detectStaleMemoryConflicts(
          projectMemory,
          {
            packageManagers: repositoryProfile.packageManagers.map((p) => ({
              name: p.name,
            })),
            commands: repositoryProfile.commands.map((c) => ({
              name: c.name,
              command: c.command,
              category: c.category,
            })),
            testFrameworks: repositoryProfile.testFrameworks.map((t) => ({
              name: t.name,
            })),
          },
        );
        for (const w of deterministicStale) {
          memoryWarnings.push(w);
          memoryMetrics.memoryConflicts++;
        }
      }

      // Memory distillation — after verdict, before reporting
      if (memoryEnabled && budget.canAffordModelCall()) {
        try {
          const memManager = new ProjectMemoryManager();
          const distillationTask = buildMemoryDistillationTask({
            repositoryRoot: request.repositoryPath,
            executionId,
            evidence: evidence.map((e) => ({
              id: e.id,
              type: e.type,
              status: e.status,
              summary: e.summary,
            })),
            findings: findings.map((f) => ({
              id: f.id,
              category: f.category,
              title: f.title,
            })),
            verdict: verdictValue,
            discoveredCommands: (repositoryProfile?.commands ?? []).map(
              (c) => ({
                name: c.name,
                command: c.command,
                category: c.category,
              }),
            ),
            riskSummary: riskAssessment?.summary,
            changeAnalysisSummary: changeAnalysis?.summary,
            existingMemory: filterMemoryForDistillation(projectMemory),
          });

          const distillResult = await budgetGateway.reason(distillationTask);
          budget.recordModelCall();

          const proposals = distillResult.data.proposals;
          memoryMetrics.memoryUpdatesProposed = proposals.length;

          // Detect stale entries as warnings (model-reported)
          for (const stale of distillResult.data.staleEntries) {
            const alreadyWarned = memoryWarnings.some(
              (w) =>
                w.type === "STALE" &&
                w.source === stale.source &&
                w.message === stale.reason,
            );
            if (!alreadyWarned) {
              memoryWarnings.push({
                type: "STALE",
                source: stale.source,
                message: stale.reason,
                proposedCorrection: stale.proposedCorrection,
              });
              memoryMetrics.memoryConflicts++;
            }
          }

          // Apply memory updates with known secrets and evidence (Corrections 1 & 2)
          if (proposals.length > 0) {
            const { results, metrics: updateMetrics } =
              await memManager.applyUpdates(
                request.repositoryPath,
                proposals,
                projectMemory,
                {
                  knownSecrets: this.knownSecrets,
                  currentEvidence: evidence.map((e) => ({
                    id: e.id,
                    type: e.type,
                    status: e.status,
                    provenance: e.provenance,
                  })),
                },
              );
            memoryUpdateResults = results;
            memoryMetrics.memoryUpdatesApplied =
              updateMetrics.memoryUpdatesApplied;
            memoryMetrics.memoryUpdatesRejected =
              updateMetrics.memoryUpdatesRejected;
          }

          // Write history summary if enabled
          if (this.memoryConfig?.historySummaries !== false) {
            const summaryContent = `# QE Run ${executionId}\n\nDate: ${new Date().toISOString()}\nVerdict: ${verdictValue}\nProfile: ${request.profile}\n\n## Findings\n\n${findings.length > 0 ? findings.map((f) => `- [${f.category}] ${f.title}`).join("\n") : "None"}\n`;
            const knownSecrets = this.knownSecrets;
            const hasSecretInSummary = memManager.containsKnownSecrets(
              summaryContent,
              knownSecrets,
            );

            if (!hasSecretInSummary) {
              const summaryProposal = {
                target: "HISTORY" as const,
                operation: "ADD" as const,
                topic: executionId,
                rationale: "Run summary for future reference",
                content: summaryContent,
                confidence: 1.0,
              };
              const { results: histResults } = await memManager.applyUpdates(
                request.repositoryPath,
                [summaryProposal],
                projectMemory,
                { knownSecrets },
              );
              memoryUpdateResults.push(...histResults);
            }
          }

          this.logger?.info("Memory distillation complete", {
            executionId,
            proposed: memoryMetrics.memoryUpdatesProposed,
            applied: memoryMetrics.memoryUpdatesApplied,
            rejected: memoryMetrics.memoryUpdatesRejected,
            conflicts: memoryMetrics.memoryConflicts,
          });
        } catch (err) {
          this.logger?.warn("Memory distillation failed", {
            executionId,
            error: err instanceof Error ? err.message : String(err),
          });
          memoryWarnings.push({
            type: "READ_FAILURE",
            source: "memory-distillation",
            message: `Memory distillation failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
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
      memoryUpdates:
        memoryUpdateResults.length > 0 ? memoryUpdateResults : undefined,
      memoryWarnings: memoryWarnings.length > 0 ? memoryWarnings : undefined,
      memoryMetrics: memoryEnabled ? memoryMetrics : undefined,
      requirements: requirementAssessments,
      remainingGaps,
      verdict: verdictValue,
      confidence: confidenceValue,
      summary: summaryValue,
      recommendedNextActions,
      metrics,
      aiUsage: budgetGateway.aggregateUsage(),
    };

    QEResultSchema.parse(result);

    try {
      const diagnostics: RunDiagnostics = {
        executionId,
        timestamp: new Date().toISOString(),
        providerAttempts: budgetGateway.diagnosticAttempts,
        gapChunks: gapChunkDiagnostics,
      };
      await persistDiagnostics(
        diagnostics,
        request.repositoryPath,
        this.knownSecrets,
      );
    } catch (diagErr) {
      this.logger?.warn("Failed to persist run diagnostics", {
        executionId,
        error: diagErr instanceof Error ? diagErr.message : String(diagErr),
      });
    }

    return result;
  }
}

export {
  sanitizeEvidenceDetails,
  projectEvidenceForModel,
  isAuthoritativeVerificationEvidence,
} from "./evidence-projection.js";

import { isAuthoritativeVerificationEvidence } from "./evidence-projection.js";

function validateEvidenceReferences(
  assessments: RequirementAssessment[],
  evidence: Evidence[],
): RequirementAssessment[] {
  const evidenceIds = new Set(evidence.map((e) => e.id));

  return assessments.map((a) => {
    const validIds = a.evidenceIds.filter((id) => evidenceIds.has(id));
    const hasAuthoritativeEvidence = validIds.some((id) => {
      const ev = evidence.find((e) => e.id === id);
      return ev != null && isAuthoritativeVerificationEvidence(ev);
    });

    if (
      a.status === "VERIFIED" &&
      (!hasAuthoritativeEvidence || validIds.length === 0)
    ) {
      return {
        ...a,
        evidenceIds: validIds,
        status: "NOT_VERIFIED" as const,
        explanation: `${a.explanation} [Downgraded: insufficient authoritative evidence for VERIFIED status]`,
      };
    }

    return { ...a, evidenceIds: validIds };
  });
}
