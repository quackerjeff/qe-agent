import type {
  CheckPublishRequest,
  CheckPublishResponse,
  IssueCreateRequest,
  IssueCreateResponse,
  IssueSearchResult,
} from "./types.js";

export interface GitHubClient {
  createCheck(request: CheckPublishRequest): Promise<CheckPublishResponse>;
  findOpenIssueByFingerprint(
    owner: string,
    repo: string,
    fingerprint: string,
  ): Promise<IssueSearchResult | null>;
  createIssue(request: IssueCreateRequest): Promise<IssueCreateResponse>;
}

export interface RecordedCheck {
  request: CheckPublishRequest;
  response: CheckPublishResponse;
}

export interface RecordedIssueSearch {
  owner: string;
  repo: string;
  fingerprint: string;
  result: IssueSearchResult | null;
}

export interface RecordedIssueCreate {
  request: IssueCreateRequest;
  response: IssueCreateResponse;
}

export class FakeGitHubClient implements GitHubClient {
  public checks: RecordedCheck[] = [];
  public issueSearches: RecordedIssueSearch[] = [];
  public issueCreations: RecordedIssueCreate[] = [];
  public existingIssues: IssueSearchResult[] = [];
  public shouldFailCheck = false;
  public shouldFailIssueCreate = false;
  public shouldRateLimit = false;
  public failureError?: Error;

  private checkIdCounter = 1;
  private issueNumberCounter = 100;

  async createCheck(
    request: CheckPublishRequest,
  ): Promise<CheckPublishResponse> {
    if (this.shouldRateLimit) {
      throw new GitHubApiError("API rate limit exceeded", 403, true);
    }
    if (this.shouldFailCheck) {
      throw (
        this.failureError ??
        new GitHubApiError("Check creation failed", 500, false)
      );
    }

    const response: CheckPublishResponse = {
      id: this.checkIdCounter++,
      url: `https://github.com/${request.owner}/${request.repo}/runs/${this.checkIdCounter - 1}`,
    };
    this.checks.push({ request, response });
    return response;
  }

  async findOpenIssueByFingerprint(
    owner: string,
    repo: string,
    fingerprint: string,
  ): Promise<IssueSearchResult | null> {
    if (this.shouldRateLimit) {
      throw new GitHubApiError("API rate limit exceeded", 403, true);
    }

    const match =
      this.existingIssues.find((i) => i.body.includes(fingerprint)) ?? null;
    this.issueSearches.push({ owner, repo, fingerprint, result: match });
    return match;
  }

  async createIssue(request: IssueCreateRequest): Promise<IssueCreateResponse> {
    if (this.shouldRateLimit) {
      throw new GitHubApiError("API rate limit exceeded", 403, true);
    }
    if (this.shouldFailIssueCreate) {
      throw (
        this.failureError ??
        new GitHubApiError("Issue creation failed", 500, false)
      );
    }

    const response: IssueCreateResponse = {
      number: this.issueNumberCounter++,
      url: `https://github.com/${request.owner}/${request.repo}/issues/${this.issueNumberCounter - 1}`,
    };
    this.issueCreations.push({ request, response });
    return response;
  }
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly isRateLimit: boolean,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}
