import type {
  EcosystemAdapter,
  FileInventory,
  AdapterResult,
} from "../../repository/types.js";
import { emptyAdapterResult } from "../../repository/types.js";
import { hasFile, hasAnyFile, readJsonFile } from "../util.js";

export class BrowserAdapter implements EcosystemAdapter {
  readonly id = "browser";
  readonly name = "Browser Testing";

  async detect(inventory: FileInventory): Promise<boolean> {
    if (
      hasAnyFile(inventory, [
        "playwright.config.ts",
        "playwright.config.js",
        "playwright.config.mts",
      ])
    ) {
      return true;
    }

    const pkg = (await readJsonFile(inventory.root, "package.json")) as
      | {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        }
      | undefined;
    if (!pkg) return false;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "@playwright/test" in deps || "playwright" in deps;
  }

  async analyze(inventory: FileInventory): Promise<AdapterResult> {
    const result = emptyAdapterResult();

    const configFiles = [
      "playwright.config.ts",
      "playwright.config.js",
      "playwright.config.mts",
    ];
    const configFile = configFiles.find((f) => hasFile(inventory, f));

    const pkg = (await readJsonFile(inventory.root, "package.json")) as
      | {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        }
      | undefined;
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    const hasDep = "@playwright/test" in deps || "playwright" in deps;

    const evidence = [];
    if (configFile) {
      evidence.push({
        source: configFile,
        reason: "Playwright configuration file",
      });
    }
    if (hasDep) {
      evidence.push({
        source: "package.json",
        reason: "Playwright listed as dependency",
      });
    }

    if (evidence.length > 0) {
      result.testFrameworks.push({
        id: "playwright",
        name: "Playwright",
        category: "testFramework",
        version: deps["@playwright/test"] ?? deps["playwright"],
        confidence: evidence.length >= 2 ? 0.99 : 0.9,
        evidence,
      });

      result.capabilities.push({
        id: "browser.playwright",
        type: "browser_testing",
        provider: this.id,
        available: true,
        confidence: evidence.length >= 2 ? 0.99 : 0.9,
      });

      // Discover e2e commands from package.json scripts
      if (pkg) {
        const scripts = (pkg as { scripts?: Record<string, string> }).scripts;
        if (scripts) {
          for (const [name, script] of Object.entries(scripts)) {
            if (
              name.includes("e2e") ||
              name.includes("playwright") ||
              script.includes("playwright")
            ) {
              result.commands.push({
                id: `npm-script:${name}`,
                name,
                category: "BROWSER",
                command: `npm run ${name}`,
                executable: "npm",
                args: ["run", name],
                source: "package.json",
                confidence: 0.9,
                executionSupport: "STRUCTURED",
              });
            }
          }
        }
      }
    }

    return result;
  }
}
