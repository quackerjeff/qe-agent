import { resolve, relative, basename, dirname } from "node:path";
import { lstatSync, realpathSync } from "node:fs";

export type FileClassification = "TEST" | "PRODUCTION" | "UNCERTAIN";

const TEST_DIR_PATTERNS = [
  "tests",
  "test",
  "__tests__",
  "spec",
  "__spec__",
  "e2e",
  "integration",
  "test-utils",
  "test-helpers",
  "fixtures",
  "__fixtures__",
  "__mocks__",
];

const TEST_FILE_SUFFIXES = [
  ".test.",
  ".spec.",
  ".tests.",
  ".specs.",
  "_test.",
  "_spec.",
  ".test-",
];

const PRODUCTION_PATTERNS = [
  "src/",
  "lib/",
  "app/",
  "pkg/",
  "cmd/",
  "internal/",
  "public/",
  "dist/",
  "build/",
  "out/",
];

const DENIED_FILENAMES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".env",
  ".env.local",
  ".env.production",
  "Makefile",
  "Gemfile",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "settings.gradle",
]);

const DENIED_EXTENSIONS = new Set([
  ".sql",
  ".sh",
  ".bash",
  ".yml",
  ".yaml",
  ".toml",
  ".lock",
  ".json",
  ".xml",
  ".gradle",
  ".properties",
  ".cfg",
  ".ini",
  ".conf",
]);

const CI_PATHS = [".github/", ".gitlab-ci", ".circleci/", "Jenkinsfile"];

export function classifyTestPath(
  filePath: string,
  repositoryRoot: string,
  testDirectories?: string[],
): FileClassification {
  const absPath = resolve(repositoryRoot, filePath);
  const rel = relative(repositoryRoot, absPath);

  if (rel.startsWith("..") || resolve(absPath) !== absPath) {
    return "PRODUCTION";
  }

  const name = basename(rel);
  const ext = getCompoundExtension(name);

  if (DENIED_FILENAMES.has(name)) return "PRODUCTION";

  for (const ciPath of CI_PATHS) {
    if (rel.startsWith(ciPath) || rel === ciPath.replace("/", "")) {
      return "PRODUCTION";
    }
  }

  if (DENIED_EXTENSIONS.has(ext) && !hasTestSuffix(name)) {
    return "PRODUCTION";
  }

  const segments = rel.split("/");

  if (testDirectories) {
    for (const testDir of testDirectories) {
      const testRel = relative(
        repositoryRoot,
        resolve(repositoryRoot, testDir),
      );
      if (rel.startsWith(testRel + "/") || rel === testRel) {
        return "TEST";
      }
    }
  }

  for (const seg of segments) {
    if (TEST_DIR_PATTERNS.includes(seg.toLowerCase())) {
      return "TEST";
    }
  }

  if (hasTestSuffix(name)) {
    return "TEST";
  }

  for (const prod of PRODUCTION_PATTERNS) {
    if (rel.startsWith(prod) && !hasTestSuffix(name)) {
      return "PRODUCTION";
    }
  }

  return "UNCERTAIN";
}

export function isPathTraversal(
  filePath: string,
  repositoryRoot: string,
): boolean {
  const absPath = resolve(repositoryRoot, filePath);
  const rel = relative(repositoryRoot, absPath);
  return rel.startsWith("..");
}

export function isSymlinkEscape(
  filePath: string,
  repositoryRoot: string,
): boolean {
  try {
    const absPath = resolve(repositoryRoot, filePath);
    const dirPath = dirname(absPath);

    let currentPath = dirPath;
    const repoReal = realpathSync(repositoryRoot);

    while (currentPath !== repositoryRoot && currentPath !== "/") {
      try {
        const stat = lstatSync(currentPath);
        if (stat.isSymbolicLink()) {
          const resolved = realpathSync(currentPath);
          const resolvedRel = relative(repoReal, resolved);
          if (resolvedRel.startsWith("..")) return true;
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

function hasTestSuffix(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TEST_FILE_SUFFIXES.some((s) => lower.includes(s));
}

function getCompoundExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return "";
  return filename.slice(dotIndex).toLowerCase();
}
