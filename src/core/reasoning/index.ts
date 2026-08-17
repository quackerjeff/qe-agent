export {
  analyzeChange,
  buildDeterministicChangeAnalysis,
} from "./change-analyzer.js";
export { assessRisk } from "./risk-assessor.js";
export { planValidation, applyProfileLimits } from "./validation-planner.js";
export {
  investigateFailure,
  classifyWithBaseline,
} from "./failure-investigator.js";
export type {
  FailureInvestigationResult,
  BaselineComparisonResult,
} from "./failure-investigator.js";
export { analyzeGaps } from "./gap-analyzer.js";
export type { GapAnalysisResult } from "./gap-analyzer.js";
export { produceVerdict } from "./verdict-engine.js";
export type { VerdictResult } from "./verdict-engine.js";
