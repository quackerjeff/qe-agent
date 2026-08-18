import { z } from "zod";
import type { Verdict } from "../types/domain.js";

export const GitHubContextSchema = z.object({
  repositoryOwner: z.string().min(1),
  repositoryName: z.string().min(1),
  eventName: z.string().min(1),
  runId: z.string().min(1),
  workflow: z.string().min(1),
  sha: z.string().min(1),
  ref: z.string().min(1),
  baseSha: z.string().optional(),
  headSha: z.string().optional(),
  pullRequestNumber: z.number().positive().optional(),
  serverUrl: z.string().default("https://github.com"),
  apiUrl: z.string().default("https://api.github.com"),
});

export type GitHubContext = z.infer<typeof GitHubContextSchema>;

export type GitHubCheckConclusion =
  "success" | "neutral" | "failure" | "action_required";

export const VERDICT_TO_CHECK: Record<Verdict, GitHubCheckConclusion> = {
  PASS: "success",
  PASS_WITH_CONCERNS: "success",
  NEEDS_REVIEW: "neutral",
  FAIL: "failure",
  BLOCKED: "action_required",
};

export interface CheckPublishRequest {
  owner: string;
  repo: string;
  headSha: string;
  name: string;
  conclusion: GitHubCheckConclusion;
  title: string;
  summary: string;
  text?: string;
}

export interface CheckPublishResponse {
  id: number;
  url: string;
}

export interface IssueCreateRequest {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
}

export interface IssueCreateResponse {
  number: number;
  url: string;
}

export interface IssueSearchResult {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface GitHubPublishingResult {
  checkPublished: boolean;
  checkUrl?: string;
  issuesProposed: number;
  issuesCreated: number;
  issuesSkippedDuplicate: number;
  issuesSkippedIneligible: number;
  publishingWarnings: string[];
  dryRun: boolean;
}

export interface IssueProposal {
  findingId: string;
  title: string;
  body: string;
  labels: string[];
  fingerprint: string;
  eligible: boolean;
  ineligibleReason?: string;
}
