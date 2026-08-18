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
    project?: string;
    testing?: string;
    risks?: { topic: string; content: string }[];
    knowledgeFiles?: { name: string; content: string }[];
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
    projectMemoryCtx = {};
    if (mem.project) {
      projectMemoryCtx.project = mem.project.content.slice(0, maxMemBytes);
    }
    if (mem.testing) {
      projectMemoryCtx.testing = mem.testing.content.slice(0, maxMemBytes);
    }
    if (mem.risks && mem.risks.entries.length > 0) {
      projectMemoryCtx.risks = mem.risks.entries.map((e) => ({
        topic: e.topic,
        content: e.content.slice(0, 1024),
      }));
    }
    if (mem.knowledgeFiles.length > 0) {
      projectMemoryCtx.knowledgeFiles = mem.knowledgeFiles.map((k) => ({
        name: k.name,
        content: k.content.slice(0, 1024),
      }));
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
