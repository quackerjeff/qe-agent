import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ProviderAttemptDiagnostic {
  role: string;
  attemptIndex: number;
  timeoutMs: number;
  remainingMs: number;
  callDeadlineReserveMs: number;
  startedAt: string;
  durationMs: number;
  success: boolean;
  errorClass?: string;
  errorMessage?: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  retryAttempted: boolean;
  retryAdmitted?: boolean;
}

export interface GapChunkDiagnostic {
  chunkIndex: number;
  requestedRequirementIds: string[];
  success: boolean;
  rawAssessments?: Array<{
    requirementId: string;
    status: string;
    evidenceIds: string[];
    explanation: string;
  }>;
  rawGaps?: Array<{
    area: string;
    description: string;
    reason: string;
    risk: string;
  }>;
  errorClass?: string;
  errorMessage?: string;
}

export interface RunDiagnostics {
  executionId: string;
  timestamp: string;
  providerAttempts: ProviderAttemptDiagnostic[];
  gapChunks: GapChunkDiagnostic[];
}

export async function persistDiagnostics(
  diagnostics: RunDiagnostics,
  repoPath: string,
  knownSecrets: string[],
): Promise<string> {
  const runDir = join(repoPath, ".qe", "runs", diagnostics.executionId);
  await mkdir(runDir, { recursive: true });

  let content = JSON.stringify(diagnostics, null, 2);

  for (const secret of knownSecrets) {
    if (secret.length >= 4) {
      while (content.includes(secret)) {
        content = content.replace(secret, "***");
      }
    }
  }

  const path = join(runDir, "diagnostics.json");
  await writeFile(path, content, "utf-8");
  return path;
}
