import type {
  RepositoryProfile,
  Requirement,
  Evidence,
} from "../../types/index.js";
import type { GitDiffData } from "../git/index.js";
import type { ProjectMemory } from "../memory/types.js";

export interface ContextLimits {
  maxChangedFilesIncluded: number;
  maxBytesPerFile: number;
  maxTotalSourceContext: number;
  maxDocumentationExcerptSize: number;
}

export interface ContextTruncation {
  changedFilesTruncated: boolean;
  totalChangedFiles: number;
  includedChangedFiles: number;
  sourceContextTruncated: boolean;
  totalSourceBytes: number;
  includedSourceBytes: number;
  documentationTruncated: boolean;
}

export interface ReasoningContext {
  requirements: Requirement[];
  repositoryProfile: {
    root: string;
    languages: string[];
    frameworks: string[];
    testFrameworks: string[];
    commands: { id: string; name: string; category: string; command: string }[];
    capabilities: { id: string; type: string; available: boolean }[];
  };
  changeData?: {
    baselineRef: string;
    targetRef: string;
    changedFiles: { path: string; changeType: string }[];
    addedFiles: string[];
    deletedFiles: string[];
    renamedFiles: { from: string; to: string }[];
    changedTests: string[];
    changedConfiguration: string[];
    changedDependencyMetadata: string[];
    diffStat: string;
  };
  fileDiffs?: Record<string, string>;
  priorEvidence: {
    id: string;
    type: string;
    status: string;
    summary: string;
  }[];
  instructions?: string;
  projectMemory?: {
    _temporalNote?: string;
    project?: string;
    historicalObservations?: { source: string; content: string }[];
  };
  truncation: ContextTruncation;
}

const DEFAULT_LIMITS: ContextLimits = {
  maxChangedFilesIncluded: 30,
  maxBytesPerFile: 8192,
  maxTotalSourceContext: 65536,
  maxDocumentationExcerptSize: 4096,
};

export function buildReasoningContext(opts: {
  requirements: Requirement[];
  profile: RepositoryProfile;
  diffData?: GitDiffData;
  fileDiffs?: Record<string, string>;
  evidence?: Evidence[];
  instructions?: string;
  projectMemory?: ProjectMemory;
  limits?: Partial<ContextLimits>;
  excludeVolatileHistory?: boolean;
}): ReasoningContext {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };

  const truncation: ContextTruncation = {
    changedFilesTruncated: false,
    totalChangedFiles: 0,
    includedChangedFiles: 0,
    sourceContextTruncated: false,
    totalSourceBytes: 0,
    includedSourceBytes: 0,
    documentationTruncated: false,
  };

  const repoContext = {
    root: opts.profile.root,
    languages: opts.profile.languages.map((l) => l.name),
    frameworks: opts.profile.frameworks.map((f) => f.name),
    testFrameworks: opts.profile.testFrameworks.map((t) => t.name),
    commands: opts.profile.commands.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      command: c.command,
    })),
    capabilities: opts.profile.capabilities.map((c) => ({
      id: c.id,
      type: c.type,
      available: c.available,
    })),
  };

  let changeData: ReasoningContext["changeData"];
  if (opts.diffData) {
    const totalFiles = opts.diffData.changedFiles.length;
    truncation.totalChangedFiles = totalFiles;
    const included = opts.diffData.changedFiles.slice(
      0,
      limits.maxChangedFilesIncluded,
    );
    truncation.includedChangedFiles = included.length;
    truncation.changedFilesTruncated = totalFiles > included.length;

    changeData = {
      baselineRef: opts.diffData.baselineRef,
      targetRef: opts.diffData.targetRef,
      changedFiles: included.map((f) => ({
        path: f.path,
        changeType: f.changeType,
      })),
      addedFiles: opts.diffData.addedFiles,
      deletedFiles: opts.diffData.deletedFiles,
      renamedFiles: opts.diffData.renamedFiles,
      changedTests: opts.diffData.changedTests,
      changedConfiguration: opts.diffData.changedConfiguration,
      changedDependencyMetadata: opts.diffData.changedDependencyMetadata,
      diffStat: opts.diffData.diffStat,
    };
  }

  let fileDiffs: Record<string, string> | undefined;
  if (opts.fileDiffs) {
    fileDiffs = {};
    let totalBytes = 0;
    for (const [path, diff] of Object.entries(opts.fileDiffs)) {
      const totalAllDiffs = Object.values(opts.fileDiffs).reduce(
        (s, d) => s + d.length,
        0,
      );
      truncation.totalSourceBytes = totalAllDiffs;

      const truncatedDiff =
        diff.length > limits.maxBytesPerFile
          ? diff.slice(0, limits.maxBytesPerFile) +
            `\n... (truncated at ${limits.maxBytesPerFile} bytes)`
          : diff;

      if (totalBytes + truncatedDiff.length > limits.maxTotalSourceContext) {
        truncation.sourceContextTruncated = true;
        break;
      }

      fileDiffs[path] = truncatedDiff;
      totalBytes += truncatedDiff.length;
    }
    truncation.includedSourceBytes = totalBytes;
  }

  let instructions = opts.instructions;
  if (
    instructions &&
    instructions.length > limits.maxDocumentationExcerptSize
  ) {
    instructions =
      instructions.slice(0, limits.maxDocumentationExcerptSize) +
      "\n... (truncated)";
    truncation.documentationTruncated = true;
  }

  const priorEvidence = (opts.evidence ?? []).map((e) => ({
    id: e.id,
    type: e.type,
    status: e.status,
    summary: e.summary,
  }));

  let projectMemoryCtx: ReasoningContext["projectMemory"];
  if (opts.projectMemory) {
    const mem = opts.projectMemory;
    const maxMemBytes = 4096;
    projectMemoryCtx = {
      _temporalNote:
        "Project memory contains observations from prior QE runs. " +
        "Execution outcomes (test pass/fail/timeout, command results) " +
        "are historical and may not reflect current repository state.",
    };
    if (mem.project) {
      projectMemoryCtx.project = stripManagedMarkers(
        mem.project.content.slice(0, maxMemBytes),
      );
    }
    if (!opts.excludeVolatileHistory) {
      const historicalObs: { source: string; content: string }[] = [];
      if (mem.testing) {
        const content = stripManagedMarkers(
          mem.testing.content.slice(0, maxMemBytes),
        );
        if (content.length > 0) {
          historicalObs.push({ source: "TESTING", content });
        }
      }
      if (mem.risks && mem.risks.entries.length > 0) {
        for (const e of mem.risks.entries) {
          const content = stripManagedMarkers(e.content.slice(0, 1024));
          if (content.length > 0) {
            historicalObs.push({ source: "RISKS", content });
          }
        }
      }
      if (mem.knowledgeFiles.length > 0) {
        for (const k of mem.knowledgeFiles) {
          const content = stripManagedMarkers(k.content.slice(0, 1024));
          if (content.length > 0) {
            historicalObs.push({
              source: `KNOWLEDGE/${k.name}`,
              content,
            });
          }
        }
      }
      if (historicalObs.length > 0) {
        projectMemoryCtx.historicalObservations = historicalObs;
      }
    }
  }

  return {
    requirements: opts.requirements,
    repositoryProfile: repoContext,
    changeData,
    fileDiffs,
    priorEvidence,
    instructions,
    projectMemory: projectMemoryCtx,
    truncation,
  };
}

