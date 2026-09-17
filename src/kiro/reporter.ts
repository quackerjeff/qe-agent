import type { QEResult } from "../types/index.js";
import { QEResultSchema } from "../types/index.js";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { redactorFor } from "../core/reporting/index.js";
import type { KiroClient } from "./client.js";
import { KiroCliError } from "./client.js";
import type { KiroContext, KiroPublishingResult } from "./types.js";
import { KIRO_EXIT_FAILURE } from "./types.js";
import { renderKiroPrompt } from "./summary.js";

export interface KiroReporterConfig {
  dryRun: boolean;
  maxRetries: number;
}

export class KiroReporter {
  constructor(private readonly config: KiroReporterConfig) {}

  /**
   * Deliver a QE result to Kiro by running the real Kiro CLI in headless
   * mode. In dry-run mode no CLI process is spawned — the result reports
   * what would be delivered.
   */
  async publish(
    result: QEResult,
    context: KiroContext,
    client: KiroClient | undefined,
    knownSecrets: string[] = [],
  ): Promise<KiroPublishingResult> {
    const redact = redactorFor(knownSecrets);
    const prompt = renderKiroPrompt(result, redact);

    const publishingResult: KiroPublishingResult = {
      promptDelivered: false,
      sessionId: context.sessionId,
      warnings: [],
      dryRun: this.config.dryRun,
    };

    if (this.config.dryRun) {
      publishingResult.promptDelivered = true;
      return publishingResult;
    }

    if (!client) {
      publishingResult.warnings.push(
        "Kiro delivery failed: no Kiro client provided",
      );
      return publishingResult;
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await client.runPrompt({ prompt, context });
        publishingResult.promptDelivered = response.ok;
        publishingResult.exitCode = response.exitCode;
        if (!response.ok) {
          publishingResult.warnings.push(
            `Kiro CLI exited with code ${response.exitCode}`,
          );
        }
        if (response.stderr.trim().length > 0) {
          publishingResult.warnings.push(redact(response.stderr.trim()));
        }
        return publishingResult;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Spawn errors (executable missing) never succeed on retry.
        if (err instanceof KiroCliError && err.exitCode === KIRO_EXIT_FAILURE) {
          break;
        }
      }
    }

    publishingResult.warnings.push(
      `Kiro delivery failed: ${lastError?.message ?? "unknown"}`,
    );
    return publishingResult;
  }
}

export function validateResultForPublishing(json: unknown): QEResult {
  return QEResultSchema.parse(json);
}

export async function persistKiroPrompt(
  result: QEResult,
  repoPath: string,
  knownSecrets: string[] = [],
): Promise<string> {
  const redact = redactorFor(knownSecrets);
  const prompt = renderKiroPrompt(result, redact);
  const absRepo = resolve(repoPath);
  const runDir = join(absRepo, ".qe", "runs", result.executionId);
  await mkdir(runDir, { recursive: true });
  const promptPath = join(runDir, "kiro-prompt.md");
  await writeFile(promptPath, prompt, "utf-8");
  return promptPath;
}
