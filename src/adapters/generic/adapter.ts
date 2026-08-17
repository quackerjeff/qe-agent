import type { CommandCategory } from "../../types/index.js";
import type {
  EcosystemAdapter,
  FileInventory,
  AdapterResult,
} from "../../repository/types.js";
import { emptyAdapterResult } from "../../repository/types.js";
import { hasFile, filesMatching, readTextFile } from "../util.js";

export class GenericAdapter implements EcosystemAdapter {
  readonly id = "generic";
  readonly name = "Generic";

  async detect(): Promise<boolean> {
    return true;
  }

  async analyze(inventory: FileInventory): Promise<AdapterResult> {
    const result = emptyAdapterResult();

    this.detectLanguagesByExtension(inventory, result);
    await this.detectMakefile(inventory, result);
    this.detectDocker(inventory, result);
    this.detectGenericBuildTools(inventory, result);

    return result;
  }

  private detectLanguagesByExtension(
    inventory: FileInventory,
    result: AdapterResult,
  ): void {
    const extensionMap: Record<string, { id: string; name: string }> = {
      ".go": { id: "go", name: "Go" },
      ".rs": { id: "rust", name: "Rust" },
      ".rb": { id: "ruby", name: "Ruby" },
      ".php": { id: "php", name: "PHP" },
      ".java": { id: "java", name: "Java" },
    };

    for (const [ext, lang] of Object.entries(extensionMap)) {
      const matches = filesMatching(inventory, (f) => f.endsWith(ext));
      if (matches.length > 0) {
        result.languages.push({
          id: lang.id,
          name: lang.name,
          category: "language",
          confidence: 0.6,
          evidence: [
            {
              source: matches[0],
              reason: `Source file with ${ext} extension`,
            },
          ],
        });
      }
    }

    // Stronger evidence from manifest files
    if (hasFile(inventory, "go.mod")) {
      this.upgradeOrAddLanguage(result, "go", "Go", 0.95, {
        source: "go.mod",
        reason: "Go module file",
      });
      result.packageManagers.push({
        id: "go-modules",
        name: "Go Modules",
        category: "packageManager",
        confidence: 0.95,
        evidence: [{ source: "go.mod", reason: "Go module file" }],
      });
      result.buildSystems.push({
        id: "go-tooling",
        name: "Go tooling",
        category: "buildSystem",
        confidence: 0.95,
        evidence: [{ source: "go.mod", reason: "Go module file" }],
      });
      result.testFrameworks.push({
        id: "go-test",
        name: "Go testing",
        category: "testFramework",
        confidence: 0.8,
        evidence: [
          { source: "go.mod", reason: "Go projects use built-in testing" },
        ],
      });
      result.commands.push({
        id: "go:test",
        name: "test",
        category: "TEST",
        command: "go test ./...",
        executable: "go",
        args: ["test", "./..."],
        source: "go.mod",
        confidence: 0.85,
        executionSupport: "STRUCTURED",
      });
      result.commands.push({
        id: "go:build",
        name: "build",
        category: "BUILD",
        command: "go build ./...",
        executable: "go",
        args: ["build", "./..."],
        source: "go.mod",
        confidence: 0.85,
        executionSupport: "STRUCTURED",
      });
    }

    if (hasFile(inventory, "Cargo.toml")) {
      this.upgradeOrAddLanguage(result, "rust", "Rust", 0.95, {
        source: "Cargo.toml",
        reason: "Cargo manifest file",
      });
      result.packageManagers.push({
        id: "cargo",
        name: "Cargo",
        category: "packageManager",
        confidence: 0.95,
        evidence: [{ source: "Cargo.toml", reason: "Cargo manifest file" }],
      });
      result.buildSystems.push({
        id: "cargo",
        name: "Cargo",
        category: "buildSystem",
        confidence: 0.95,
        evidence: [{ source: "Cargo.toml", reason: "Cargo manifest file" }],
      });
      result.testFrameworks.push({
        id: "cargo-test",
        name: "Cargo test",
        category: "testFramework",
        confidence: 0.8,
        evidence: [
          {
            source: "Cargo.toml",
            reason: "Rust projects use built-in test framework",
          },
        ],
      });
      result.commands.push({
        id: "cargo:test",
        name: "test",
        category: "TEST",
        command: "cargo test",
        executable: "cargo",
        args: ["test"],
        source: "Cargo.toml",
        confidence: 0.85,
        executionSupport: "STRUCTURED",
      });
      result.commands.push({
        id: "cargo:build",
        name: "build",
        category: "BUILD",
        command: "cargo build",
        executable: "cargo",
        args: ["build"],
        source: "Cargo.toml",
        confidence: 0.85,
        executionSupport: "STRUCTURED",
      });
    }

    if (hasFile(inventory, "Gemfile")) {
      this.upgradeOrAddLanguage(result, "ruby", "Ruby", 0.95, {
        source: "Gemfile",
        reason: "Bundler Gemfile",
      });
      result.packageManagers.push({
        id: "bundler",
        name: "Bundler",
        category: "packageManager",
        confidence: 0.95,
        evidence: [{ source: "Gemfile", reason: "Bundler Gemfile" }],
      });
    }

    if (hasFile(inventory, "composer.json")) {
      this.upgradeOrAddLanguage(result, "php", "PHP", 0.95, {
        source: "composer.json",
        reason: "Composer manifest",
      });
      result.packageManagers.push({
        id: "composer",
        name: "Composer",
        category: "packageManager",
        confidence: 0.95,
        evidence: [
          { source: "composer.json", reason: "Composer manifest file" },
        ],
      });
    }

    // Java build tools
    if (hasFile(inventory, "pom.xml")) {
      this.upgradeOrAddLanguage(result, "java", "Java", 0.95, {
        source: "pom.xml",
        reason: "Maven POM file",
      });
      result.packageManagers.push({
        id: "maven",
        name: "Maven",
        category: "packageManager",
        confidence: 0.95,
        evidence: [{ source: "pom.xml", reason: "Maven POM file" }],
      });
      result.buildSystems.push({
        id: "maven",
        name: "Maven",
        category: "buildSystem",
        confidence: 0.95,
        evidence: [{ source: "pom.xml", reason: "Maven POM file" }],
      });
      result.testFrameworks.push({
        id: "junit",
        name: "JUnit",
        category: "testFramework",
        confidence: 0.7,
        evidence: [
          {
            source: "pom.xml",
            reason: "Maven projects commonly use JUnit",
          },
        ],
      });
      result.commands.push({
        id: "maven:test",
        name: "test",
        category: "TEST",
        command: "mvn test",
        executable: "mvn",
        args: ["test"],
        source: "pom.xml",
        confidence: 0.85,
        executionSupport: "STRUCTURED",
      });
    }

    const gradleFiles = filesMatching(inventory, (f) =>
      /^build\.gradle(\.kts)?$/.test(f),
    );
    if (gradleFiles.length > 0) {
      this.upgradeOrAddLanguage(result, "java", "Java", 0.9, {
        source: gradleFiles[0],
        reason: "Gradle build file",
      });
      result.buildSystems.push({
        id: "gradle",
        name: "Gradle",
        category: "buildSystem",
        confidence: 0.95,
        evidence: [
          { source: gradleFiles[0], reason: "Gradle build file detected" },
        ],
      });
      result.commands.push({
        id: "gradle:test",
        name: "test",
        category: "TEST",
        command: "gradle test",
        executable: "gradle",
        args: ["test"],
        source: gradleFiles[0],
        confidence: 0.8,
        executionSupport: "STRUCTURED",
      });
    }
  }