export function stripManagedMarkers(content: string): string {
  return content.replace(/<!-- qe-managed:(?:start|end) -->\n?/g, "").trim();
}

export function filterMemoryForDistillation(mem: ProjectMemory): ProjectMemory {
  const filtered: ProjectMemory = {
    knowledgeFiles: [],
    historySummaries: mem.historySummaries,
  };
  if (mem.project) {
    filtered.project = {
      content: stripManagedMarkers(mem.project.content),
      source: mem.project.source,
    };
  }
  if (mem.testing) {
    const { managed } = extractManagedContent(mem.testing.content);
    if (managed) {
      filtered.testing = {
        content: managed,
        source: mem.testing.source,
      };
    }
  }
  if (mem.risks) {
    const filteredEntries = mem.risks.entries
      .map((e) => {
        const { managed } = extractManagedContent(e.content);
        return {
          topic: stripManagedMarkers(e.topic),
          content: managed ?? "",
        };
      })
      .filter((e) => e.topic.length > 0 || e.content.length > 0);
    if (filteredEntries.length > 0) {
      filtered.risks = { entries: filteredEntries, source: mem.risks.source };
    }
  }
  for (const k of mem.knowledgeFiles) {
    const { managed } = extractManagedContent(k.content);
    if (managed) {
      filtered.knowledgeFiles.push({
        name: k.name,
        content: managed,
        source: k.source,
      });
    }
  }
  return filtered;
}

export function extractManagedContent(content: string): {
  managed: string | null;
  legacy: string | null;
} {
  const startMarker = "<!-- qe-managed:start -->";
  const endMarker = "<!-- qe-managed:end -->";

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    const trimmed = content.trim();
    return { managed: null, legacy: trimmed.length > 0 ? trimmed : null };
  }

  const managed = content.slice(startIdx + startMarker.length, endIdx).trim();
  const before = content.slice(0, startIdx).trim();
  const after = content.slice(endIdx + endMarker.length).trim();
  const legacyParts = [before, after].filter((s) => s.length > 0);
  const legacy = legacyParts.length > 0 ? legacyParts.join("\n\n") : null;

  return {
    managed: managed.length > 0 ? managed : null,
    legacy,
  };
}
