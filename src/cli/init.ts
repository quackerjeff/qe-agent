import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { getDefaultConfig } from "../config/index.js";
import type { Logger } from "../logging/index.js";

const CONFIG_HEADER = `# QE Agent Configuration
# See documentation for available options.
# Some sections below configure capabilities implemented in later milestones.
# They are accepted now so configuration can be prepared ahead of those features.
`;

export async function runInit(
  repositoryPath: string,
  logger: Logger,
): Promise<void> {
  const qeDir = join(repositoryPath, ".qe");
  const configPath = join(qeDir, "config.yml");

  let existingConfig: string | undefined;
  try {
    existingConfig = await readFile(configPath, "utf-8");
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      // File does not exist — expected case for first init
    } else {
      throw err;
    }
  }

  if (existingConfig !== undefined) {
    logger.info("QE configuration already exists at .qe/config.yml");
    logger.info("Existing configuration has not been modified.");
    return;
  }

  await mkdir(qeDir, { recursive: true });

  const defaultConfig = getDefaultConfig();
  const yamlContent =
    CONFIG_HEADER + stringifyYaml(defaultConfig, { lineWidth: 80 });

  await writeFile(configPath, yamlContent, "utf-8");

  // Create .gitignore for ephemeral artifacts
  const gitignorePath = join(qeDir, ".gitignore");
  try {
    await readFile(gitignorePath, "utf-8");
  } catch {
    const gitignoreContent = `# Ephemeral QE artifacts — not committed
runs/
cache/
artifacts/
traces/
`;
    await writeFile(gitignorePath, gitignoreContent, "utf-8");
  }

  logger.info("Initialized QE configuration at .qe/config.yml");
}
