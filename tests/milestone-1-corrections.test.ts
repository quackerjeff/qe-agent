import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyzeRepository } from "../src/repository/index.js";
import { RepositoryProfileSchema } from "../src/types/index.js";

const execFileAsync = promisify(execFile);
const FIXTURES = resolve(import.meta.dirname, "..", "fixtures");
const PROJECT_ROOT = resolve(import.meta.dirname, "..");

// Regression 1: Nested directory analysis resolves appropriate project metadata
describe("Correction 1 — Nested directory analysis", () => {
  it("resolves project root from a nested src/ directory", async () => {
    const nestedPath = resolve(FIXTURES, "node-vitest", "src");
    const profile = await analyzeRepository({ targetPath: nestedPath });
    expect(profile.root).toBe(resolve(FIXTURES, "node-vitest"));
    const ts = profile.languages.find((l) => l.id === "typescript");
    expect(ts).toBeDefined();
    const npm = profile.packageManagers.find((p) => p.id === "npm");
    expect(npm).toBeDefined();
    const vitest = profile.testFrameworks.find((t) => t.id === "vitest");
    expect(vitest).toBeDefined();
  });

  it("resolves root correctly when invoked at the project root", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    expect(profile.root).toBe(resolve(FIXTURES, "node-vitest"));
  });

  it("resolves root for non-git nested project", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "custom-build"),
    });
    expect(profile.root).toBe(resolve(FIXTURES, "custom-build"));
  });
});

// Regression 2: Nested projects do not pollute parent repository technologies
describe("Correction 2 — Nested project pollution", () => {
  it("does not report fixture technologies as root-level QE Agent technologies", async () => {
    const profile = await analyzeRepository({ targetPath: PROJECT_ROOT });
    const result = RepositoryProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);

    const python = profile.languages.find((l) => l.id === "python");
    expect(python).toBeUndefined();

    const csharp = profile.languages.find((l) => l.id === "csharp");
    expect(csharp).toBeUndefined();

    const pytest = profile.testFrameworks.find((t) => t.id === "pytest");
    expect(pytest).toBeUndefined();

    const xunit = profile.testFrameworks.find((t) => t.id === "xunit");
    expect(xunit).toBeUndefined();
  });

  it("reports nested fixture directories as nested applications", async () => {
    const profile = await analyzeRepository({ targetPath: PROJECT_ROOT });
    const nestedApps = profile.applications.filter((a) =>
      a.id.startsWith("nested:"),
    );
    expect(nestedApps.length).toBeGreaterThan(0);
  });
});

// Regression 3: Python packaging signals produce evidence-backed results
describe("Correction 3 — Python packaging detection", () => {
  it("detects package management for pyproject.toml-only project", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "python-pytest"),
    });
    expect(profile.packageManagers.length).toBeGreaterThan(0);
    const pm = profile.packageManagers[0];
    expect(pm.evidence.length).toBeGreaterThan(0);
    expect(pm.evidence[0].source).toBe("pyproject.toml");
  });

  it("does not claim high confidence for pyproject.toml-only PM detection", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "python-pytest"),
    });
    const pm = profile.packageManagers[0];
    expect(pm.confidence).toBeLessThan(0.7);
  });
});

// Regression 4: Simple make test discovery works
describe("Correction 4 — Makefile command discovery", () => {
  it("discovers make build and make test commands", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "custom-build"),
    });
    const makeBuild = profile.commands.find(
      (c) => c.command === "make build" && c.category === "BUILD",
    );
    const makeTest = profile.commands.find(
      (c) => c.command === "make test" && c.category === "TEST",
    );
    expect(makeBuild).toBeDefined();
    expect(makeBuild!.source).toBe("Makefile");
    expect(makeTest).toBeDefined();
    expect(makeTest!.source).toBe("Makefile");
  });
});

// Regression 5: CI make test is classified correctly
describe("Correction 5 — CI command classification", () => {
  it("classifies 'make test' in CI as TEST", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "custom-build"),
    });
    const ciTestCmd = profile.commands.find(
      (c) =>
        c.source.includes(".github/workflows") &&
        c.command === "make test" &&
        c.category === "TEST",
    );
    expect(ciTestCmd).toBeDefined();
  });

  it("classifies 'make build' in CI as BUILD", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "custom-build"),
    });
    const ciBuildCmd = profile.commands.find(
      (c) =>
        c.source.includes(".github/workflows") &&
        c.command === "make build" &&
        c.category === "BUILD",
    );
    expect(ciBuildCmd).toBeDefined();
  });
});

// Regression 6: qe analyze --json produces parseable JSON stdout
describe("Correction 6 — Valid JSON output", () => {
  it("produces parseable JSON on stdout", async () => {
    const { stdout } = await execFileAsync(
      "node",
      ["--import", "tsx", "src/cli/main.ts", "analyze", "--json"],
      { cwd: PROJECT_ROOT },
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.repositoryProfile).toBeDefined();
    expect(parsed.repositoryProfile.root).toBeDefined();
    expect(parsed.repositoryProfile.languages).toBeInstanceOf(Array);
    expect(parsed.repositoryProfile.commands).toBeInstanceOf(Array);
    expect(parsed.aiUsage).toBeDefined();
  });
});

// Regression 7: .NET framework evidence points to the correct source file
describe("Correction 7 — .NET evidence provenance", () => {
  it("cites the test project file for xUnit detection, not the app project", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "dotnet-xunit"),
    });
    const xunit = profile.testFrameworks.find((t) => t.id === "xunit");
    expect(xunit).toBeDefined();
    const evidenceSources = xunit!.evidence.map((e) => e.source);
    expect(evidenceSources.some((s) => s.includes("MyApp.Tests"))).toBe(true);
    expect(
      evidenceSources.every((s) => !s.includes("src/MyApp/MyApp.csproj")),
    ).toBe(true);
  });

  it("cites the correct file for ASP.NET Core framework detection", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "dotnet-xunit"),
    });
    const aspnet = profile.frameworks.find((f) => f.id === "aspnet-core");
    expect(aspnet).toBeDefined();
    expect(
      aspnet!.evidence.some((e) => e.source.includes("MyApp.csproj")),
    ).toBe(true);
  });
});

// Regression 8: Ambiguous JavaScript package managers do not produce unjustified certainty
describe("Correction 8 — Ambiguous JS package managers", () => {
  it("lowers confidence when multiple lockfiles exist", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-ambiguous-pm"),
    });
    const npm = profile.packageManagers.find((p) => p.id === "npm");
    const pnpm = profile.packageManagers.find((p) => p.id === "pnpm");
    expect(npm).toBeDefined();
    expect(pnpm).toBeDefined();
    expect(npm!.confidence).toBeLessThanOrEqual(0.6);
    expect(pnpm!.confidence).toBeLessThanOrEqual(0.6);
  });

  it("records ambiguity evidence on each package manager", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-ambiguous-pm"),
    });
    for (const pm of profile.packageManagers) {
      expect(
        pm.evidence.some((e) => e.reason.toLowerCase().includes("ambiguous")),
      ).toBe(true);
    }
  });
});
