import { resolve, relative, dirname } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { GeneratedTestProposal, WriteOutcome } from "../../types/index.js";
import {
  classifyTestPath,
  isPathTraversal,
  isSymlinkEscape,
} from "./test-file-classifier.js";

const MAX_FILE_SIZE_BYTES = 512_000;
const MAX_FILES_PER_CYCLE = 8;

const SKIP_PATTERNS = [
  /\.skip\b/,
  /\bxit\b/,
  /\bxdescribe\b/,
  /\bxcontext\b/,
  /\bxtest\b/,
  /pytest\.mark\.skip/,
  /\[Ignore\]/,
  /\[Skip\]/,
  /@Disabled/,
  /@Ignore/,
];

export interface WriteContext {
  repositoryRoot: string;
  testDirectories?: string[];
  filesWrittenThisCycle: number;
}

export interface WriteResult {
  outcome: WriteOutcome;
  filePath: string;
  beforeHash?: string;
  afterHash?: string;
  reason?: string;
}

export class RepositoryWriteController {
  applyTestChange(
    proposal: GeneratedTestProposal,
    context: WriteContext,
  ): WriteResult {
    const absPath = resolve(context.repositoryRoot, proposal.filePath);
    const rel = relative(context.repositoryRoot, absPath);

    if (isPathTraversal(proposal.filePath, context.repositoryRoot)) {
      return {
        outcome: "DENIED_TRAVERSAL",
        filePath: rel,
        reason: "Path traverses outside repository root",
      };
    }

    if (
      rel.startsWith("..") ||
      !absPath.startsWith(resolve(context.repositoryRoot))
    ) {
      return {
        outcome: "DENIED_OUTSIDE_REPO",
        filePath: rel,
        reason: "Resolved path is outside repository",
      };
    }

    if (isSymlinkEscape(proposal.filePath, context.repositoryRoot)) {
      return {
        outcome: "DENIED_SYMLINK",
        filePath: rel,
        reason: "Path contains symlink escape",
      };
    }

    if (context.filesWrittenThisCycle >= MAX_FILES_PER_CYCLE) {
      return {
        outcome: "DENIED_FILE_COUNT",
        filePath: rel,
        reason: `File count limit (${MAX_FILES_PER_CYCLE}) reached`,
      };
    }

    if (Buffer.byteLength(proposal.content, "utf-8") > MAX_FILE_SIZE_BYTES) {
      return {
        outcome: "DENIED_SIZE_LIMIT",
        filePath: rel,
        reason: `Content exceeds ${MAX_FILE_SIZE_BYTES} bytes`,
      };
    }

    if (!proposal.content.trim()) {
      return {
        outcome: "DENIED_INVALID_CONTENT",
        filePath: rel,
        reason: "Content is empty",
      };
    }

    if (isBinaryContent(proposal.content)) {
      return {
        outcome: "DENIED_INVALID_CONTENT",
        filePath: rel,
        reason: "Content appears to be binary",
      };
    }

    const classification = classifyTestPath(
      rel,
      context.repositoryRoot,
      context.testDirectories,
    );

    if (classification === "PRODUCTION") {
      return {
        outcome: "DENIED_PRODUCTION_PATH",
        filePath: rel,
        reason: `Path '${rel}' is classified as production code`,
      };
    }

    if (classification === "UNCERTAIN") {
      return {
        outcome: "DENIED_UNCERTAIN_CLASSIFICATION",
        filePath: rel,
        reason: `Cannot confidently classify '${rel}' as test code`,
      };
    }

    let beforeHash: string | undefined;

    if (proposal.operation === "MODIFY") {
      if (!existsSync(absPath)) {
        return {
          outcome: "DENIED_INVALID_CONTENT",
          filePath: rel,
          reason: "Cannot modify non-existent file",
        };
      }

      if (hasUncommittedChanges(absPath, context.repositoryRoot)) {
        return {
          outcome: "DENIED_DIRTY_FILE",
          filePath: rel,
          reason: "File has uncommitted changes",
        };
      }

      const existing = readFileSync(absPath, "utf-8");
      beforeHash = hashContent(existing);

      if (detectsWeakening(existing, proposal.content)) {
        return {
          outcome: "DENIED_INVALID_CONTENT",
          filePath: rel,
          reason: "Modification would weaken existing assertions",
        };
      }

      if (detectsSkipInjection(existing, proposal.content)) {
        return {
          outcome: "DENIED_INVALID_CONTENT",
          filePath: rel,
          reason: "Modification adds skip/disable markers",
        };
      }

      if (detectsDeletion(existing, proposal.content)) {
        return {
          outcome: "DENIED_INVALID_CONTENT",
          filePath: rel,
          reason: "Modification deletes existing tests",
        };
      }
    }

    if (proposal.operation === "CREATE" && existsSync(absPath)) {
      if (hasUncommittedChanges(absPath, context.repositoryRoot)) {
        return {
          outcome: "DENIED_DIRTY_FILE",
          filePath: rel,
          reason: "Target file already exists with uncommitted changes",
        };
      }
      const existing = readFileSync(absPath, "utf-8");
      beforeHash = hashContent(existing);
    }

    const dir = dirname(absPath);
    mkdirSync(dir, { recursive: true });

    const tmpPath = absPath + ".qe-tmp";
    try {
      writeFileSync(tmpPath, proposal.content, "utf-8");
      renameSync(tmpPath, absPath);
    } catch (err) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* best effort */
      }
      return {
        outcome: "DENIED_INVALID_CONTENT",
        filePath: rel,
        reason: `Write failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const afterHash = hashContent(proposal.content);

    return {
      outcome: "APPLIED",
      filePath: rel,
      beforeHash,
      afterHash,
    };
  }

  removeFile(filePath: string, repositoryRoot: string): boolean {
    const absPath = resolve(repositoryRoot, filePath);
    try {
      if (existsSync(absPath)) {
        unlinkSync(absPath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

function hashContent(content: string): string {
  return createHash("sha256")
    .update(content, "utf-8")
    .digest("hex")
    .slice(0, 16);
}

function isBinaryContent(content: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 1024));
}

function hasUncommittedChanges(
  absPath: string,
  repositoryRoot: string,
): boolean {
  try {
    const rel = relative(repositoryRoot, absPath);
    const status = execFileSync("git", ["status", "--porcelain", "--", rel], {
      cwd: repositoryRoot,
    })
      .toString()
      .trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function detectsWeakening(existing: string, proposed: string): boolean {
  const existingAssertions = countAssertions(existing);
  const proposedAssertions = countAssertions(proposed);

  if (existingAssertions > 0 && proposedAssertions < existingAssertions * 0.5) {
    return true;
  }

  const trivialPatterns = [
    /expect\(true\)\.toBe\(true\)/g,
    /expect\(1\)\.toBe\(1\)/g,
    /assert\s*True\s*\(\s*True\s*\)/g,
    /Assert\.True\s*\(\s*true\s*\)/g,
  ];

  const existingTrivial = trivialPatterns.reduce(
    (sum, p) => sum + (existing.match(p)?.length ?? 0),
    0,
  );
  const proposedTrivial = trivialPatterns.reduce(
    (sum, p) => sum + (proposed.match(p)?.length ?? 0),
    0,
  );

  if (proposedTrivial > existingTrivial + 2 && proposedAssertions > 0) {
    const trivialRatio = proposedTrivial / proposedAssertions;
    if (trivialRatio > 0.5) return true;
  }

  return false;
}

function detectsSkipInjection(existing: string, proposed: string): boolean {
  for (const pattern of SKIP_PATTERNS) {
    const existingMatches =
      existing.match(new RegExp(pattern.source, "g"))?.length ?? 0;
    const proposedMatches =
      proposed.match(new RegExp(pattern.source, "g"))?.length ?? 0;
    if (proposedMatches > existingMatches) return true;
  }
  return false;
}

function detectsDeletion(existing: string, proposed: string): boolean {
  const existingTests = countTestDeclarations(existing);
  const proposedTests = countTestDeclarations(proposed);
  return existingTests > 0 && proposedTests < existingTests;
}

function countAssertions(content: string): number {
  const patterns = [
    /\bexpect\s*\(/g,
    /\bassert\b/gi,
    /\bAssert\./g,
    /\.should\b/g,
    /\.to\b/g,
  ];
  return patterns.reduce((sum, p) => sum + (content.match(p)?.length ?? 0), 0);
}

function countTestDeclarations(content: string): number {
  const patterns = [
    /\bit\s*\(/g,
    /\btest\s*\(/g,
    /\bdescribe\s*\(/g,
    /\bdef\s+test_/g,
    /\[Test\]/g,
    /\[Fact\]/g,
    /\[Theory\]/g,
    /@Test/g,
  ];
  return patterns.reduce((sum, p) => sum + (content.match(p)?.length ?? 0), 0);
}
