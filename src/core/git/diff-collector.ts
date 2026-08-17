import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitDiffFile {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
}

export interface GitDiffData {
  baselineRef: string;
  targetRef: string;
  changedFiles: GitDiffFile[];
  addedFiles: string[];
  deletedFiles: string[];
  renamedFiles: { from: string; to: string }[];
  modifiedFiles: string[];
  changedTests: string[];
  changedConfiguration: string[];
  changedDependencyMetadata: string[];
  diffStat: string;
}

const TEST_PATTERNS = [
  /\btest[s]?\b/i,
  /\bspec[s]?\b/i,
  /\b__tests__\b/,
  /\.test\.\w+$/,
  /\.spec\.\w+$/,
  /_test\.\w+$/,
  /test_.*\.\w+$/,
];

const CONFIG_PATTERNS = [
  /\.yml$/,
  /\.yaml$/,
  /\.json$/,
  /\.toml$/,
  /\.ini$/,
  /\.env/,
  /\.config\.\w+$/,
  /tsconfig/,
  /eslint/,
  /prettier/,
  /vitest\.config/,
  /jest\.config/,
  /webpack\.config/,
  /vite\.config/,
  /Dockerfile/,
  /docker-compose/,
  /\.github\//,
  /\.gitlab-ci/,
  /Makefile/,
];

const DEPENDENCY_PATTERNS = [
  /package\.json$/,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  /Gemfile$/,
  /Gemfile\.lock$/,
  /requirements\.txt$/,
  /Pipfile$/,
  /Pipfile\.lock$/,
  /pyproject\.toml$/,
  /poetry\.lock$/,
  /go\.mod$/,
  /go\.sum$/,
  /Cargo\.toml$/,
  /Cargo\.lock$/,
  /\.csproj$/,
  /\.sln$/,
  /Directory\.Build\.props$/,
];

function classifyFile(path: string): {
  isTest: boolean;
  isConfig: boolean;
  isDependency: boolean;
} {
  return {
    isTest: TEST_PATTERNS.some((p) => p.test(path)),
    isConfig: CONFIG_PATTERNS.some((p) => p.test(path)),
    isDependency: DEPENDENCY_PATTERNS.some((p) => p.test(path)),
  };
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export async function resolveRef(ref: string, cwd: string): Promise<string> {
  const out = await git(["rev-parse", ref], cwd);
  return out.trim();
}

export async function getCurrentRef(cwd: string): Promise<string> {
  try {
    const out = await git(["rev-parse", "HEAD"], cwd);
    return out.trim();
  } catch {
    return "WORKING_TREE";
  }
}

export async function collectDiff(
  baselineRef: string,
  targetRef: string,
  cwd: string,
): Promise<GitDiffData> {
  const resolvedBase = await resolveRef(baselineRef, cwd);
  const resolvedTarget = await resolveRef(targetRef, cwd);

  const nameStatusOut = await git(
    ["diff", "--name-status", "-M", resolvedBase, resolvedTarget],
    cwd,
  );

  const diffStatOut = await git(
    ["diff", "--stat", resolvedBase, resolvedTarget],
    cwd,
  );

  const changedFiles: GitDiffFile[] = [];
  const addedFiles: string[] = [];
  const deletedFiles: string[] = [];
  const renamedFiles: { from: string; to: string }[] = [];
  const modifiedFiles: string[] = [];
  const changedTests: string[] = [];
  const changedConfiguration: string[] = [];
  const changedDependencyMetadata: string[] = [];

  for (const line of nameStatusOut.split("\n")) {
    if (!line.trim()) continue;

    const parts = line.split("\t");
    const status = parts[0];

    if (status.startsWith("R")) {
      const oldPath = parts[1];
      const newPath = parts[2];
      changedFiles.push({ path: newPath, changeType: "renamed", oldPath });
      renamedFiles.push({ from: oldPath, to: newPath });
      classifyAndPush(
        newPath,
        changedTests,
        changedConfiguration,
        changedDependencyMetadata,
      );
    } else if (status === "A") {
      const path = parts[1];
      changedFiles.push({ path, changeType: "added" });
      addedFiles.push(path);
      classifyAndPush(
        path,
        changedTests,
        changedConfiguration,
        changedDependencyMetadata,
      );
    } else if (status === "D") {
      const path = parts[1];
      changedFiles.push({ path, changeType: "deleted" });
      deletedFiles.push(path);
      classifyAndPush(
        path,
        changedTests,
        changedConfiguration,
        changedDependencyMetadata,
      );
    } else if (status === "M") {
      const path = parts[1];
      changedFiles.push({ path, changeType: "modified" });
      modifiedFiles.push(path);
      classifyAndPush(
        path,
        changedTests,
        changedConfiguration,
        changedDependencyMetadata,
      );
    }
  }

  return {
    baselineRef: resolvedBase,
    targetRef: resolvedTarget,
    changedFiles,
    addedFiles,
    deletedFiles,
    renamedFiles,
    modifiedFiles,
    changedTests,
    changedConfiguration,
    changedDependencyMetadata,
    diffStat: diffStatOut.trim(),
  };
}

function classifyAndPush(
  path: string,
  tests: string[],
  config: string[],
  deps: string[],
): void {
  const cls = classifyFile(path);
  if (cls.isTest) tests.push(path);
  if (cls.isConfig) config.push(path);
  if (cls.isDependency) deps.push(path);
}

export async function getFileDiff(
  baselineRef: string,
  targetRef: string,
  filePath: string,
  cwd: string,
  maxBytes: number = 8192,
): Promise<string> {
  const out = await git(["diff", baselineRef, targetRef, "--", filePath], cwd);
  if (out.length > maxBytes) {
    return out.slice(0, maxBytes) + `\n... (truncated at ${maxBytes} bytes)`;
  }
  return out;
}

export async function getFileContent(
  ref: string,
  filePath: string,
  cwd: string,
  maxBytes: number = 16384,
): Promise<string | null> {
  try {
    const out = await git(["show", `${ref}:${filePath}`], cwd);
    if (out.length > maxBytes) {
      return out.slice(0, maxBytes) + `\n... (truncated at ${maxBytes} bytes)`;
    }
    return out;
  } catch {
    return null;
  }
}
