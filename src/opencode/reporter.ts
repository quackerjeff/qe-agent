import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { QEResult } from "../types/index.js";
import { QEResultSchema } from "../types/index.js";
import type { OpenCodeClient } from "./client.js";
import { OpenCodeApiError } from "./client.js";
import type { OpenCodeContext, OpenCodePublishingResult } from "./types.js";
import { mapVerdictToUrgency } from "./verdict.js";
import { renderSessionMessage } from "./summary.js";

export interface OpenCodeReporterConfig {
  toastEnabled: boolean;
  dryRun: boolean;
  maxRetries: number;
}

export class OpenCodeReporter {
  constructor(
    private readonly client: OpenCodeClient,
    private readonly config: OpenCodeReporterConfig,
  ) {}

  async publish(
    result: QEResult,
    context: OpenCodeContext,
    knownSecrets: string[] = [],
  ): Promise<OpenCodePublishingResult> {
    const redact = buildRedactor(knownSecrets);
    const message = renderSessionMessage(result, redact);

    const publishingResult: OpenCodePublishingResult = {
      messageDelivered: false,
      sessionId: context.sessionId,
      warnings: [],
      dryRun: this.config.dryRun,
    };

    if (this.config.dryRun) {
      publishingResult.messageDelivered = true;
      publishingResult.messageId = "(dry-run)";
      return publishingResult;
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.client.sendMessage({
          sessionId: context.sessionId,
          text: message,
        });
        publishingResult.messageDelivered = true;
        publishingResult.messageId = response.messageId;
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof OpenCodeApiError && err.isServerError) {
          continue;
        }
        break;
      }
    }

    if (lastError) {
      publishingResult.warnings.push(
        redact(`Message delivery failed: ${lastError.message}`),
      );
    }

    if (this.config.toastEnabled && !this.config.dryRun) {
      const urgency = mapVerdictToUrgency(result.verdict);
      const toastMessage = `QE Agent: ${result.verdict} (${result.confidence} confidence)`;
      try {
        await this.client.showToast(
          toastMessage,
          urgency === "error" ? "error" : "success",
        );
      } catch (err) {
        publishingResult.warnings.push(
          `Toast notification failed: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    }

    return publishingResult;
  }
}

function buildRedactor(knownSecrets: string[]): (text: string) => string {
  const meaningful = knownSecrets.filter((s) => s.length >= 4);
  if (meaningful.length === 0) return (t) => t;

  return (text: string) => {
    let result = text;
    for (const secret of meaningful) {
      while (result.includes(secret)) {
        result = result.replace(secret, "***");
      }
    }
    return result;
  };
}

export function validateResultForPublishing(json: unknown): QEResult {
  return QEResultSchema.parse(json);
}

export async function persistResult(
  result: QEResult,
  repoPath: string,
): Promise<string> {
  const absRepo = resolve(repoPath);
  const runDir = join(absRepo, ".qe", "runs", result.executionId);
  await mkdir(runDir, { recursive: true });
  const resultPath = join(runDir, "result.json");
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf-8");
  return resultPath;
}

export async function persistSessionMessage(
  result: QEResult,
  repoPath: string,
  knownSecrets: string[] = [],
): Promise<string> {
  const redact = buildRedactor(knownSecrets);
  const message = renderSessionMessage(result, redact);
  const absRepo = resolve(repoPath);
  const runDir = join(absRepo, ".qe", "runs", result.executionId);
  await mkdir(runDir, { recursive: true });
  const messagePath = join(runDir, "opencode-message.md");
  await writeFile(messagePath, message, "utf-8");
  return messagePath;
}
