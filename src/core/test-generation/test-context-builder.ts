import { resolve, relative, dirname, basename, extname } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import type {
  RepositoryProfile,
  DiscoveredCommand,
} from "../../types/index.js";

const MAX_CONTEXT_FILES = 5;
const MAX_FILE_CHARS = 4000;

export interface TestContext {
  testFramework: string;
  testCommand?: DiscoveredCommand;
  conventions: TestConventions;
  relatedTestFiles: TestFileSnippet[];
  fixtures: string[];
  helpers: string[];
}

export interface TestConventions {
  namingPattern: string;
  testDirectory: string;
  importStyle: string;
  assertionLibrary: string;
  fixturePatterns: string[];
  setupTeardown: string[];
}

export interface TestFileSnippet {
  path: string;
  content: string;
  truncated: boolean;
}

export function buildTestContext(
  profile: RepositoryProfile,
  targetBehavior: string,
  changedFiles?: string[],
): TestContext {
  const testFramework = detectTestFramework(profile);
  const testCommand = findTestCommand(profile);
  const testDirs = findTestDirectories(profile.root);
  const relatedTests = findRelatedTestFiles(
    profile.root,
    testDirs,
    changedFiles ?? [],
  );
  const conventions = inferConventions(profile, relatedTests);
  const fixtures = findFixtures(profile.root, testDirs);
  const helpers = findHelpers(profile.root, testDirs);

  return {
    testFramework,
    testCommand,
    conventions,
    relatedTestFiles: relatedTests,
    fixtures,
    helpers,
  };
}

function detectTestFramework(profile: RepositoryProfile): string {
  if (profile.testFrameworks.length > 0) {
    return profile.testFrameworks[0].name;
  }
  const testCmd = profile.commands.find((c) => c.category === "TEST");
  if (testCmd) {
    const cmd = testCmd.command.toLowerCase();
    if (cmd.includes("vitest")) return "Vitest";
    if (cmd.includes("jest")) return "Jest";
    if (cmd.includes("mocha")) return "Mocha";
    if (cmd.includes("pytest")) return "pytest";
    if (cmd.includes("dotnet test")) return "xUnit";
    if (cmd.includes("nunit")) return "NUnit";
  }
  return "unknown";
}

function findTestCommand(
  profile: RepositoryProfile,
): DiscoveredCommand | undefined {
  return profile.commands.find(
    (c) => c.category === "TEST" && c.executionSupport === "STRUCTURED",
  );
}

function findTestDirectories(root: string): string[] {
  const candidates = [
    "tests",
    "test",
    "__tests__",
    "spec",
    "e2e",
    "integration",
  ];
  const found: string[] = [];
  for (const dir of candidates) {
    const fullPath = resolve(root, dir);
    if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
      found.push(dir);
    }
  }
  return found;
}

function findRelatedTestFiles(
  root: string,
  testDirs: string[],
  changedFiles: string[],
): TestFileSnippet[] {
  const testFiles: string[] = [];

  for (const dir of testDirs) {
    const fullDir = resolve(root, dir);
    if (!existsSync(fullDir)) continue;
    try {
      const entries = readdirSync(fullDir);
      for (const entry of entries) {
        const entryPath = resolve(fullDir, entry);
        try {
          if (statSync(entryPath).isFile() && isTestFile(entry)) {
            testFiles.push(relative(root, entryPath));
          }
        } catch {
          /* skip inaccessible */
        }
      }
    } catch {
      /* skip inaccessible */
    }
  }

  const changedBases = changedFiles.map((f) =>
    basename(f, extname(f)).replace(/\.(test|spec)$/, ""),
  );

  const sorted = testFiles.sort((a, b) => {
    const aBase = basename(a, extname(a)).replace(/\.(test|spec)$/, "");
    const bBase = basename(b, extname(b)).replace(/\.(test|spec)$/, "");
    const aRelated = changedBases.some(
      (cb) => aBase.includes(cb) || cb.includes(aBase),
    );
    const bRelated = changedBases.some(
      (cb) => bBase.includes(cb) || cb.includes(bBase),
    );
    if (aRelated && !bRelated) return -1;
    if (!aRelated && bRelated) return 1;
    return 0;
  });

  return sorted.slice(0, MAX_CONTEXT_FILES).map((f) => {
    const fullPath = resolve(root, f);
    try {
      const content = readFileSync(fullPath, "utf-8");
      const truncated = content.length > MAX_FILE_CHARS;
      return {
        path: f,
        content: truncated ? content.slice(0, MAX_FILE_CHARS) : content,
        truncated,
      };
    } catch {
      return { path: f, content: "", truncated: false };
    }
  });
}

