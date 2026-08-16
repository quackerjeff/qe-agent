import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { DetectedTechnology, DiscoveredCommand } from "../types/index.js";
import type { FileInventory } from "./types.js";
import { filesMatching } from "../adapters/util.js";

export interface CIDiscoveryResult {
  ciSystems: DetectedTechnology[];
  commands: DiscoveredCommand[];
}

export async function discoverCI(
  inventory: FileInventory,
): Promise<CIDiscoveryResult> {
  const result: CIDiscoveryResult = { ciSystems: [], commands: [] };

  const workflows = filesMatching(
    inventory,
    (f) =>
      f.startsWith(".github/workflows/") &&
      (f.endsWith(".yml") || f.endsWith(".yaml")),
  );

  if (workflows.length > 0) {
    result.ciSystems.push({
      id: "github-actions",
      name: "GitHub Actions",
      category: "ciSystem",
      confidence: 0.99,
      evidence: workflows.map((f) => ({
        source: f,
        reason: "GitHub Actions workflow file",
      })),
    });

    for (const wf of workflows) {
      const commands = await extractWorkflowCommands(inventory.root, wf);
      result.commands.push(...commands);
    }
  }

  return result;
}

async function extractWorkflowCommands(
  root: string,
  workflowPath: string,
): Promise<DiscoveredCommand[]> {
  const commands: DiscoveredCommand[] = [];

  let content: string;
  try {
    content = await readFile(join(root, workflowPath), "utf-8");
  } catch {
    return commands;
  }

  let workflow: unknown;
  try {
    workflow = parseYaml(content);
  } catch {
    return commands;
  }

  if (!workflow || typeof workflow !== "object") return commands;

  const jobs = (workflow as Record<string, unknown>).jobs;
  if (!jobs || typeof jobs !== "object") return commands;

  for (const [, job] of Object.entries(jobs as Record<string, unknown>)) {
    if (!job || typeof job !== "object") continue;
    const steps = (job as Record<string, unknown>).steps;
    if (!Array.isArray(steps)) continue;

    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const run = (step as Record<string, unknown>).run;
      if (typeof run !== "string") continue;

      for (const line of run.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const category = categorizeCommand(trimmed);
        if (category) {
          const id = `ci:${workflowPath}:${commands.length}`;
          commands.push({
            id,
            name: trimmed.split(" ").slice(0, 3).join(" "),
            category: category,
            command: trimmed,
            source: workflowPath,
            confidence: 0.7,
          });
        }
      }
    }
  }

  return commands;
}

function categorizeCommand(
  cmd: string,
): "INSTALL" | "BUILD" | "TEST" | "LINT" | "TYPECHECK" | undefined {
  if (
    cmd.startsWith("npm install") ||
    cmd.startsWith("npm ci") ||
    cmd.startsWith("pnpm install") ||
    cmd.startsWith("yarn install") ||
    cmd.startsWith("pip install") ||
    cmd.startsWith("poetry install") ||
    cmd.startsWith("uv sync") ||
    cmd.startsWith("dotnet restore")
  ) {
    return "INSTALL";
  }
  if (
    cmd.includes("npm run build") ||
    cmd.includes("pnpm build") ||
    cmd.includes("dotnet build") ||
    cmd.includes("make build") ||
    cmd.includes("cargo build") ||
    cmd.includes("go build")
  ) {
    return "BUILD";
  }
  if (
    cmd.includes("npm test") ||
    cmd.includes("npm run test") ||
    cmd.includes("pnpm test") ||
    cmd.includes("pytest") ||
    cmd.includes("dotnet test") ||
    cmd.includes("cargo test") ||
    cmd.includes("go test") ||
    cmd.includes("make test") ||
    cmd.includes("vitest") ||
    cmd.includes("jest")
  ) {
    return "TEST";
  }
  if (
    cmd.includes("eslint") ||
    cmd.includes("npm run lint") ||
    cmd.includes("pnpm lint") ||
    cmd.includes("flake8") ||
    cmd.includes("ruff")
  ) {
    return "LINT";
  }
  if (
    cmd.includes("tsc") ||
    cmd.includes("typecheck") ||
    cmd.includes("mypy")
  ) {
    return "TYPECHECK";
  }
  return undefined;
}
