import {
  readFile,
  writeFile,
  readdir,
  stat,
  mkdir,
  rename,
} from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";
import { realpathSync, lstatSync, existsSync } from "node:fs";
import type {
  ProjectMemory,
  RiskEntry,
  MemoryUpdateProposal,
  MemoryUpdateResult,
  MemoryWarning,
  MemoryMetrics,
  MemoryClaimCategory,
} from "./types.js";

const MAX_FILE_SIZE_BYTES = 32_768;
const MAX_KNOWLEDGE_FILES = 10;
const MAX_HISTORY_SUMMARIES = 10;
const MAX_UPDATES_PER_RUN = 6;
const MAX_CONTENT_SIZE_BYTES = 16_384;

const SECRET_PATTERNS = [
  /(?:api[_-]?key|api[_-]?token|auth[_-]?token|secret[_-]?key|access[_-]?token|password|passwd|credential|private[_-]?key)\s*[:=]\s*\S+/gi,
  /\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|gho_[a-zA-Z0-9]{36,})\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
];

const CONFIRMED_FACT_PATTERNS = [
  /\bhas been verified\b/i,
  /\bverified\b.*\b(?:work|pass|succeed|correct)/i,
  /\bconfirmed\b.*\b(?:fail|defect|bug|regression|flak)/i,
  /\bfails?\b.*\bfor\b/i,
  /\bregression\b.*\bintroduced\b/i,
  /\bflaky\b/i,
  /\btest is\b.*\b(?:broken|failing|flaky)\b/i,
  /\bcovers requirement\b/i,
  /\bgenerated regression test\b/i,
];

export interface EvidenceForValidation {
  id: string;
  type: string;
  status: string;
  provenance?: string;
}

export class ProjectMemoryManager {
  async load(repositoryRoot: string): Promise<{
    memory: ProjectMemory;
    warnings: MemoryWarning[];
    metrics: Pick<MemoryMetrics, "memoryFilesRead" | "memoryEntriesUsed">;
  }> {
    const qeDir = join(repositoryRoot, ".qe");
    const warnings: MemoryWarning[] = [];
    let filesRead = 0;
    let entriesUsed = 0;

    const memory: ProjectMemory = {
      knowledgeFiles: [],
      historySummaries: [],
    };

    if (!existsSync(qeDir)) {
      return {
        memory,
        warnings,
        metrics: { memoryFilesRead: 0, memoryEntriesUsed: 0 },
      };
    }

    // PROJECT.md
    const projectPath = join(qeDir, "PROJECT.md");
    const projectContent = await this.safeReadFile(projectPath, warnings);
    if (projectContent !== undefined) {
      filesRead++;
      if (projectContent.length > 0) {
        memory.project = {
          content: projectContent,
          source: ".qe/PROJECT.md",
          lastModified: await this.getModTime(projectPath),
        };
        entriesUsed++;
      }
    }

    // TESTING.md
    const testingPath = join(qeDir, "TESTING.md");
    const testingContent = await this.safeReadFile(testingPath, warnings);
    if (testingContent !== undefined) {
      filesRead++;
      if (testingContent.length > 0) {
        memory.testing = {
          content: testingContent,
          source: ".qe/TESTING.md",
          lastModified: await this.getModTime(testingPath),
        };
        entriesUsed++;
      }
    }

    // RISKS.md
    const risksPath = join(qeDir, "RISKS.md");
    const risksContent = await this.safeReadFile(risksPath, warnings);
    if (risksContent !== undefined) {
      filesRead++;
      if (risksContent.length > 0) {
        const entries = this.parseRisks(risksContent);
        memory.risks = {
          entries,
          source: ".qe/RISKS.md",
          lastModified: await this.getModTime(risksPath),
        };
        entriesUsed += entries.length;
      }
    }

    // knowledge/*.md
    const knowledgeDir = join(qeDir, "knowledge");
    if (existsSync(knowledgeDir)) {
      try {
        const files = await readdir(knowledgeDir);
        const mdFiles = files
          .filter((f) => f.endsWith(".md"))
          .slice(0, MAX_KNOWLEDGE_FILES);
        for (const file of mdFiles) {
          const filePath = join(knowledgeDir, file);
          if (this.isSymlinkEscape(filePath, repositoryRoot)) {
            warnings.push({
              type: "READ_FAILURE",
              source: `.qe/knowledge/${file}`,
              message: "Symlink escape detected, skipping",
            });
            continue;
          }
          const content = await this.safeReadFile(filePath, warnings);
          if (content !== undefined && content.length > 0) {
            filesRead++;
            memory.knowledgeFiles.push({
              name: file.replace(/\.md$/, ""),
              content,
              source: `.qe/knowledge/${file}`,
              lastModified: await this.getModTime(filePath),
            });
            entriesUsed++;
          }
        }
      } catch {
        warnings.push({
          type: "READ_FAILURE",
          source: ".qe/knowledge/",
          message: "Could not read knowledge directory",
        });
      }
    }

    // history/summaries/*.md
    const summariesDir = join(qeDir, "history", "summaries");
    if (existsSync(summariesDir)) {
      try {
        const files = await readdir(summariesDir);
        const mdFiles = files
          .filter((f) => f.endsWith(".md"))
          .sort()
          .slice(-MAX_HISTORY_SUMMARIES);
        for (const file of mdFiles) {
          const filePath = join(summariesDir, file);
          const content = await this.safeReadFile(filePath, warnings);
          if (content !== undefined && content.length > 0) {
            filesRead++;
            memory.historySummaries.push({
              name: file.replace(/\.md$/, ""),
              content,
              source: `.qe/history/summaries/${file}`,
            });
            entriesUsed++;
          }
        }
      } catch {
        warnings.push({
          type: "READ_FAILURE",
          source: ".qe/history/summaries/",
          message: "Could not read history summaries directory",
        });
      }
    }

    return {
      memory,
      warnings,
      metrics: { memoryFilesRead: filesRead, memoryEntriesUsed: entriesUsed },
    };
  }