function inferConventions(
  profile: RepositoryProfile,
  testFiles: TestFileSnippet[],
): TestConventions {
  const allContent = testFiles.map((f) => f.content).join("\n");

  let namingPattern = "*.test.ts";
  if (testFiles.some((f) => f.path.includes(".spec.")))
    namingPattern = "*.spec.ts";
  if (testFiles.some((f) => f.path.includes("test_")))
    namingPattern = "test_*.py";
  if (testFiles.some((f) => f.path.endsWith(".cs")))
    namingPattern = "*Tests.cs";

  let testDirectory = "tests";
  if (testFiles.length > 0) {
    const firstDir = dirname(testFiles[0].path).split("/")[0];
    if (firstDir && firstDir !== ".") testDirectory = firstDir;
  }

  let importStyle = "esm";
  if (allContent.includes("require(")) importStyle = "commonjs";
  if (allContent.includes('from "') || allContent.includes("from '"))
    importStyle = "esm";

  let assertionLibrary = "expect";
  if (allContent.includes("assert.")) assertionLibrary = "assert";
  if (allContent.includes(".should.")) assertionLibrary = "should";
  if (allContent.includes("Assert.")) assertionLibrary = "Assert";

  const fixturePatterns: string[] = [];
  if (allContent.includes("beforeEach")) fixturePatterns.push("beforeEach");
  if (allContent.includes("beforeAll")) fixturePatterns.push("beforeAll");
  if (allContent.includes("setUp")) fixturePatterns.push("setUp");
  if (allContent.includes("@pytest.fixture"))
    fixturePatterns.push("pytest.fixture");

  const setupTeardown: string[] = [];
  if (allContent.includes("afterEach")) setupTeardown.push("afterEach");
  if (allContent.includes("afterAll")) setupTeardown.push("afterAll");
  if (allContent.includes("tearDown")) setupTeardown.push("tearDown");

  return {
    namingPattern,
    testDirectory,
    importStyle,
    assertionLibrary,
    fixturePatterns,
    setupTeardown,
  };
}

function findFixtures(root: string, testDirs: string[]): string[] {
  const fixtureNames = ["fixtures", "__fixtures__", "testdata", "test-data"];
  const found: string[] = [];
  for (const dir of testDirs) {
    for (const fixture of fixtureNames) {
      const p = resolve(root, dir, fixture);
      if (existsSync(p) && statSync(p).isDirectory()) {
        found.push(relative(root, p));
      }
    }
  }
  return found;
}

function findHelpers(root: string, testDirs: string[]): string[] {
  const helperNames = ["helpers", "utils", "support", "test-utils"];
  const found: string[] = [];
  for (const dir of testDirs) {
    for (const helper of helperNames) {
      const p = resolve(root, dir, helper);
      if (existsSync(p) && statSync(p).isDirectory()) {
        found.push(relative(root, p));
      }
    }
  }
  return found;
}

function isTestFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.includes("_test.") ||
    lower.includes("_spec.") ||
    lower.startsWith("test_") ||
    lower.endsWith("tests.cs") ||
    lower.endsWith("test.py")
  );
}
