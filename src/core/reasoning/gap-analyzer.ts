import type { ModelGateway, ModelResult } from "../../models/gateway/types.js";
import { SchemaValidationError } from "../../models/gateway/types.js";
import type {
  RequirementAssessment,
  Requirement,
  Evidence,
  Finding,
  RiskLevel,
} from "../../types/index.js";
import type { RiskAssessment } from "../../types/index.js";
import {
  buildGapAnalysisTask,
  type GapAnalysisOutput,
} from "../../prompts/gap-analysis/v1.js";
import { buildEvidenceClassificationMap } from "./verdict-engine.js";
import { projectEvidenceForModel } from "../orchestrator/evidence-projection.js";
import { buildCandidateEvidenceMap } from "./evidence-candidates.js";
import type { GapChunkDiagnostic } from "../orchestrator/diagnostics.js";

export const MAX_REQUIREMENTS_PER_GAP_CHUNK = 19;

export interface GapAnalysisResult {
  gaps: {
    area: string;
    description: string;
    reason: string;
    risk: RiskLevel;
  }[];
  requirementAssessments: RequirementAssessment[];
  modelResult: ModelResult<GapAnalysisOutput>;
}

export interface ChunkedGapAnalysisResult {
  gaps: {
    area: string;
    description: string;
    reason: string;
    risk: RiskLevel;
  }[];
  requirementAssessments: RequirementAssessment[];
  chunksAttempted: number;
  chunksSucceeded: number;
  partial: boolean;
  chunkDiagnostics?: GapChunkDiagnostic[];
}

export function chunkRequirements(
  requirements: Requirement[],
  chunkSize: number = MAX_REQUIREMENTS_PER_GAP_CHUNK,
): Requirement[][] {
  if (requirements.length <= chunkSize) return [requirements];
  const chunks: Requirement[][] = [];
  for (let i = 0; i < requirements.length; i += chunkSize) {
    chunks.push(requirements.slice(i, i + chunkSize));
  }
  return chunks;
}

export function mergeGaps(
  allGaps: {
    area: string;
    description: string;
    reason: string;
    risk: RiskLevel;
  }[][],
): { area: string; description: string; reason: string; risk: RiskLevel }[] {
  const riskOrder: Record<string, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  };
  const seen = new Map<
    string,
    { area: string; description: string; reason: string; risk: RiskLevel }
  >();

  for (const gaps of allGaps) {
    for (const gap of gaps) {
      const key = `${gap.area.toLowerCase().trim()}::${gap.description.toLowerCase().trim()}`;
      const existing = seen.get(key);
      if (existing) {
        if ((riskOrder[gap.risk] ?? 0) > (riskOrder[existing.risk] ?? 0)) {
          seen.set(key, gap);
        }
      } else {
        seen.set(key, gap);
      }
    }
  }
  return [...seen.values()];
}

export function buildRequirementCompletenessValidator(
  requestedIds: string[],
): (data: GapAnalysisOutput) => void {
  const requestedSet = new Set(requestedIds);

  return (data: GapAnalysisOutput) => {
    const returnedSet = new Set<string>();
    const duplicates: string[] = [];
    const unknowns: string[] = [];

    for (const a of data.requirementAssessments) {
      if (!requestedSet.has(a.requirementId)) {
        unknowns.push(a.requirementId);
      } else if (returnedSet.has(a.requirementId)) {
        duplicates.push(a.requirementId);
      }
      returnedSet.add(a.requirementId);
    }

    const missing: string[] = [];
    for (const id of requestedIds) {
      if (!returnedSet.has(id)) {
        missing.push(id);
      }
    }

    if (
      missing.length === 0 &&
      duplicates.length === 0 &&
      unknowns.length === 0
    ) {
      return;
    }

    const defects: string[] = [];
    if (missing.length > 0) {
      defects.push(
        `Your response omitted these required requirement IDs: ${missing.join(", ")}`,
      );
    }
    if (duplicates.length > 0) {
      defects.push(
        `Your response contained duplicate assessments for: ${duplicates.join(", ")}`,
      );
    }
    if (unknowns.length > 0) {
      defects.push(
        `Your response contained assessments for unrequested IDs: ${unknowns.join(", ")}`,
      );
    }
    defects.push(
      "Return exactly one assessment for every requested requirement ID.",
    );
    defects.push("Do not omit, duplicate, or introduce requirement IDs.");

    throw new SchemaValidationError(JSON.stringify(data), defects.join("\n"));
  };
}

