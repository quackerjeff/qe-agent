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
import type { Logger } from "../../logging/index.js";
import { createExecutionId } from "../../logging/index.js";
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
    modelCalls: 0,
    durationMs: 0,
  };

  const changes: GeneratedTestChange[] = [];
  const newEvidence: Evidence[] = [];
  const newFindings: Finding[] = [];
  const investigativeFiles: string[] = [];
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
        options.logger,
      );

    change.executionTargetingMode = targetingMode;

    if (execEvidence) {
      execEvidence.relatedRequirementIds = effectiveReqIds;
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

        if (investigation.finding) {
          newFindings.push(investigation.finding);
        }
      }
    } else {
      change.executionTargetingMode = "UNVERIFIED";
    }

    // Retention
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

async function executeGeneratedTestFocused(
  controller: ExecutionController,
  profile: RepositoryProfile,
  repositoryPath: string,
  testFilePath: string,
  resolution: FocusedTestResolution,
  logger?: Logger,
): Promise<{
  evidence: Evidence | null;
  targetingMode: ExecutionTargetingMode;
}> {
  if (resolution.status === "SUPPORTED" && resolution.executable) {
    const proposal: CommandProposal = {
      executable: resolution.executable,
      args: [...(resolution.args ?? [])],
      workingDirectory: repositoryPath,
      timeoutMs: 60_000,
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
