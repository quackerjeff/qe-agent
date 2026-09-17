import type { QEResult } from "../types/index.js";
import { QEResultSchema } from "../types/index.js";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { redactorFor } from "../core/reporting/index.js";
import type { OpenCodeClient } from "./client.js";
import { OpenCodeApiError } from "./client.js";
import type { OpenCodeContext, OpenCodePublishingResult } from "./types.js";
import { mapVerdictToUrgency } from "./verdict.js";
import { renderSessionMessage } from "./summary.js";

export interface OpenCodeReporterConfig {
  messageEnabled: boolean;
  toastEnabled: boolean;
  dryRun: boolean;
  maxRetries: number;
}

export class OpenCodeReporter {
  constructor(private readonly config: OpenCodeReporterConfig) {}

  /**
   * Publish a QE result into an OpenCode session. In dry-run mode no
   * client is required — delivery is reported without any network call.
   * Outside dry-run, the client is the real OpenCode server client.
   */
  async publish(
    result: QEResult,
    context: OpenCodeContext,
    client: OpenCodeClient | undefined,
    knownSecrets: string[] = [],
  ): Promise<OpenCodePublishingResult> {
    const redact = redactorFor(knownSecrets);
    const message = renderSessionMessage(result, redact);

    const publishingResult: OpenCodePublishingResult = {
      messageDelivered: false,
      sessionId: context.sessionId,
      warnings: [],
      dryRun: this.config.dryRun,
    };

    if (this.config.dryRun) {
      publishingResult.messageDelivered = this.config.messageEnabled;
      return publishingResult;
    }

    if (!client) {
      publishingResult.warnings.push(
        "Message delivery failed: no OpenCode client provided",
      );
      return publishingResult;
    }

    if (this.config.messageEnabled) {
      await this.deliverMessage(message, context, client, publishingResult);
    }

    if (this.config.toastEnabled) {
      await this.sendToast(result, client, publishingResult);
    }

    return publishingResult;
  }

  private async deliverMessage(
    message: string,
    context: OpenCodeContext,
    client: OpenCodeClient,
    out: OpenCodePublishingResult,
  ): Promise<void> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await client.sendMessage({
          sessionId: context.sessionId,
          text: message,
        });
        out.messageDelivered = true;
        out.messageId = response.messageId;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof OpenCodeApiError && err.isServerError) {
          continue;
        }
        break;
      }
    }

    out.warnings.push(
      `Message delivery failed: ${lastError?.message ?? "unknown"}`,
    );
  }

  private async sendToast(
    result: QEResult,
    client: OpenCodeClient,
    out: OpenCodePublishingResult,
  ): Promise<void> {
    const urgency = mapVerdictToUrgency(result.verdict);
    const toastMessage = `QE Agent: ${result.verdict} (${result.confidence} confidence)`;
    try {
      await client.showToast(
        toastMessage,
        urgency === "error" ? "error" : "success",
      );
    } catch (err) {
      out.warnings.push(
        `Toast notification failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
}

export function validateResultForPublishing(json: unknown): QEResult {
  return QEResultSchema.parse(json);
}

export async function persistSessionMessage(
  result: QEResult,
  repoPath: string,
  knownSecrets: string[] = [],
): Promise<string> {
  const redact = redactorFor(knownSecrets);
  const message = renderSessionMessage(result, redact);
  const absRepo = resolve(repoPath);
  const runDir = join(absRepo, ".qe", "runs", result.executionId);
  await mkdir(runDir, { recursive: true });
  const messagePath = join(runDir, "opencode-message.md");
  await writeFile(messagePath, message, "utf-8");
  return messagePath;
}
