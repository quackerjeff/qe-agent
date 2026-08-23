import type {
  RepositoryProfile,
  Evidence,
  Requirement,
  RequirementAssessment,
} from "../../types/index.js";

export interface GroundingContext {
  repositoryProfile: RepositoryProfile;
  evidence: Evidence[];
  requirements: Requirement[];
  budgetActive: boolean;
}

export interface GroundingResult {
  requirementId: string;
  status: "VERIFIED" | "PARTIALLY_VERIFIED";
  evidenceIds: string[];
  explanation: string;
}

export function createDiscoveryEvidence(
  profile: RepositoryProfile,
): Evidence[] {
  const now = new Date().toISOString();
  const evidence: Evidence[] = [];

  const testFrameworks = profile.testFrameworks.map((t) => t.name);
  const testCommands = profile.commands.filter((c) => c.category === "TEST");
  const lintCommands = profile.commands.filter((c) => c.category === "LINT");
  const typecheckCommands = profile.commands.filter(
    (c) => c.category === "TYPECHECK",
  );
  const languages = profile.languages.map((l) => l.name);
  const frameworks = profile.frameworks.map((f) => f.name);

  const discoveryParts: string[] = [];
  if (languages.length > 0)
    discoveryParts.push(`languages: ${languages.join(", ")}`);
  if (frameworks.length > 0)
    discoveryParts.push(`frameworks: ${frameworks.join(", ")}`);
  if (testFrameworks.length > 0)
    discoveryParts.push(`test frameworks: ${testFrameworks.join(", ")}`);
  if (testCommands.length > 0)
    discoveryParts.push(
      `test commands: ${testCommands.map((c) => c.name).join(", ")}`,
    );
  if (lintCommands.length > 0)
    discoveryParts.push(
      `lint commands: ${lintCommands.map((c) => c.name).join(", ")}`,
    );
  if (typecheckCommands.length > 0)
    discoveryParts.push(
      `typecheck commands: ${typecheckCommands.map((c) => c.name).join(", ")}`,
    );

  evidence.push({
    id: "ev-discovery-repository",
    type: "DISCOVERY_RESULT",
    provenance: "observed",
    timestamp: now,
    source: "repository-analysis",
    status: "OBSERVED",
    summary:
      discoveryParts.length > 0
        ? `Repository analysis completed: ${discoveryParts.join("; ")}`
        : "Repository analysis completed: no test frameworks or quality tools discovered",
    details: {
      languages,
      frameworks,
      testFrameworks,
      testCommands: testCommands.map((c) => ({
        name: c.name,
        command: c.command,
      })),
      lintCommands: lintCommands.map((c) => ({
        name: c.name,
        command: c.command,
      })),
      typecheckCommands: typecheckCommands.map((c) => ({
        name: c.name,
        command: c.command,
      })),
      capabilities: profile.capabilities.map((c) => ({
        id: c.id,
        type: c.type,
        available: c.available,
      })),
    },
  });

  return evidence;
}

export function createLifecycleEvidence(opts: {
  invocationMode: string;
  budgetActive: boolean;
  budgetMaxDurationMs?: number;
  budgetMaxModelCalls?: number;
}): Evidence[] {
  const now = new Date().toISOString();
  const evidence: Evidence[] = [];

  evidence.push({
    id: "ev-lifecycle-invocation",
    type: "LIFECYCLE_OBSERVATION",
    provenance: "observed",
    timestamp: now,
    source: "lifecycle",
    status: "OBSERVED",
    summary: `Run invoked via ${opts.invocationMode}`,
    details: {
      invocationMode: opts.invocationMode,
    },
  });

  if (opts.budgetActive) {
    const budgetParts: string[] = [];
    if (opts.budgetMaxDurationMs)
      budgetParts.push(`maxDuration: ${opts.budgetMaxDurationMs}ms`);
    if (opts.budgetMaxModelCalls)
      budgetParts.push(`maxModelCalls: ${opts.budgetMaxModelCalls}`);

    evidence.push({
      id: "ev-lifecycle-budget",
      type: "LIFECYCLE_OBSERVATION",
      provenance: "observed",
      timestamp: now,
      source: "lifecycle",
      status: "OBSERVED",
      summary: `Execution budget active${budgetParts.length > 0 ? `: ${budgetParts.join(", ")}` : ""}`,
      details: {
        budgetActive: true,
        maxDurationMs: opts.budgetMaxDurationMs,
        maxModelCalls: opts.budgetMaxModelCalls,
      },
    });
  }

  return evidence;
}

export function buildDeterministicGrounding(
  _ctx: GroundingContext,
): GroundingResult[] {
  return [];
}

export function mergeGroundingWithModelAssessments(
  groundingResults: GroundingResult[],
  modelAssessments: RequirementAssessment[],
  allRequirements: Requirement[],
): RequirementAssessment[] {
  const groundingMap = new Map(
    groundingResults.map((g) => [g.requirementId, g]),
  );
  const modelMap = new Map(modelAssessments.map((a) => [a.requirementId, a]));
  const allReqIds = allRequirements.map((r) => r.id);
  const seenIds = new Set<string>();

  const merged: RequirementAssessment[] = [];
  for (const reqId of allReqIds) {
    if (seenIds.has(reqId)) continue;
    seenIds.add(reqId);

    const grounding = groundingMap.get(reqId);
    const model = modelMap.get(reqId);

    if (grounding && model) {
      const groundingRank = statusRank(grounding.status);
      const modelRank = statusRank(model.status);
      if (groundingRank > modelRank) {
        merged.push({
          requirementId: reqId,
          status: grounding.status,
          evidenceIds: [
            ...new Set([...grounding.evidenceIds, ...model.evidenceIds]),
          ],
          explanation: `${grounding.explanation} [Model also assessed: ${model.explanation}]`,
        });
      } else {
        merged.push(model);
      }
    } else if (grounding) {
      merged.push({
        requirementId: reqId,
        status: grounding.status,
        evidenceIds: grounding.evidenceIds,
        explanation: grounding.explanation,
      });
    } else if (model) {
      merged.push(model);
    } else {
      merged.push({
        requirementId: reqId,
        status: "NOT_VERIFIED",
        evidenceIds: [],
        explanation: "No assessment available from grounding or model analysis",
      });
    }
  }

  return merged;
}

function statusRank(
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "NOT_VERIFIED" | string,
): number {
  switch (status) {
    case "VERIFIED":
      return 3;
    case "PARTIALLY_VERIFIED":
      return 2;
    case "NOT_VERIFIED":
      return 1;
    default:
      return 0;
  }
}
