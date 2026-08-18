import type {
  CheckPublishRequest,
  CheckPublishResponse,
  IssueCreateRequest,
  IssueCreateResponse,
  IssueSearchResult,
} from "./types.js";
import type { GitHubClient } from "./client.js";
import { GitHubApiError } from "./client.js";

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

export interface HttpRequestFn {
  (
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      timeoutMs?: number;
      maxResponseBytes?: number;
    },
  ): Promise<{ status: number; json(): Promise<unknown> }>;
}

async function nodeFetch(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
  },
): Promise<{ status: number; json(): Promise<unknown> }> {
  const { request } = await import("node:https");
  const { URL } = await import("node:url");

  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            res.destroy();
            req.destroy();
            reject(new Error(`Response body exceeded ${maxBytes} bytes limit`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            json: () => Promise.resolve(JSON.parse(body)),
          });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export class HttpGitHubClient implements GitHubClient {
  private readonly token: string;
  private readonly apiUrl: string;
  private readonly httpRequest: HttpRequestFn;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(
    token: string,
    apiUrl: string = "https://api.github.com",
    httpRequest?: HttpRequestFn,
    timeoutMs?: number,
    maxResponseBytes?: number,
  ) {
    this.token = token;
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.httpRequest = httpRequest ?? nodeFetch;
    this.timeoutMs = timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    this.maxResponseBytes = maxResponseBytes ?? MAX_RESPONSE_BYTES;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "qe-agent",
    };
  }

  async createCheck(
    request: CheckPublishRequest,
  ): Promise<CheckPublishResponse> {
    const url = `${this.apiUrl}/repos/${request.owner}/${request.repo}/check-runs`;
    const body = JSON.stringify({
      name: request.name,
      head_sha: request.headSha,
      status: "completed",
      conclusion: request.conclusion,
      output: {
        title: request.title,
        summary: request.summary,
        text: request.text,
      },
    });

    try {
      const res = await this.httpRequest(url, {
        method: "POST",
        headers: this.headers(),
        body,
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
      });

      if (res.status === 403 || res.status === 429) {
        throw new GitHubApiError("API rate limit exceeded", res.status, true);
      }

      if (res.status < 200 || res.status >= 300) {
        throw new GitHubApiError(
          `Check creation failed with status ${res.status}`,
          res.status,
          false,
        );
      }

      const data = (await res.json()) as { id: number; html_url: string };
      return { id: data.id, url: data.html_url };
    } catch (err) {
      if (err instanceof GitHubApiError) throw err;
      throw new GitHubApiError(
        err instanceof Error ? err.message : "HTTP request failed",
        0,
        false,
      );
    }
  }

  async findOpenIssueByFingerprint(
    owner: string,
    repo: string,
    fingerprint: string,
  ): Promise<IssueSearchResult | null> {
    const query = encodeURIComponent(
      `repo:${owner}/${repo} is:issue is:open "qe-fingerprint:${fingerprint}"`,
    );
    const url = `${this.apiUrl}/search/issues?q=${query}&per_page=1`;

    try {
      const res = await this.httpRequest(url, {
        method: "GET",
        headers: this.headers(),
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
      });

      if (res.status === 403 || res.status === 429) {
        throw new GitHubApiError("API rate limit exceeded", res.status, true);
      }

      if (res.status < 200 || res.status >= 300) {
        throw new GitHubApiError(
          `Issue search failed with status ${res.status}`,
          res.status,
          false,
        );
      }

      const data = (await res.json()) as {
        items: Array<{
          number: number;
          title: string;
          body: string;
          html_url: string;
        }>;
      };

      if (data.items.length === 0) return null;

      const item = data.items[0];
      return {
        number: item.number,
        title: item.title,
        body: item.body,
        url: item.html_url,
      };
    } catch (err) {
      if (err instanceof GitHubApiError) throw err;
      throw new GitHubApiError(
        err instanceof Error ? err.message : "HTTP request failed",
        0,
        false,
      );
    }
  }

  async createIssue(request: IssueCreateRequest): Promise<IssueCreateResponse> {
    const url = `${this.apiUrl}/repos/${request.owner}/${request.repo}/issues`;
    const body = JSON.stringify({
      title: request.title,
      body: request.body,
      labels: request.labels,
    });

    try {
      const res = await this.httpRequest(url, {
        method: "POST",
        headers: this.headers(),
        body,
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
      });

      if (res.status === 403 || res.status === 429) {
        throw new GitHubApiError("API rate limit exceeded", res.status, true);
      }

      if (res.status < 200 || res.status >= 300) {
        throw new GitHubApiError(
          `Issue creation failed with status ${res.status}`,
          res.status,
          false,
        );
      }

      const data = (await res.json()) as { number: number; html_url: string };
      return { number: data.number, url: data.html_url };
    } catch (err) {
      if (err instanceof GitHubApiError) throw err;
      throw new GitHubApiError(
        err instanceof Error ? err.message : "HTTP request failed",
        0,
        false,
      );
    }
  }
}
