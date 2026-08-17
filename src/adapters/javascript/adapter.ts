import type { CommandCategory } from "../../types/index.js";
import type {
  EcosystemAdapter,
  FileInventory,
  AdapterResult,
} from "../../repository/types.js";
import { emptyAdapterResult } from "../../repository/types.js";
import { hasFile, hasAnyFile, readJsonFile } from "../util.js";

const JS_MANIFEST_FILES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export class JavaScriptAdapter implements EcosystemAdapter {
  readonly id = "javascript";
  readonly name = "JavaScript / TypeScript";

  async detect(inventory: FileInventory): Promise<boolean> {
    return hasAnyFile(inventory, JS_MANIFEST_FILES);
  }

  async analyze(inventory: FileInventory): Promise<AdapterResult> {
    const result = emptyAdapterResult();
    const pkg = (await readJsonFile(inventory.root, "package.json")) as
      PackageJson | undefined;
    const allDeps = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
    };

    this.detectLanguages(inventory, result, pkg);
    this.detectPackageManagers(inventory, result);
    this.detectFrameworks(result, allDeps);
    this.detectTestFrameworks(inventory, result, allDeps);
    this.detectBuildSystems(inventory, result, pkg);
    this.discoverCommands(result, pkg);
    this.populateCapabilities(result);

    return result;
  }

  private detectLanguages(
    inventory: FileInventory,
    result: AdapterResult,
    pkg: PackageJson | undefined,
  ): void {
    const hasTsConfig = hasFile(inventory, "tsconfig.json");
    const hasTsDep =
      pkg?.devDependencies?.["typescript"] || pkg?.dependencies?.["typescript"];

    if (hasTsConfig || hasTsDep) {
      const evidence = [];
      if (hasTsConfig)
        evidence.push({
          source: "tsconfig.json",
          reason: "TypeScript configuration file",
        });
      if (hasTsDep)
        evidence.push({
          source: "package.json",
          reason: "typescript listed as dependency",
        });
      result.languages.push({
        id: "typescript",
        name: "TypeScript",
        category: "language",
        version: hasTsDep
          ? String(
              pkg?.devDependencies?.["typescript"] ??
                pkg?.dependencies?.["typescript"],
            )
          : undefined,
        confidence: hasTsConfig && hasTsDep ? 0.99 : 0.95,
        evidence,
      });
    }

    if (hasFile(inventory, "package.json")) {
      result.languages.push({
        id: "javascript",
        name: "JavaScript",
        category: "language",
        confidence: 0.9,
        evidence: [
          { source: "package.json", reason: "Node.js package manifest" },
        ],
      });
    }
  }

  private detectPackageManagers(
    inventory: FileInventory,
    result: AdapterResult,
  ): void {
    const managers: {
      id: string;
      name: string;
      files: string[];
      reason: string;
    }[] = [
      {
        id: "npm",
        name: "npm",
        files: ["package-lock.json"],
        reason: "npm lockfile detected",
      },
      {
        id: "pnpm",
        name: "pnpm",
        files: ["pnpm-lock.yaml"],
        reason: "pnpm lockfile detected",
      },
      {
        id: "yarn",
        name: "Yarn",
        files: ["yarn.lock"],
        reason: "Yarn lockfile detected",
      },
      {
        id: "bun",
        name: "Bun",
        files: ["bun.lock", "bun.lockb"],
        reason: "Bun lockfile detected",
      },
    ];

    for (const mgr of managers) {
      const found = mgr.files.find((f) => hasFile(inventory, f));
      if (found) {
        result.packageManagers.push({
          id: mgr.id,
          name: mgr.name,
          category: "packageManager",
          confidence: 0.95,
          evidence: [{ source: found, reason: mgr.reason }],
        });
      }
    }

    if (result.packageManagers.length > 1) {
      for (const pm of result.packageManagers) {
        pm.confidence = 0.5;
        pm.evidence.push({
          source: "multiple lockfiles",
          reason:
            "Multiple package manager lockfiles detected; ambiguous which is authoritative",
        });
      }
    }

    if (
      result.packageManagers.length === 0 &&
      hasFile(inventory, "package.json")
    ) {
      result.packageManagers.push({
        id: "npm",
        name: "npm",
        category: "packageManager",
        confidence: 0.6,
        evidence: [
          {
            source: "package.json",
            reason: "package.json present without lockfile; npm assumed",
          },
        ],
      });
    }
  }

  private detectFrameworks(
    result: AdapterResult,
    deps: Record<string, string>,
  ): void {
    const frameworks: {
      id: string;
      name: string;
      dep: string;
      reason: string;
    }[] = [
      {
        id: "react",
        name: "React",
        dep: "react",
        reason: "react listed as dependency",
      },
      {
        id: "nextjs",
        name: "Next.js",
        dep: "next",
        reason: "next listed as dependency",
      },
      {
        id: "express",
        name: "Express",
        dep: "express",
        reason: "express listed as dependency",
      },
    ];

    for (const fw of frameworks) {
      if (deps[fw.dep]) {
        result.frameworks.push({
          id: fw.id,
          name: fw.name,
          category: "framework",
          version: deps[fw.dep],
          confidence: 0.95,
          evidence: [{ source: "package.json", reason: fw.reason }],
        });
      }
    }
  }

  private detectTestFrameworks(
    inventory: FileInventory,
    result: AdapterResult,
    deps: Record<string, string>,
  ): void {
    const frameworks: {
      id: string;
      name: string;
      dep: string;
      configFiles: string[];
    }[] = [
      {
        id: "vitest",
        name: "Vitest",
        dep: "vitest",
        configFiles: [
          "vitest.config.ts",
          "vitest.config.js",
          "vitest.config.mts",
        ],
      },
      {
        id: "jest",
        name: "Jest",
        dep: "jest",
        configFiles: ["jest.config.ts", "jest.config.js", "jest.config.mjs"],
      },
      {
        id: "mocha",
        name: "Mocha",
        dep: "mocha",
        configFiles: [".mocharc.yml", ".mocharc.yaml", ".mocharc.json"],
      },
    ];

    for (const fw of frameworks) {
      const evidence = [];
      if (deps[fw.dep]) {
        evidence.push({
          source: "package.json",
          reason: `${fw.dep} listed as dependency`,
        });
      }
      const configFile = fw.configFiles.find((f) => hasFile(inventory, f));
      if (configFile) {
        evidence.push({
          source: configFile,
          reason: `${fw.name} configuration file`,
        });
      }
      if (evidence.length > 0) {
        result.testFrameworks.push({
          id: fw.id,
          name: fw.name,
          category: "testFramework",
          version: deps[fw.dep],
          confidence: evidence.length >= 2 ? 0.99 : 0.9,
          evidence,
        });
      }
    }
  }

  private detectBuildSystems(
    inventory: FileInventory,
    result: AdapterResult,
    pkg: PackageJson | undefined,
  ): void {
    if (pkg?.scripts?.["build"]) {
      result.buildSystems.push({
        id: "npm-scripts",
        name: "npm scripts",
        category: "buildSystem",
        confidence: 0.9,
        evidence: [
          {
            source: "package.json",
            reason: "build script defined in package.json",
          },
        ],
      });
    }
  }

  private discoverCommands(
    result: AdapterResult,
    pkg: PackageJson | undefined,
  ): void {
    if (!pkg?.scripts) return;

    const categoryMap: Record<string, string> = {
      install: "INSTALL",
      ci: "INSTALL",
      build: "BUILD",
      test: "TEST",
      "test:unit": "TEST",
      "test:integration": "TEST",
      "test:e2e": "BROWSER",
      lint: "LINT",
      "lint:fix": "LINT",
      typecheck: "TYPECHECK",
      "type-check": "TYPECHECK",
      start: "START",
      dev: "START",
      serve: "START",
    };

    const pmPrefix = this.getPmPrefix(result);
    const pmParts = this.getPmParts(result);

    for (const [name, script] of Object.entries(pkg.scripts)) {
      const category = categoryMap[name] ?? this.inferCategory(name, script);
      result.commands.push({
        id: `npm-script:${name}`,
        name,
        category: category as CommandCategory,
        command: `${pmPrefix} ${name}`,
        executable: pmParts.executable,
        args: [...pmParts.args, name],
        source: "package.json",
        confidence: 0.9,
        executionSupport: "STRUCTURED",
      });
    }
  }

  private getPmPrefix(result: AdapterResult): string {
    if (result.packageManagers.length !== 1) return "npm run";
    const pm = result.packageManagers[0];
    switch (pm.id) {
      case "pnpm":
        return "pnpm";
      case "yarn":
        return "yarn";
      case "bun":
        return "bun run";
      default:
        return "npm run";
    }
  }

  private getPmParts(result: AdapterResult): {
    executable: string;
    args: string[];
  } {
    if (result.packageManagers.length !== 1)
      return { executable: "npm", args: ["run"] };
    const pm = result.packageManagers[0];
    switch (pm.id) {
      case "pnpm":
        return { executable: "pnpm", args: [] };
      case "yarn":
        return { executable: "yarn", args: [] };
      case "bun":
        return { executable: "bun", args: ["run"] };
      default:
        return { executable: "npm", args: ["run"] };
    }
  }

  private inferCategory(name: string, script: string): CommandCategory {
    if (name.includes("test") || name.includes("spec")) return "TEST";
    if (name.includes("lint") || name.includes("eslint")) return "LINT";
    if (
      name.includes("typecheck") ||
      name.includes("tsc") ||
      script.includes("tsc")
    )
      return "TYPECHECK";
    if (name.includes("build") || name.includes("compile")) return "BUILD";
    if (
      name.includes("start") ||
      name.includes("dev") ||
      name.includes("serve")
    )
      return "START";
    if (
      name.includes("e2e") ||
      name.includes("playwright") ||
      name.includes("cypress")
    )
      return "BROWSER";
    return "OTHER" as CommandCategory;
  }

  private populateCapabilities(result: AdapterResult): void {
    for (const pm of result.packageManagers) {
      result.capabilities.push({
        id: `node.${pm.id}`,
        type: "package_manager",
        provider: this.id,
        available: true,
        confidence: pm.confidence,
      });
    }
    for (const tf of result.testFrameworks) {
      result.capabilities.push({
        id: `node.${tf.id}`,
        type: "test_runner",
        provider: this.id,
        available: true,
        confidence: tf.confidence,
      });
    }
  }
}
