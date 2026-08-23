import type { ModelGateway } from "../../models/gateway/types.js";
import type {
  RepositoryProfile,
  GeneratedTestChange,
  TestGenerationMetrics,
  Evidence,
  Finding,
  RiskAssessment,
  RiskLevel,
  ExecutionProfile,
  ExecutionTargetingMode,
  TestGenerationPlan,
  GeneratedTestProvenance,
} from "../../types/index.js";
import {
  GeneratedTestProposalSchema,
  TestGenerationPlanSchema,
} from "../../types/index.js";
import type { ExecutionController } from "../../execution/index.js";
import type {
  CommandProposal,
  ExecutionContext,
} from "../../execution/index.js";
import { createExecutionEvidence } from "../../execution/index.js";
import { buildTestContext } from "./test-context-builder.js";
import {
  RepositoryWriteController,
  type WriteContext,
} from "./write-controller.js";
import {
  buildTestGenerationTask,
  type TestGenerationDecision,
} from "../../prompts/test-generation/v1.js";
import {
  resolveFocusedTestCommand,
  type FocusedTestResolution,
} from "./focused-test-resolver.js";
import {
  investigateGeneratedTestFailure,
  type GeneratedTestFailureContext,
} from "./generated-test-investigator.js";
import { validateRelativeImports } from "./import-validator.js";
import type { Logger } from "../../logging/index.js";
import { createExecutionId } from "../../logging/index.js";
import type { BudgetManager } from "../orchestrator/budget-manager.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TestGenerationOptions {
  gateway: ModelGateway;
  controller: ExecutionController;
  profile: RepositoryProfile;
  riskAssessment: RiskAssessment;
  gaps: {
    area: string;
    description: string;
    reason: string;
    risk: RiskLevel;
  }[];
  findings: Finding[];
  evidence: Evidence[];
  requirements: { id: string; description: string }[];
  executionProfile: ExecutionProfile;
  repositoryPath: string;
  maxGeneratedTests: number;
  changedFiles?: string[];
  budget?: BudgetManager;
  logger?: Logger;
}

export interface TestGenerationResult {
  changes: GeneratedTestChange[];
  newEvidence: Evidence[];
  newFindings: Finding[];
  metrics: TestGenerationMetrics;
  investigativeFiles: string[];
  validatedPlans: TestGenerationPlan[];
}

