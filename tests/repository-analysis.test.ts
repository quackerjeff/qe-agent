import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { analyzeRepository } from "../src/repository/index.js";
import { RepositoryProfileSchema } from "../src/types/index.js";

const FIXTURES = resolve(import.meta.dirname, "..", "fixtures");

describe("Repository analysis — node-vitest fixture", () => {
  const fixturePath = resolve(FIXTURES, "node-vitest");

  it("produces a valid RepositoryProfile", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const result = RepositoryProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("detects TypeScript language with evidence", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const ts = profile.languages.find((l) => l.id === "typescript");
    expect(ts).toBeDefined();
    expect(ts!.category).toBe("language");
    expect(ts!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(ts!.evidence.length).toBeGreaterThan(0);
    expect(ts!.evidence.some((e) => e.source === "tsconfig.json")).toBe(true);
  });

  it("detects JavaScript language", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const js = profile.languages.find((l) => l.id === "javascript");
    expect(js).toBeDefined();
  });

  it("detects npm package manager with evidence", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const npm = profile.packageManagers.find((p) => p.id === "npm");
    expect(npm).toBeDefined();
    expect(npm!.evidence.some((e) => e.source === "package-lock.json")).toBe(
      true,
    );
  });

  it("detects Vitest test framework with evidence", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const vitest = profile.testFrameworks.find((t) => t.id === "vitest");
    expect(vitest).toBeDefined();
    expect(vitest!.category).toBe("testFramework");
    expect(vitest!.evidence.length).toBeGreaterThanOrEqual(2);
    expect(vitest!.evidence.some((e) => e.source === "vitest.config.ts")).toBe(
      true,
    );
    expect(vitest!.evidence.some((e) => e.source === "package.json")).toBe(
      true,
    );
  });

  it("detects React and Express frameworks", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(profile.frameworks.find((f) => f.id === "react")).toBeDefined();
    expect(profile.frameworks.find((f) => f.id === "express")).toBeDefined();
  });

  it("discovers build/test/lint/typecheck/start commands", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const categories = profile.commands.map((c) => c.category);
    expect(categories).toContain("BUILD");
    expect(categories).toContain("TEST");
    expect(categories).toContain("LINT");
    expect(categories).toContain("TYPECHECK");
    expect(categories).toContain("START");
  });

  it("populates capabilities from detections", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(profile.capabilities.find((c) => c.id === "node.npm")).toBeDefined();
    expect(
      profile.capabilities.find((c) => c.id === "node.vitest"),
    ).toBeDefined();
    expect(
      profile.capabilities.find((c) => c.id === "generic.shell"),
    ).toBeDefined();
  });

  it("discovers README documentation", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(
      profile.documentation.find((d) => d.path === "README.md"),
    ).toBeDefined();
  });

  it("all commands have provenance", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    for (const cmd of profile.commands) {
      expect(cmd.source).toBeTruthy();
      expect(cmd.id).toBeTruthy();
      expect(cmd.confidence).toBeGreaterThan(0);
    }
  });
});

describe("Repository analysis — python-pytest fixture", () => {
  const fixturePath = resolve(FIXTURES, "python-pytest");

  it("produces a valid RepositoryProfile", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const result = RepositoryProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("detects Python language with evidence", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const python = profile.languages.find((l) => l.id === "python");
    expect(python).toBeDefined();
    expect(python!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(python!.evidence.some((e) => e.source === "pyproject.toml")).toBe(
      true,
    );
  });

  it("detects Python version requirement", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const python = profile.languages.find((l) => l.id === "python");
    expect(python?.version).toBe(">=3.10");
  });

  it("detects pytest test framework with evidence", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const pytest = profile.testFrameworks.find((t) => t.id === "pytest");
    expect(pytest).toBeDefined();
    expect(pytest!.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("detects FastAPI framework", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(profile.frameworks.find((f) => f.id === "fastapi")).toBeDefined();
  });

  it("discovers test command", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const testCmd = profile.commands.find((c) => c.category === "TEST");
    expect(testCmd).toBeDefined();
    expect(testCmd!.command).toContain("pytest");
  });

  it("populates python.pytest capability", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(
      profile.capabilities.find((c) => c.id === "python.pytest"),
    ).toBeDefined();
  });
});

describe("Repository analysis — dotnet-xunit fixture", () => {
  const fixturePath = resolve(FIXTURES, "dotnet-xunit");

  it("produces a valid RepositoryProfile", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const result = RepositoryProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("detects C# language with evidence", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const csharp = profile.languages.find((l) => l.id === "csharp");
    expect(csharp).toBeDefined();
    expect(csharp!.evidence.length).toBeGreaterThan(0);
  });

  it("detects NuGet package manager", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(profile.packageManagers.find((p) => p.id === "nuget")).toBeDefined();
  });

  it("detects xUnit test framework with evidence", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const xunit = profile.testFrameworks.find((t) => t.id === "xunit");
    expect(xunit).toBeDefined();
    expect(xunit!.evidence.length).toBeGreaterThan(0);
  });

  it("detects ASP.NET Core framework", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(
      profile.frameworks.find((f) => f.id === "aspnet-core"),
    ).toBeDefined();
  });

  it("detects MSBuild and dotnet CLI build systems", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(
      profile.buildSystems.find((b) => b.id === "dotnet-cli"),
    ).toBeDefined();
    expect(profile.buildSystems.find((b) => b.id === "msbuild")).toBeDefined();
  });

  it("discovers build and test commands", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const buildCmd = profile.commands.find(
      (c) => c.category === "BUILD" && c.command.includes("dotnet"),
    );
    const testCmd = profile.commands.find(
      (c) => c.category === "TEST" && c.command.includes("dotnet"),
    );
    expect(buildCmd).toBeDefined();
    expect(testCmd).toBeDefined();
  });

  it("populates dotnet capabilities", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(
      profile.capabilities.find((c) => c.id === "dotnet.build"),
    ).toBeDefined();
    expect(
      profile.capabilities.find((c) => c.id === "dotnet.xunit"),
    ).toBeDefined();
  });
});

