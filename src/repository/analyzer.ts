import type { RepositoryProfile } from "../types/index.js";
import { RepositoryProfileSchema } from "../types/index.js";
import type { EcosystemAdapter, AdapterResult } from "./types.js";
import { discoverRoot } from "./root-discovery.js";
import { buildFileInventory } from "./file-inventory.js";
import { discoverInstructions } from "./instruction-discovery.js";
import { discoverCI } from "./ci-discovery.js";
import { createDefaultAdapters } from "../adapters/index.js";
import { basename } from "node:path";

export interface AnalyzeOptions {
  targetPath: string;
  adapters?: EcosystemAdapter[];
}

export async function analyzeRepository(
  options: AnalyzeOptions,
): Promise<RepositoryProfile> {
  const { root, git } = await discoverRoot(options.targetPath);
  const { inventory, nestedProjectPaths } = await buildFileInventory(root);

  const adapters = options.adapters ?? createDefaultAdapters();

  const adapterResults: AdapterResult[] = [];
  for (const adapter of adapters) {
    if (await adapter.detect(inventory)) {
      adapterResults.push(await adapter.analyze(inventory));
    }
  }

  const merged = mergeResults(adapterResults);
  const documentation = discoverInstructions(inventory);
  const ci = await discoverCI(inventory);

  const nestedApps = nestedProjectPaths.map((p) => ({
    id: `nested:${p}`,
    name: basename(p),
    path: p,
    type: "nested-project",
  }));

  const applications =
    merged.applications.length > 0 || nestedApps.length > 0
      ? [...merged.applications, ...nestedApps]
      : [{ id: "root", name: inferProjectName(root), path: "." }];

  merged.capabilities.push({
    id: "git.analysis",
    type: "vcs",
    provider: "git",
    available: git.detected,
    confidence: git.detected ? 1.0 : 0,
  });

  const allCiSystems = [...merged.ciSystems, ...ci.ciSystems];

  const profile: RepositoryProfile = {
    root,
    git,
    languages: deduplicateById(merged.languages),
    frameworks: deduplicateById(merged.frameworks),
    packageManagers: deduplicateById(merged.packageManagers),
    buildSystems: deduplicateById(merged.buildSystems),
    testFrameworks: deduplicateById(merged.testFrameworks),
    ciSystems: deduplicateById(allCiSystems),
    applications,
    documentation,
    commands: deduplicateById([...merged.commands, ...ci.commands]),
    capabilities: deduplicateById(merged.capabilities),
    confidence: computeOverallConfidence(merged),
  };

  return RepositoryProfileSchema.parse(profile);
}

function mergeResults(results: AdapterResult[]): AdapterResult {
  const merged: AdapterResult = {
    languages: [],
    frameworks: [],
    packageManagers: [],
    buildSystems: [],
    testFrameworks: [],
    ciSystems: [],
    commands: [],
    applications: [],
    capabilities: [],
  };

  for (const r of results) {
    merged.languages.push(...r.languages);
    merged.frameworks.push(...r.frameworks);
    merged.packageManagers.push(...r.packageManagers);
    merged.buildSystems.push(...r.buildSystems);
    merged.testFrameworks.push(...r.testFrameworks);
    merged.ciSystems.push(...r.ciSystems);
    merged.commands.push(...r.commands);
    merged.applications.push(...r.applications);
    merged.capabilities.push(...r.capabilities);
  }

  return merged;
}

function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.set(item.id, item);
    }
  }
  return [...seen.values()];
}

function computeOverallConfidence(merged: AdapterResult): number {
  const allConfidences = [
    ...merged.languages.map((l) => l.confidence),
    ...merged.frameworks.map((f) => f.confidence),
    ...merged.packageManagers.map((p) => p.confidence),
    ...merged.testFrameworks.map((t) => t.confidence),
  ];

  if (allConfidences.length === 0) return 0.3;

  const avg =
    allConfidences.reduce((sum, c) => sum + c, 0) / allConfidences.length;
  return Math.round(avg * 100) / 100;
}

function inferProjectName(root: string): string {
  const parts = root.split("/");
  return parts[parts.length - 1] || "project";
}
