import type { ModelGateway, ModelResult } from "../../models/gateway/types.js";
import type { RiskAssessment } from "../../types/index.js";
import type { ReasoningContext } from "../orchestrator/context-builder.js";
import type { ChangeAnalysis } from "../../types/index.js";
import {
  buildRiskAnalysisTask,
  type RiskAnalysisOutput,
} from "../../prompts/risk-analysis/v1.js";

export async function assessRisk(
  gateway: ModelGateway,
  ctx: ReasoningContext,
  changeAnalysis?: ChangeAnalysis,
): Promise<{
  assessment: RiskAssessment;
  modelResult: ModelResult<RiskAnalysisOutput>;
}> {
  const task = buildRiskAnalysisTask(
    ctx,
    changeAnalysis
      ? {
          summary: changeAnalysis.summary,
          affectedComponents: changeAnalysis.affectedComponents,
          behaviorChanges: changeAnalysis.behaviorChanges.map((b) => ({
            description: b.description,
            risk: b.risk,
          })),
        }
      : undefined,
  );

  const modelResult = await gateway.reason(task);

  const assessment: RiskAssessment = {
    level: modelResult.data.level,
    factors: modelResult.data.factors,
    confidence: modelResult.data.confidence,
    summary: modelResult.data.summary,
  };

  return { assessment, modelResult };
}
