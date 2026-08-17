import type { ModelGateway, ModelResult } from "../../models/gateway/types.js";
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

export async function analyzeGaps(
  gateway: ModelGateway,
  requirements: Requirement[],
  evidence: Evidence[],
  findings: Finding[],
  riskAssessment: RiskAssessment,
  changeData?: Record<string, unknown>,
): Promise<GapAnalysisResult> {
  const task = buildGapAnalysisTask(
    requirements.map((r) => ({
      id: r.id,
      description: r.description,
      acceptanceCriteria: r.acceptanceCriteria,
    })),
    evidence.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      summary: e.summary,
    })),
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
