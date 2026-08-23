import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { QEConfigSchema, type QEConfig } from "./schema.js";

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

export interface LoadConfigResult {
  config: QEConfig;
  explicitMaxModelCalls?: number;
}

export async function loadConfig(
  repositoryPath: string,
): Promise<LoadConfigResult> {
  const configPath = join(repositoryPath, ".qe", "config.yml");

  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new ConfigValidationError(
        `QE configuration not found at ${configPath}. Run 'qe init' to create it.`,
        ["Configuration file does not exist"],
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    throw new ConfigValidationError(`Invalid YAML in ${configPath}`, [
      "Failed to parse YAML configuration",
    ]);
  }

  const result = QEConfigSchema.safeParse(parsed);

  if (!result.success) {
    const issues = formatZodError(result.error);
    throw new ConfigValidationError(
      `Invalid QE configuration in ${configPath}:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
      issues,
    );
  }

  const raw = parsed as Record<string, unknown>;
  const rawReasoning = raw?.reasoning as Record<string, unknown> | undefined;
  const explicitMaxModelCalls =
    typeof rawReasoning?.maxModelCalls === "number"
      ? rawReasoning.maxModelCalls
      : undefined;

  return { config: result.data, explicitMaxModelCalls };
}

export function getDefaultConfig(): QEConfig {
  return QEConfigSchema.parse({ version: 1 });
}
