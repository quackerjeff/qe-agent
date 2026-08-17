import type { ModelGateway, ModelResult } from "../../models/gateway/types.js";
import type { ChangeAnalysis } from "../../types/index.js";
import type { ReasoningContext } from "../orchestrator/context-builder.js";
import type { GitDiffData } from "../git/index.js";
import {
  buildChangeAnalysisTask,
  type ChangeAnalysisOutput,
} from "../../prompts/change-analysis/v1.js";

export function buildDeterministicChangeAnalysis(
  diffData: GitDiffData,
): ChangeAnalysis {
  return {
    summary: `${diffData.changedFiles.length} files changed between ${diffData.baselineRef.slice(0, 8)} and ${diffData.targetRef.slice(0, 8)}`,
    changedFiles: diffData.changedFiles.map((f) => ({
      path: f.path,
      changeType: f.changeType,
      oldPath: f.oldPath,
    })),
    affectedComponents: [],
    behaviorChanges: [],
    potentialBlastRadius: [],
    unknowns: [],
  };
}

export async function analyzeChange(
  gateway: ModelGateway,
  ctx: ReasoningContext,
  diffData: GitDiffData,
): Promise<{
  analysis: ChangeAnalysis;
  modelResult: ModelResult<ChangeAnalysisOutput>;
}> {
  const deterministic = buildDeterministicChangeAnalysis(diffData);

  const task = buildChangeAnalysisTask(ctx);
  const modelResult = await gateway.reason(task);
  const inferred = modelResult.data;

  const analysis: ChangeAnalysis = {
    ...deterministic,
    affectedComponents: inferred.affectedComponents,
    behaviorChanges: inferred.behaviorChanges,
    potentialBlastRadius: inferred.potentialBlastRadius,
    unknowns: inferred.unknowns,
    summary: inferred.summary || deterministic.summary,
  };

  return { analysis, modelResult };
}