  private async detectMakefile(
    inventory: FileInventory,
    result: AdapterResult,
  ): Promise<void> {
    if (!hasFile(inventory, "Makefile")) return;

    result.buildSystems.push({
      id: "make",
      name: "Make",
      category: "buildSystem",
      confidence: 0.9,
      evidence: [{ source: "Makefile", reason: "Makefile detected" }],
    });
    result.capabilities.push({
      id: "generic.make",
      type: "build_tool",
      provider: this.id,
      available: true,
      confidence: 0.9,
    });

    const content = await readTextFile(inventory.root, "Makefile");
    if (!content) return;

    const targetCategoryMap: Record<string, CommandCategory> = {
      build: "BUILD",
      test: "TEST",
      lint: "LINT",
      typecheck: "TYPECHECK",
      install: "INSTALL",
      start: "START",
      dev: "START",
      serve: "START",
      clean: "OTHER",
    };

    const targetPattern = /^([a-zA-Z_][a-zA-Z0-9_-]*):/gm;
    let match;
    while ((match = targetPattern.exec(content)) !== null) {
      const target = match[1];
      const category =
        targetCategoryMap[target] ?? ("OTHER" as CommandCategory);
      result.commands.push({
        id: `make:${target}`,
        name: target,
        category,
        command: `make ${target}`,
        executable: "make",
        args: [target],
        source: "Makefile",
        confidence: 0.85,
        executionSupport: "STRUCTURED",
      });
    }
  }

  private detectDocker(inventory: FileInventory, result: AdapterResult): void {
    const dockerfiles = filesMatching(
      inventory,
      (f) =>
        f === "Dockerfile" ||
        f === "docker-compose.yml" ||
        f === "docker-compose.yaml" ||
        f === "compose.yml" ||
        f === "compose.yaml",
    );
    if (dockerfiles.length > 0) {
      result.buildSystems.push({
        id: "docker",
        name: "Docker",
        category: "buildSystem",
        confidence: 0.9,
        evidence: dockerfiles.map((f) => ({
          source: f,
          reason: "Docker configuration detected",
        })),
      });
      result.capabilities.push({
        id: "docker",
        type: "container_runtime",
        provider: this.id,
        available: true,
        confidence: 0.85,
      });
    }
  }

  private detectGenericBuildTools(
    inventory: FileInventory,
    result: AdapterResult,
  ): void {
    result.capabilities.push({
      id: "generic.shell",
      type: "command_runner",
      provider: this.id,
      available: true,
      confidence: 1.0,
    });
  }

  private upgradeOrAddLanguage(
    result: AdapterResult,
    id: string,
    name: string,
    confidence: number,
    evidence: { source: string; reason: string },
  ): void {
    const existing = result.languages.find((l) => l.id === id);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.evidence.push(evidence);
    } else {
      result.languages.push({
        id,
        name,
        category: "language",
        confidence,
        evidence: [evidence],
      });
    }
  }
}