  async applyUpdates(
    repositoryRoot: string,
    proposals: MemoryUpdateProposal[],
    existingMemory: ProjectMemory,
    options?: {
      knownSecrets?: string[];
      currentEvidence?: EvidenceForValidation[];
    },
  ): Promise<{
    results: MemoryUpdateResult[];
    metrics: Pick<
      MemoryMetrics,
      "memoryUpdatesProposed" | "memoryUpdatesApplied" | "memoryUpdatesRejected"
    >;
  }> {
    const results: MemoryUpdateResult[] = [];
    let applied = 0;
    let rejected = 0;

    const actionable = proposals
      .filter((p) => p.operation !== "NO_CHANGE")
      .slice(0, MAX_UPDATES_PER_RUN);

    for (const proposal of actionable) {
      const result = await this.applySingleUpdate(
        repositoryRoot,
        proposal,
        existingMemory,
        options,
      );
      results.push(result);
      if (result.applied) {
        applied++;
      } else {
        rejected++;
      }
    }

    return {
      results,
      metrics: {
        memoryUpdatesProposed: proposals.length,
        memoryUpdatesApplied: applied,
        memoryUpdatesRejected: rejected,
      },
    };
  }

  private async applySingleUpdate(
    repositoryRoot: string,
    proposal: MemoryUpdateProposal,
    existingMemory: ProjectMemory,
    options?: {
      knownSecrets?: string[];
      currentEvidence?: EvidenceForValidation[];
    },
  ): Promise<MemoryUpdateResult> {
    // Reject raw topic with traversal before sanitization
    if (proposal.topic && /\.\.[\\/]/.test(proposal.topic)) {
      return {
        target: proposal.target,
        operation: proposal.operation,
        filePath: `.qe/<denied>`,
        applied: false,
        reason: "Path escape denied",
      };
    }

    const filePath = this.resolveTargetPath(proposal);

    // Path safety
    const qeDir = join(repositoryRoot, ".qe");
    const absPath = resolve(qeDir, filePath);
    const relToQe = relative(qeDir, absPath);

    if (relToQe.startsWith("..") || !absPath.startsWith(resolve(qeDir))) {
      return {
        target: proposal.target,
        operation: proposal.operation,
        filePath: `.qe/${filePath}`,
        applied: false,
        reason: "Path escape denied",
      };
    }

    if (this.isSymlinkEscape(absPath, repositoryRoot)) {
      return {
        target: proposal.target,
        operation: proposal.operation,
        filePath: `.qe/${filePath}`,
        applied: false,
        reason: "Symlink escape denied",
      };
    }

    // Content size check
    if (Buffer.byteLength(proposal.content, "utf-8") > MAX_CONTENT_SIZE_BYTES) {
      return {
        target: proposal.target,
        operation: proposal.operation,
        filePath: `.qe/${filePath}`,
        applied: false,
        reason: `Content exceeds ${MAX_CONTENT_SIZE_BYTES} bytes`,
      };
    }

    // Known-secret enforcement (Correction 1)
    if (this.containsKnownSecrets(proposal.content, options?.knownSecrets)) {
      return {
        target: proposal.target,
        operation: proposal.operation,
        filePath: `.qe/${filePath}`,
        applied: false,
        reason: "Content contains known secret value",
      };
    }

    // Regex-based secret detection
    if (this.containsSecrets(proposal.content)) {
      return {
        target: proposal.target,
        operation: proposal.operation,
        filePath: `.qe/${filePath}`,
        applied: false,
        reason: "Content contains potential secrets",
      };
    }

    // Evidence-backed durable memory enforcement (Correction 2)
    const category = this.classifyProposal(proposal);
    if (category === "CONFIRMED_FACT") {
      const evidenceIds = proposal.evidenceIds ?? [];
      if (evidenceIds.length === 0) {
        return {
          target: proposal.target,
          operation: proposal.operation,
          filePath: `.qe/${filePath}`,
          applied: false,
          reason:
            "Confirmed fact requires execution evidence IDs but none provided",
        };
      }
      if (options?.currentEvidence) {
        const currentIds = new Set(options.currentEvidence.map((e) => e.id));
        const allValid = evidenceIds.every((id) => currentIds.has(id));
        if (!allValid) {
          return {
            target: proposal.target,
            operation: proposal.operation,
            filePath: `.qe/${filePath}`,
            applied: false,
            reason: "Evidence ID does not match any current-run evidence",
          };
        }
      }
    }

    // Knowledge file count limit
    if (
      proposal.target === "KNOWLEDGE" &&
      proposal.operation === "ADD" &&
      existingMemory.knowledgeFiles.length >= MAX_KNOWLEDGE_FILES
    ) {
      return {
        target: proposal.target,
        operation: proposal.operation,
        filePath: `.qe/${filePath}`,
        applied: false,
        reason: `Knowledge file limit (${MAX_KNOWLEDGE_FILES}) reached`,
      };
    }

    // Deduplication: check if the content already exists
    if (proposal.operation === "ADD") {
      const isDuplicate = this.isDuplicateContent(proposal, existingMemory);
      if (isDuplicate) {
        return {
          target: proposal.target,
          operation: proposal.operation,
          filePath: `.qe/${filePath}`,
          applied: false,
          reason: "Duplicate content already exists in memory",
        };
      }
    }

    // Build final content, preserving human sections
    let finalContent: string;
    if (proposal.operation === "REMOVE") {
      finalContent = "";
    } else {
      finalContent = await this.buildFinalContent(
        absPath,
        proposal,
        existingMemory,
      );
    }

    // File size check
    if (Buffer.byteLength(finalContent, "utf-8") > MAX_FILE_SIZE_BYTES) {
      return {
        target: proposal.target,
        operation: proposal.operation,
        filePath: `.qe/${filePath}`,
        applied: false,
        reason: `File would exceed ${MAX_FILE_SIZE_BYTES} bytes`,
      };
    }

    // Atomic write (with runtime .gitignore — Correction 6)
    try {
      await mkdir(dirname(absPath), { recursive: true });
      await this.ensureGitignore(repositoryRoot);
      const tmpPath = absPath + ".qe-tmp";
      await writeFile(tmpPath, finalContent, "utf-8");
      await rename(tmpPath, absPath);
    } catch (err) {
      return {
        target: proposal.target,
        operation: proposal.operation,
        filePath: `.qe/${filePath}`,
        applied: false,
        reason: `Write failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return {
      target: proposal.target,
      operation: proposal.operation,
      filePath: `.qe/${filePath}`,
      applied: true,
    };
  }

  private resolveTargetPath(proposal: MemoryUpdateProposal): string {
    switch (proposal.target) {
      case "PROJECT":
        return "PROJECT.md";
      case "TESTING":
        return "TESTING.md";
      case "RISKS":
        return "RISKS.md";
      case "KNOWLEDGE": {
        const topic = proposal.topic ?? "general";
        const safeName = topic.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
        return `knowledge/${safeName}.md`;
      }
      case "HISTORY": {
        const name = proposal.topic ?? `summary-${Date.now()}`;
        const safeName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
        return `history/summaries/${safeName}.md`;
      }
    }
  }

  containsSecrets(content: string): boolean {
    for (const pattern of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) return true;
    }
    return false;
  }

  containsKnownSecrets(content: string, knownSecrets?: string[]): boolean {
    if (!knownSecrets || knownSecrets.length === 0) return false;
    for (const secret of knownSecrets) {
      if (secret.length < 4) continue;
      if (content.includes(secret)) return true;
    }
    return false;
  }

  classifyProposal(proposal: MemoryUpdateProposal): MemoryClaimCategory {
    if (proposal.target === "HISTORY") return "HISTORY_SUMMARY";

    if (
      proposal.target === "PROJECT" &&
      !this.isConfirmedFactContent(proposal.content)
    ) {
      return "PROJECT_METADATA";
    }

    if (
      proposal.target === "TESTING" &&
      !this.isConfirmedFactContent(proposal.content)
    ) {
      return "TESTING_PROCEDURE";
    }

    if (proposal.target === "RISKS") {
      return "RISK_OR_HYPOTHESIS";
    }

    if (this.isConfirmedFactContent(proposal.content)) {
      return "CONFIRMED_FACT";
    }

    if (proposal.target === "KNOWLEDGE") {
      if (this.isConfirmedFactContent(proposal.content)) {
        return "CONFIRMED_FACT";
      }
      return "PROJECT_METADATA";
    }

    return "PROJECT_METADATA";
  }

  private isConfirmedFactContent(content: string): boolean {
    for (const pattern of CONFIRMED_FACT_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) return true;
    }
    return false;
  }

  private isDuplicateContent(
    proposal: MemoryUpdateProposal,
    existingMemory: ProjectMemory,
  ): boolean {
    const normalizedNew = this.normalizeForComparison(proposal.content);
    if (normalizedNew.length === 0) return false;

    switch (proposal.target) {
      case "PROJECT":
        if (existingMemory.project) {
          return this.normalizeForComparison(
            existingMemory.project.content,
          ).includes(normalizedNew);
        }
        return false;

      case "TESTING":
        if (existingMemory.testing) {
          return this.normalizeForComparison(
            existingMemory.testing.content,
          ).includes(normalizedNew);
        }
        return false;

      case "RISKS":
        if (existingMemory.risks) {
          return existingMemory.risks.entries.some(
            (e) =>
              this.normalizeForComparison(e.content).includes(normalizedNew) ||
              normalizedNew.includes(this.normalizeForComparison(e.content)),
          );
        }
        return false;

      case "KNOWLEDGE":
        return existingMemory.knowledgeFiles.some(
          (k) =>
            this.normalizeForComparison(k.content).includes(normalizedNew) ||
            (proposal.topic && k.name === proposal.topic),
        );

      default:
        return false;
    }
  }

  private normalizeForComparison(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }

  private async buildFinalContent(
    absPath: string,
    proposal: MemoryUpdateProposal,
    _existingMemory: ProjectMemory,
  ): Promise<string> {
    let existingContent = "";
    try {
      existingContent = await readFile(absPath, "utf-8");
    } catch {
      // File doesn't exist yet
    }

    const managedStart = "<!-- qe-managed:start -->";
    const managedEnd = "<!-- qe-managed:end -->";

    if (!existingContent) {
      if (
        proposal.target === "TESTING" ||
        proposal.target === "RISKS" ||
        proposal.target === "KNOWLEDGE"
      ) {
        return `${managedStart}\n${proposal.content}\n${managedEnd}\n`;
      }
      return proposal.content;
    }

    // For UPDATE operations on files with QE-managed sections, replace only those

    if (
      existingContent.includes(managedStart) &&
      existingContent.includes(managedEnd)
    ) {
      const beforeManaged = existingContent.slice(
        0,
        existingContent.indexOf(managedStart),
      );
      const afterManaged = existingContent.slice(
        existingContent.indexOf(managedEnd) + managedEnd.length,
      );
      return `${beforeManaged}${managedStart}\n${proposal.content}\n${managedEnd}${afterManaged}`;
    }

    // For TESTING, RISKS, KNOWLEDGE: wrap in managed sections to prevent
    // repeated appending of semantically similar run-outcome paragraphs.
    if (
      proposal.target === "TESTING" ||
      proposal.target === "RISKS" ||
      proposal.target === "KNOWLEDGE"
    ) {
      return `${existingContent.trimEnd()}\n\n${managedStart}\n${proposal.content}\n${managedEnd}\n`;
    }

    // For PROJECT, HISTORY: existing append behavior
    if (proposal.operation === "UPDATE" || proposal.operation === "ADD") {
      return existingContent.trimEnd() + "\n\n" + proposal.content + "\n";
    }

    return proposal.content;
  }

  parseRisks(content: string): RiskEntry[] {
    const entries: RiskEntry[] = [];
    const sections = content.split(/^## /m);

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      const firstNewline = trimmed.indexOf("\n");
      if (firstNewline === -1) {
        entries.push({ topic: trimmed, content: "" });
      } else {
        entries.push({
          topic: trimmed.slice(0, firstNewline).trim(),
          content: trimmed.slice(firstNewline + 1).trim(),
        });
      }
    }

    return entries;
  }

  private async safeReadFile(
    path: string,
    warnings: MemoryWarning[],
  ): Promise<string | undefined> {
    try {
      const content = await readFile(path, "utf-8");
      if (Buffer.byteLength(content, "utf-8") > MAX_FILE_SIZE_BYTES) {
        warnings.push({
          type: "MALFORMED",
          source: path,
          message: `File exceeds ${MAX_FILE_SIZE_BYTES} bytes, truncating`,
        });
        return content.slice(0, MAX_FILE_SIZE_BYTES);
      }
      return content;
    } catch (err) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return undefined;
      }
      warnings.push({
        type: "READ_FAILURE",
        source: path,
        message: `Read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return undefined;
    }
  }

  private async getModTime(path: string): Promise<string | undefined> {
    try {
      const s = await stat(path);
      return s.mtime.toISOString();
    } catch {
      return undefined;
    }
  }

  isSymlinkEscape(filePath: string, repositoryRoot: string): boolean {
    try {
      const repoReal = realpathSync(repositoryRoot);
      const qeReal = resolve(repoReal, ".qe");
      let currentPath = dirname(filePath);

      while (
        currentPath !== repositoryRoot &&
        currentPath !== "/" &&
        currentPath !== "."
      ) {
        try {
          const s = lstatSync(currentPath);
          if (s.isSymbolicLink()) {
            const resolved = realpathSync(currentPath);
            const resolvedRelRepo = relative(repoReal, resolved);
            if (resolvedRelRepo.startsWith("..")) return true;
            const resolvedRelQe = relative(qeReal, resolved);
            if (resolvedRelQe.startsWith("..")) return true;
          }
        } catch {
          break;
        }
        currentPath = dirname(currentPath);
      }
      return false;
    } catch {
      return true;
    }
  }

  async ensureGitignore(repositoryRoot: string): Promise<void> {
    const gitignorePath = join(repositoryRoot, ".qe", ".gitignore");
    if (existsSync(gitignorePath)) return;

    const qeDir = join(repositoryRoot, ".qe");
    if (!existsSync(qeDir)) return;

    const content = `# Ephemeral QE artifacts — not committed
runs/
cache/
artifacts/
traces/
`;
    await writeFile(gitignorePath, content, "utf-8");
  }

  detectStaleMemoryConflicts(
    memory: ProjectMemory,
    repositoryProfile: {
      packageManagers?: { name: string }[];
      commands?: { name: string; command: string; category: string }[];
      testFrameworks?: { name: string }[];
    },
  ): MemoryWarning[] {
    const warnings: MemoryWarning[] = [];

    if (!memory.testing) return warnings;

    const testingContent = memory.testing.content.toLowerCase();

    const pkgManagers = repositoryProfile.packageManagers ?? [];
    const commands = repositoryProfile.commands ?? [];

    const knownPkgManagers = ["npm", "pnpm", "yarn", "bun"];
    const repoPkgManager =
      pkgManagers.length > 0 ? pkgManagers[0].name.toLowerCase() : undefined;

    if (repoPkgManager) {
      for (const mgr of knownPkgManagers) {
        if (mgr === repoPkgManager) continue;
        const wordBoundary = new RegExp(
          `(?<![a-z])${mgr}(?![a-z])\\s+(?:test|run)`,
          "i",
        );
        if (wordBoundary.test(testingContent)) {
          warnings.push({
            type: "STALE",
            source: ".qe/TESTING.md",
            message: `Memory references '${mgr}' commands but repository uses '${repoPkgManager}'`,
            proposedCorrection: `Update TESTING.md to use '${repoPkgManager}' instead of '${mgr}'`,
          });
        }
      }
    }

    const testCommands = commands.filter((c) => c.category === "TEST");
    if (testCommands.length > 0) {
      const canonicalTestCmd = testCommands[0].command.toLowerCase();
      for (const mgr of knownPkgManagers) {
        if (canonicalTestCmd.includes(mgr)) continue;
        const stalePattern = `\`${mgr} test\``;
        if (memory.testing.content.includes(stalePattern)) {
          const alreadyWarned = warnings.some(
            (w) => w.source === ".qe/TESTING.md" && w.message.includes(mgr),
          );
          if (!alreadyWarned) {
            warnings.push({
              type: "STALE",
              source: ".qe/TESTING.md",
              message: `Memory references '${mgr} test' but discovered test command is '${testCommands[0].command}'`,
              proposedCorrection: `Update TESTING.md test command to '${testCommands[0].command}'`,
            });
          }
        }
      }
    }

    return warnings;
  }
}