export async function analyzeGaps(
  gateway: ModelGateway,
  requirements: Requirement[],
  evidence: Evidence[],
  findings: Finding[],
  riskAssessment: RiskAssessment,
  changeData?: Record<string, unknown>,
): Promise<GapAnalysisResult> {
  const classificationMap = buildEvidenceClassificationMap(findings);

  const task = buildGapAnalysisTask(
    requirements.map((r) => ({
      id: r.id,
      description: r.description,
      acceptanceCriteria: r.acceptanceCriteria,
    })),
    projectEvidenceForModel(evidence, classificationMap),
    findings.map((f) => ({
      id: f.id,
      category: f.category,
      title: f.title,
    })),
    {
      level: riskAssessment.level,
      factors: riskAssessment.factors,
    },
    changeData,
  );

  const modelResult = await gateway.reason(task);
  const output = modelResult.data;

  return {
    gaps: output.gaps,
    requirementAssessments: output.requirementAssessments,
    modelResult,
  };
}

export async function analyzeGapsChunked(
  gateway: ModelGateway,
  requirements: Requirement[],
  evidence: Evidence[],
  findings: Finding[],
  riskAssessment: RiskAssessment,
  changeData: Record<string, unknown> | undefined,
  chunksReserved: number,
  onChunkSuccess: () => void,
  onChunkFailure: () => void,
  logger?: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
  },
): Promise<ChunkedGapAnalysisResult> {
  const chunks = chunkRequirements(requirements);

  const allAssessments: RequirementAssessment[] = [];
  const allGaps: {
    area: string;
    description: string;
    reason: string;
    risk: RiskLevel;
  }[][] = [];
  let chunksSucceeded = 0;
  const failedChunkRequirements: Requirement[] = [];
  let totalDuplicateIds = 0;
  let totalUnknownIds = 0;
  const chunkDiagnostics: GapChunkDiagnostic[] = [];

  const classificationMap = buildEvidenceClassificationMap(findings);

  const evidenceContext = projectEvidenceForModel(evidence, classificationMap);
  const findingsContext = findings.map((f) => ({
    id: f.id,
    category: f.category,
    title: f.title,
  }));
  const riskContext = {
    level: riskAssessment.level,
    factors: riskAssessment.factors,
  };

  const passExecutionEvidenceIds = evidence
    .filter((e) => e.provenance === "executed" && e.status === "PASS")
    .map((e) => e.id);

  const candidateMap = buildCandidateEvidenceMap(
    requirements.map((r) => ({
      id: r.id,
      description: r.description,
      acceptanceCriteria: r.acceptanceCriteria,
    })),
    evidenceContext,
  );

  const dispatched = chunks.slice(0, chunksReserved);
  const undispatched = chunks.slice(chunksReserved);

  const promises = dispatched.map(async (chunk, i) => {
    const chunkIds = chunk.map((r) => r.id);
    const task = buildGapAnalysisTask(
      chunk.map((r) => ({
        id: r.id,
        description: r.description,
        acceptanceCriteria: r.acceptanceCriteria,
        candidateEvidenceIds: candidateMap.get(r.id) ?? [],
      })),
      evidenceContext,
      findingsContext,
      riskContext,
      changeData,
    );
    task.validateResult = buildRequirementCompletenessValidator(chunkIds);
    const modelResult = await gateway.reason(task);
    return {
      chunkIndex: i,
      assessments: modelResult.data.requirementAssessments,
      gaps: modelResult.data.gaps,
    };
  });

  const results = await Promise.allSettled(promises);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      chunksSucceeded++;
      onChunkSuccess();
      allGaps.push(result.value.gaps);

      chunkDiagnostics.push({
        chunkIndex: i,
        requestedRequirementIds: dispatched[i].map((r) => r.id),
        success: true,
        rawAssessments: result.value.assessments.map((a) => ({
          requirementId: a.requirementId,
          status: a.status,
          evidenceIds: [...a.evidenceIds],
          explanation: a.explanation,
        })),
        rawGaps: result.value.gaps.map((g) => ({
          area: g.area,
          description: g.description,
          reason: g.reason,
          risk: g.risk,
        })),
      });

      const requestedIds = new Set(dispatched[i].map((r) => r.id));
      const seenIds = new Set<string>();
      const validAssessments: RequirementAssessment[] = [];
      let chunkDuplicates = 0;
      let chunkUnknowns = 0;

      for (const assessment of result.value.assessments) {
        if (!requestedIds.has(assessment.requirementId)) {
          chunkUnknowns++;
          continue;
        }
        if (seenIds.has(assessment.requirementId)) {
          chunkDuplicates++;
          continue;
        }
        seenIds.add(assessment.requirementId);
        validAssessments.push(assessment);
      }

      const missingIds: string[] = [];
      for (const id of requestedIds) {
        if (!seenIds.has(id)) {
          missingIds.push(id);
        }
      }

      if (missingIds.length > 0) {
        for (const id of missingIds) {
          const req = dispatched[i].find((r) => r.id === id);
          if (req) failedChunkRequirements.push(req);
        }
        logger?.warn("Chunk returned incomplete assessments", {
          chunk: i + 1,
          missingCount: missingIds.length,
          missingIds,
        });
      }
      if (chunkDuplicates > 0) {
        totalDuplicateIds += chunkDuplicates;
        logger?.warn("Chunk returned duplicate assessment IDs", {
          chunk: i + 1,
          duplicateCount: chunkDuplicates,
        });
      }
      if (chunkUnknowns > 0) {
        totalUnknownIds += chunkUnknowns;
        logger?.warn("Chunk returned unknown assessment IDs", {
          chunk: i + 1,
          unknownCount: chunkUnknowns,
        });
      }

      allAssessments.push(...validAssessments);
      logger?.info("Gap-analysis chunk completed", {
        chunk: i + 1,
        totalChunks: chunks.length,
        assessments: validAssessments.length,
        requested: requestedIds.size,
      });
    } else {
      onChunkFailure();
      failedChunkRequirements.push(...dispatched[i]);
      chunkDiagnostics.push({
        chunkIndex: i,
        requestedRequirementIds: dispatched[i].map((r) => r.id),
        success: false,
        errorClass:
          result.reason instanceof Error
            ? result.reason.constructor.name
            : "Unknown",
        errorMessage:
          result.reason instanceof Error
            ? result.reason.message.slice(0, 500)
            : String(result.reason).slice(0, 500),
      });
      logger?.warn("Gap-analysis chunk timed out or failed", {
        chunk: i + 1,
        totalChunks: chunks.length,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }

  for (const chunk of undispatched) {
    failedChunkRequirements.push(...chunk);
  }
  if (undispatched.length > 0) {
    logger?.warn("Budget insufficient for remaining gap-analysis chunks", {
      skippedChunks: undispatched.length,
      totalChunks: chunks.length,
    });
  }

  const hasSemanticIssues = totalDuplicateIds > 0 || totalUnknownIds > 0;

  if (failedChunkRequirements.length > 0) {
    for (const r of failedChunkRequirements) {
      allAssessments.push({
        requirementId: r.id,
        status: "NOT_VERIFIED" as const,
        evidenceIds: passExecutionEvidenceIds,
        explanation:
          passExecutionEvidenceIds.length > 0
            ? "Gap analysis timed out; repository-level validation passed but requirement-specific assessment could not be completed"
            : "Gap analysis timed out; no execution evidence available for assessment",
      });
    }
  }

  if (failedChunkRequirements.length > 0 || hasSemanticIssues) {
    const reasonParts: string[] = [];
    if (failedChunkRequirements.length > 0) {
      reasonParts.push(
        `${failedChunkRequirements.length} of ${requirements.length} requirements could not be assessed due to chunk timeout, budget exhaustion, or incomplete model response`,
      );
    }
    if (totalDuplicateIds > 0) {
      reasonParts.push(
        `${totalDuplicateIds} duplicate assessment IDs were detected and deduplicated`,
      );
    }
    if (totalUnknownIds > 0) {
      reasonParts.push(
        `${totalUnknownIds} unknown assessment IDs were excluded`,
      );
    }
    allGaps.push([
      {
        area: "Gap Analysis",
        description:
          "Requirement-to-evidence gap analysis did not complete for all requirement chunks within the execution budget.",
        reason: reasonParts.join("; "),
        risk: "MEDIUM" as const,
      },
    ]);
  }

  const reqOrder = new Map(requirements.map((r, idx) => [r.id, idx]));
  allAssessments.sort(
    (a, b) =>
      (reqOrder.get(a.requirementId) ?? Infinity) -
      (reqOrder.get(b.requirementId) ?? Infinity),
  );

  return {
    gaps: mergeGaps(allGaps),
    requirementAssessments: allAssessments,
    chunksAttempted: chunks.length,
    chunksSucceeded,
    partial: failedChunkRequirements.length > 0 || hasSemanticIssues,
    chunkDiagnostics,
  };
}