describe("Repository analysis — custom-build fixture", () => {
  const fixturePath = resolve(FIXTURES, "custom-build");

  it("produces a valid RepositoryProfile", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const result = RepositoryProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("detects Make build system", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(profile.buildSystems.find((b) => b.id === "make")).toBeDefined();
  });

  it("detects Docker", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(profile.buildSystems.find((b) => b.id === "docker")).toBeDefined();
  });

  it("detects GitHub Actions CI", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(
      profile.ciSystems.find((c) => c.id === "github-actions"),
    ).toBeDefined();
  });

  it("discovers CI commands with provenance", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const ciCommands = profile.commands.filter((c) =>
      c.source.includes(".github/workflows"),
    );
    expect(ciCommands.length).toBeGreaterThan(0);
  });

  it("discovers README documentation", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(
      profile.documentation.find((d) => d.path === "README.md"),
    ).toBeDefined();
  });

  it("still reports generic capabilities", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(
      profile.capabilities.find((c) => c.id === "generic.shell"),
    ).toBeDefined();
    expect(
      profile.capabilities.find((c) => c.id === "generic.make"),
    ).toBeDefined();
    expect(profile.capabilities.find((c) => c.id === "docker")).toBeDefined();
  });

  it("has positive confidence despite unknown ecosystem", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(profile.confidence).toBeGreaterThan(0);
  });
});

describe("Repository analysis — playwright-app fixture", () => {
  const fixturePath = resolve(FIXTURES, "playwright-app");

  it("detects Playwright test framework", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const pw = profile.testFrameworks.find((t) => t.id === "playwright");
    expect(pw).toBeDefined();
    expect(pw!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(pw!.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("detects pnpm package manager", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(profile.packageManagers.find((p) => p.id === "pnpm")).toBeDefined();
  });

  it("discovers browser test command", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    const browserCmd = profile.commands.find((c) => c.category === "BROWSER");
    expect(browserCmd).toBeDefined();
  });

  it("populates browser.playwright capability", async () => {
    const profile = await analyzeRepository({ targetPath: fixturePath });
    expect(
      profile.capabilities.find((c) => c.id === "browser.playwright"),
    ).toBeDefined();
  });
});

describe("Evidence provenance", () => {
  it("every language detection has evidence", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    for (const lang of profile.languages) {
      expect(lang.evidence.length).toBeGreaterThan(0);
      for (const ev of lang.evidence) {
        expect(ev.source).toBeTruthy();
        expect(ev.reason).toBeTruthy();
      }
    }
  });

  it("every package manager detection has evidence", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    for (const pm of profile.packageManagers) {
      expect(pm.evidence.length).toBeGreaterThan(0);
    }
  });

  it("every test framework detection has evidence", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    for (const tf of profile.testFrameworks) {
      expect(tf.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("Confidence behavior", () => {
  it("strong evidence produces higher confidence than weak", async () => {
    const nodeProfile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    const vitest = nodeProfile.testFrameworks.find((t) => t.id === "vitest");
    // vitest has both dep + config file = strong evidence
    expect(vitest!.confidence).toBeGreaterThanOrEqual(0.95);
    // 2 evidence sources should be stronger
    expect(vitest!.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("TypeScript with tsconfig + dep has higher confidence than single source", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    const ts = profile.languages.find((l) => l.id === "typescript");
    expect(ts!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(ts!.evidence.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Repository root and git detection", () => {
  it("resolves root from fixture path", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    expect(profile.root).toBe(resolve(FIXTURES, "node-vitest"));
  });

  it("includes git info", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    expect(profile.git).toBeDefined();
    expect(typeof profile.git.detected).toBe("boolean");
  });
});

describe("Application detection", () => {
  it("assigns a default application when none detected explicitly", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    expect(profile.applications.length).toBeGreaterThanOrEqual(1);
    expect(profile.applications[0].id).toBe("root");
  });
});

describe("Schema validation of analysis results", () => {
  it("node-vitest result passes RepositoryProfileSchema", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "node-vitest"),
    });
    const result = RepositoryProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("python-pytest result passes RepositoryProfileSchema", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "python-pytest"),
    });
    const result = RepositoryProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("dotnet-xunit result passes RepositoryProfileSchema", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "dotnet-xunit"),
    });
    const result = RepositoryProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("custom-build result passes RepositoryProfileSchema", async () => {
    const profile = await analyzeRepository({
      targetPath: resolve(FIXTURES, "custom-build"),
    });
    const result = RepositoryProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });
});