export async function generateAndExecuteTests(
  options: TestGenerationOptions,
): Promise<TestGenerationResult> {
  const startTime = Date.now();
  const writeController = new RepositoryWriteController();
  const metrics: TestGenerationMetrics = {
    generationAttempts: 0,
    testsGenerated: 0,
    testsExecuted: 0,
    testsPassing: 0,
    testsFailing: 0,
    testsRejected: 0,
    permanentTestsRetained: 0,
    candidateTestsRetained: 0,
    investigativeTestsRemoved: 0,
    testDefectTestsRemoved: 0,
    modelCalls: 0,
    durationMs: 0,
  };

  const changes: GeneratedTestChange[] = [];
  const newEvidence: Evidence[] = [];
  const newFindings: Finding[] = [];
  const investigativeFiles: string[] = [];
  const testDefectFiles: string[] = [];
  const validatedPlans: TestGenerationPlan[] = [];

  const testContext = buildTestContext(
    options.profile,
    options.gaps.map((g) => g.description).join("; "),
    options.changedFiles,
  );

  const task = buildTestGenerationTask(
    {
      requirements: options.requirements,
      gaps: options.gaps.map((g) => ({
        area: g.area,
        description: g.description,
        risk: g.risk,
      })),
      findings: options.findings.map((f) => ({
        id: f.id,
        category: f.category,
        title: f.title,
      })),
      testContext: {
        testFramework: testContext.testFramework,
        conventions: testContext.conventions,
        relatedTestFiles: testContext.relatedTestFiles.map((f) => ({
          path: f.path,
          content: f.content,
        })),
      },
      riskLevel: options.riskAssessment.level,
      changedFiles: options.changedFiles,
      relevantSourcePaths: testContext.relevantSourcePaths,
      profile: options.executionProfile,
    },
    options.maxGeneratedTests,
  );

  metrics.generationAttempts++;
  metrics.modelCalls++;

  let decision: TestGenerationDecision;
  try {
    const result = await options.gateway.reason(task);
    decision = result.data;
  } catch (err) {
    options.logger?.warn("Test generation model call failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    metrics.durationMs = Date.now() - startTime;
    return {
      changes,
      newEvidence,
      newFindings,
      metrics,
      investigativeFiles,
      validatedPlans,
    };
  }

  if (!decision.shouldGenerate || decision.proposals.length === 0) {
    options.logger?.info("Test generation not justified", {
      reason: decision.reason,
    });
    metrics.durationMs = Date.now() - startTime;
    return {
      changes,
      newEvidence,
      newFindings,
      metrics,
      investigativeFiles,
      validatedPlans,
    };
  }

  // Validate structured plans
  for (const rawPlan of decision.plans ?? []) {
    const planResult = TestGenerationPlanSchema.safeParse(rawPlan);
    if (planResult.success) {
      validatedPlans.push(planResult.data);
    } else {
      options.logger?.warn("Invalid generation plan from model", {
        errors: planResult.error.issues.map((i) => i.message),
      });
    }
  }

  // Resolve focused test command
  const focusedResolution = resolveFocusedTestCommand(
    "",
    options.profile,
    options.profile.commands,
  );

  const writeContext: WriteContext = {
    repositoryRoot: options.repositoryPath,
    testDirectories: testContext.conventions
      ? [testContext.conventions.testDirectory]
      : undefined,
    filesWrittenThisCycle: 0,
  };

  const proposals = decision.proposals.slice(0, options.maxGeneratedTests);

  for (const rawProposal of proposals) {
    const parseResult = GeneratedTestProposalSchema.safeParse(rawProposal);
    if (!parseResult.success) {
      options.logger?.warn("Invalid test proposal from model", {
        errors: parseResult.error.issues.map((i) => i.message),
      });
      metrics.testsRejected++;
      continue;
    }

    const proposal = parseResult.data;

    // Extract requirement IDs from proposal or plan
    const proposalReqIds: string[] =
      (rawProposal as { requirementIds?: string[] }).requirementIds ?? [];
    const planIndex = (rawProposal as { planIndex?: number }).planIndex;
    const linkedPlan =
      planIndex !== undefined ? validatedPlans[planIndex] : undefined;
    const effectiveReqIds =
      proposalReqIds.length > 0
        ? proposalReqIds
        : (linkedPlan?.requirementIds ?? []);

    const writeResult = writeController.applyTestChange(proposal, writeContext);

    const changeId = `gen-${createExecutionId()}`;
    const change: GeneratedTestChange = {
      id: changeId,
      filePath: writeResult.filePath,
      operation: proposal.operation,
      classification: proposal.classification,
      rationale: proposal.rationale,
      writeOutcome: writeResult.outcome,
      beforeHash: writeResult.beforeHash,
      afterHash: writeResult.afterHash,
      retained: false,
      requirementIds: effectiveReqIds,
      planObjective: linkedPlan?.objective,
      framework: focusedResolution.framework,
    };

    if (writeResult.outcome !== "APPLIED") {
      options.logger?.warn("Test write denied", {
        path: writeResult.filePath,
        outcome: writeResult.outcome,
        reason: writeResult.reason,
      });
      metrics.testsRejected++;
      changes.push(change);
      continue;
    }

    writeContext.filesWrittenThisCycle++;
    metrics.testsGenerated++;

    if (proposal.classification === "INVESTIGATIVE") {
      investigativeFiles.push(writeResult.filePath);
    }

    // Static import validation before execution
    const importValidation = validateRelativeImports(
      proposal.content,
      writeResult.filePath,
      options.repositoryPath,
    );

    if (!importValidation.valid) {
      options.logger?.warn("Generated test has unresolved imports", {
        testFile: writeResult.filePath,
        unresolvedImports: importValidation.unresolvedImports.map(
          (u) => u.specifier,
        ),
      });

      change.failureClassification = "TEST_DEFECT";
      change.executionTargetingMode = "UNVERIFIED";

      const provenance: GeneratedTestProvenance = {
        generatedTestId: changeId,
        generatedFilePath: writeResult.filePath,
        failureClassification: "TEST_DEFECT",
        assertionsExecuted: false,
      };

      const diagnosticEvidence: Evidence = {
        id: `gentest-import-${createExecutionId()}`,
        type: "TEST_RESULT",
        provenance: "executed",
        timestamp: new Date().toISOString(),
        source: `generated-test:${writeResult.filePath}`,
        status: "INCONCLUSIVE",
        summary: `Generated test has unresolved imports: ${importValidation.unresolvedImports.map((u) => u.specifier).join(", ")}`,
        details: {
          unresolvedImports: importValidation.unresolvedImports,
          reason: "Static import validation failed before execution",
        },
        relatedRequirementIds: effectiveReqIds,
        generatedTestProvenance: provenance,
      };

      change.executionEvidenceId = diagnosticEvidence.id;
      newEvidence.push(diagnosticEvidence);
      metrics.testsFailing++;

      testDefectFiles.push(writeResult.filePath);
      changes.push(change);
      continue;
    }

    // Execute using focused resolver targeting the generated test
    const fileResolution = resolveFocusedTestCommand(
      writeResult.filePath,
      options.profile,
      options.profile.commands,
    );

    const { evidence: execEvidence, targetingMode } =
      await executeGeneratedTestFocused(
        options.controller,
        options.profile,
        options.repositoryPath,
        writeResult.filePath,
        fileResolution,
        options.budget,
        options.logger,
      );

    change.executionTargetingMode = targetingMode;

    if (execEvidence) {
      execEvidence.relatedRequirementIds = effectiveReqIds;

      // Attach generated-test provenance
      execEvidence.generatedTestProvenance = {
        generatedTestId: changeId,
        generatedFilePath: writeResult.filePath,
      };

      metrics.testsExecuted++;
      change.executionEvidenceId = execEvidence.id;
      newEvidence.push(execEvidence);

      if (execEvidence.status === "PASS") {
        metrics.testsPassing++;
      } else if (execEvidence.status === "FAIL") {
        metrics.testsFailing++;

        // Investigate generated-test failure
        let testContent = "";
        try {
          testContent = readFileSync(
            resolve(options.repositoryPath, writeResult.filePath),
            "utf-8",
          );
        } catch {
          /* file may already be cleaned up */
        }

        const investigationCtx: GeneratedTestFailureContext = {
          generatedTestId: changeId,
          generatedFilePath: writeResult.filePath,
          testContent,
          executionEvidence: execEvidence,
          requirementIds: effectiveReqIds,
          classification: proposal.classification,
        };

        const investigation = investigateGeneratedTestFailure(investigationCtx);
        change.failureClassification = investigation.failureClassification;

        // Propagate failure classification into evidence provenance
        execEvidence.generatedTestProvenance!.failureClassification =
          investigation.failureClassification;

        const assertionsExecuted = !looksLikeLoadFailure(execEvidence);
        execEvidence.generatedTestProvenance!.assertionsExecuted =
          assertionsExecuted;

        // TEST_DEFECT: mark evidence INCONCLUSIVE for product-verdict purposes
        if (investigation.failureClassification === "TEST_DEFECT") {
          execEvidence.status = "INCONCLUSIVE";
          testDefectFiles.push(writeResult.filePath);
        }

        if (investigation.finding) {
          newFindings.push(investigation.finding);
        }
      }
    } else {
      change.executionTargetingMode = "UNVERIFIED";
    }

    // Retention (may be overridden below for TEST_DEFECT)
    if (proposal.classification === "PERMANENT_REGRESSION") {
      change.retained = true;
      metrics.permanentTestsRetained++;
    } else if (proposal.classification === "CANDIDATE") {
      change.retained = true;
      metrics.candidateTestsRetained++;
    }

    changes.push(change);
  }

  // Cleanup investigative files
  for (const investigativeFile of investigativeFiles) {
    writeController.removeFile(investigativeFile, options.repositoryPath);
    metrics.investigativeTestsRemoved++;
    const change = changes.find((c) => c.filePath === investigativeFile);
    if (change) change.retained = false;
  }

  // Cleanup TEST_DEFECT files — execution facts override model classification
  for (const defectFile of testDefectFiles) {
    if (investigativeFiles.includes(defectFile)) continue;
    writeController.removeFile(defectFile, options.repositoryPath);
    metrics.testDefectTestsRemoved++;
    const change = changes.find((c) => c.filePath === defectFile);
    if (change) {
      if (change.retained) {
        if (change.classification === "PERMANENT_REGRESSION") {
          metrics.permanentTestsRetained = Math.max(
            0,
            metrics.permanentTestsRetained - 1,
          );
        } else if (change.classification === "CANDIDATE") {
          metrics.candidateTestsRetained = Math.max(
            0,
            metrics.candidateTestsRetained - 1,
          );
        }
      }
      change.retained = false;
    }
  }

  metrics.durationMs = Date.now() - startTime;
  return {
    changes,
    newEvidence,
    newFindings,
    metrics,
    investigativeFiles,
    validatedPlans,
  };
}

function looksLikeLoadFailure(evidence: Evidence): boolean {
  const output = String(evidence.summary ?? "").toLowerCase();
  const details = String(
    typeof evidence.details === "string" ? evidence.details : "",
  ).toLowerCase();
  const combined = output + " " + details;

  return (
    combined.includes("cannot find module") ||
    combined.includes("modulenotfounderror") ||
    combined.includes("importerror") ||
    combined.includes("failed to load") ||
    combined.includes("syntaxerror") ||
    combined.includes("is not defined") ||
    combined.includes("is not a function")
  );
}

async function executeGeneratedTestFocused(
  controller: ExecutionController,
  profile: RepositoryProfile,
  repositoryPath: string,
  testFilePath: string,
  resolution: FocusedTestResolution,
  budget?: BudgetManager,
  logger?: Logger,
): Promise<{
  evidence: Evidence | null;
  targetingMode: ExecutionTargetingMode;
}> {
  if (resolution.status === "SUPPORTED" && resolution.executable) {
    if (budget && !budget.canAffordOptionalExecution()) {
      logger?.warn("Skipping focused test execution — verdict reserve", {
        testFile: testFilePath,
      });
      return { evidence: null, targetingMode: "UNVERIFIED" };
    }

    const timeoutMs = budget
      ? budget.optionalExecutionTimeoutMs(60_000)
      : 60_000;
    if (timeoutMs <= 0) {
      logger?.warn("Skipping focused test execution — no time available", {
        testFile: testFilePath,
      });
      return { evidence: null, targetingMode: "UNVERIFIED" };
    }

    const proposal: CommandProposal = {
      executable: resolution.executable,
      args: [...(resolution.args ?? [])],
      workingDirectory: repositoryPath,
      timeoutMs,
      purpose: `Focused execution of generated test: ${testFilePath}`,
      mutability: "READ_ONLY",
      network: "ALLOWED",
    };

    const execCtx: ExecutionContext = {
      repositoryRoot: repositoryPath,
      executionMode: "local",
      secrets: [],
      maxOutputBytes: 1_048_576,
    };

    try {
      const { result } = await controller.execute(proposal, execCtx);
      const evidence = createExecutionEvidence(result, "TEST");
      evidence.source = `generated-test:${testFilePath}`;
      return { evidence, targetingMode: "TARGETED" };
    } catch (err) {
      logger?.warn("Focused generated test execution failed", {
        testFile: testFilePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return { evidence: null, targetingMode: "UNVERIFIED" };
    }
  }

  // Framework does not support focused execution — mark as UNVERIFIED
  logger?.warn("Focused execution unsupported for generated test", {
    testFile: testFilePath,
    reason: resolution.reason,
  });
  return { evidence: null, targetingMode: "UNVERIFIED" };
}
