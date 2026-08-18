import { GitHubContextSchema, type GitHubContext } from "./types.js";

export interface EnvironmentSource {
  get(key: string): string | undefined;
}

export class ProcessEnvironmentSource implements EnvironmentSource {
  get(key: string): string | undefined {
    return process.env[key];
  }
}

export class FakeEnvironmentSource implements EnvironmentSource {
  constructor(private readonly vars: Record<string, string> = {}) {}

  get(key: string): string | undefined {
    return this.vars[key];
  }
}

export function isGitHubActions(env: EnvironmentSource): boolean {
  return env.get("GITHUB_ACTIONS") === "true";
}

export function parseGitHubContext(
  env: EnvironmentSource,
): GitHubContext | null {
  const repository = env.get("GITHUB_REPOSITORY");
  if (!repository) return null;

  const [owner, name] = repository.split("/");
  if (!owner || !name) return null;

  const eventName = env.get("GITHUB_EVENT_NAME");
  const runId = env.get("GITHUB_RUN_ID");
  const workflow = env.get("GITHUB_WORKFLOW");
  const sha = env.get("GITHUB_SHA");
  const ref = env.get("GITHUB_REF");

  if (!eventName || !runId || !workflow || !sha || !ref) return null;

  const raw: Record<string, unknown> = {
    repositoryOwner: owner,
    repositoryName: name,
    eventName,
    runId,
    workflow,
    sha,
    ref,
  };

  const baseSha = env.get("GITHUB_BASE_REF_SHA") ?? env.get("QE_BASE_SHA");
  if (baseSha) raw.baseSha = baseSha;

  const headSha = env.get("GITHUB_HEAD_REF_SHA") ?? env.get("QE_HEAD_SHA");
  if (headSha) raw.headSha = headSha;

  const prNumber = env.get("QE_PR_NUMBER");
  if (prNumber) {
    const parsed = parseInt(prNumber, 10);
    if (!isNaN(parsed) && parsed > 0) raw.pullRequestNumber = parsed;
  }

  const serverUrl = env.get("GITHUB_SERVER_URL");
  if (serverUrl) raw.serverUrl = serverUrl;

  const apiUrl = env.get("GITHUB_API_URL");
  if (apiUrl) raw.apiUrl = apiUrl;

  const result = GitHubContextSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function getGitHubToken(env: EnvironmentSource): string | undefined {
  return env.get("GITHUB_TOKEN");
}
