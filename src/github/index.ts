export {
  GitHubContextSchema,
  VERDICT_TO_CHECK,
  type GitHubContext,
  type GitHubCheckConclusion,
  type CheckPublishRequest,
  type CheckPublishResponse,
  type IssueCreateRequest,
  type IssueCreateResponse,
  type IssueSearchResult,
  type GitHubPublishingResult,
  type IssueProposal,
} from "./types.js";

export {
  type GitHubClient,
  FakeGitHubClient,
  GitHubApiError,
  type RecordedCheck,
  type RecordedIssueSearch,
  type RecordedIssueCreate,
} from "./client.js";

export {
  type EnvironmentSource,
  ProcessEnvironmentSource,
  FakeEnvironmentSource,
  isGitHubActions,
  parseGitHubContext,
  getGitHubToken,
} from "./environment.js";

export {
  mapVerdictToConclusion,
  shouldFailCi,
  getCiExitCode,
} from "./verdict.js";

export {
  computeFingerprint,
  formatFingerprintMarker,
  isEligibleForIssue,
  proposeIssues,
  publishIssues,
  type IssueEligibilityConfig,
} from "./issues.js";

export { renderWorkflowSummary } from "./summary.js";

export {
  GitHubReporter,
  type GitHubReporterConfig,
  validateResultForPublishing,
  persistResult,
  persistSummary,
} from "./reporter.js";

export {
  HttpGitHubClient,
  DEFAULT_HTTP_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  type HttpRequestFn,
} from "./http-client.js";

export { writeStepSummary, type StepSummaryResult } from "./step-summary.js";
