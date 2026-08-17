import type {
  EcosystemAdapter,
  FileInventory,
  AdapterResult,
} from "../../repository/types.js";
import { emptyAdapterResult } from "../../repository/types.js";
import { filesMatching, readTextFile } from "../util.js";

export class DotNetAdapter implements EcosystemAdapter {
  readonly id = "dotnet";
  readonly name = ".NET";

  async detect(inventory: FileInventory): Promise<boolean> {
    return (
      filesMatching(inventory, (f) => /\.(sln|csproj|fsproj)$/.test(f)).length >
      0
    );
  }

  async analyze(inventory: FileInventory): Promise<AdapterResult> {
    const result = emptyAdapterResult();
    const csprojFiles = filesMatching(inventory, (f) => f.endsWith(".csproj"));
    const fsprojFiles = filesMatching(inventory, (f) => f.endsWith(".fsproj"));
    const projFiles = [...csprojFiles, ...fsprojFiles];

    const projContents: string[] = [];
    for (const pf of projFiles) {
      const content = await readTextFile(inventory.root, pf);
      if (content) projContents.push(content);
    }

    this.detectLanguages(inventory, result, csprojFiles, fsprojFiles);
    this.detectPackageManagers(result, projFiles);
    this.detectBuildSystems(inventory, result, projFiles);
    this.detectFrameworks(result, projContents, projFiles);
    this.detectTestFrameworks(result, projContents, projFiles);
    this.discoverCommands(result);
    this.populateCapabilities(result);

    return result;
  }

  private detectLanguages(
    inventory: FileInventory,
    result: AdapterResult,
    csprojFiles: string[],
    fsprojFiles: string[],
  ): void {
    if (csprojFiles.length > 0) {
      result.languages.push({
        id: "csharp",
        name: "C#",
        category: "language",
        confidence: 0.95,
        evidence: csprojFiles.map((f) => ({
          source: f,
          reason: "C# project file",
        })),
      });
    }
    if (fsprojFiles.length > 0) {
      result.languages.push({
        id: "fsharp",
        name: "F#",
        category: "language",
        confidence: 0.95,
        evidence: fsprojFiles.map((f) => ({
          source: f,
          reason: "F# project file",
        })),
      });
    }
  }

  private detectPackageManagers(
    result: AdapterResult,
    projFiles: string[],
  ): void {
    if (projFiles.length > 0) {
      result.packageManagers.push({
        id: "nuget",
        name: "NuGet",
        category: "packageManager",
        confidence: 0.95,
        evidence: [
          {
            source: projFiles[0],
            reason: ".NET project file implies NuGet package management",
          },
        ],
      });
    }
  }

  private detectBuildSystems(
    inventory: FileInventory,
    result: AdapterResult,
    projFiles: string[],
  ): void {
    if (projFiles.length > 0) {
      result.buildSystems.push({
        id: "dotnet-cli",
        name: "dotnet CLI",
        category: "buildSystem",
        confidence: 0.95,
        evidence: [
          {
            source: projFiles[0],
            reason: ".NET project file detected",
          },
        ],
      });
    }

    const slnFiles = filesMatching(inventory, (f) => f.endsWith(".sln"));
    if (slnFiles.length > 0) {
      result.buildSystems.push({
        id: "msbuild",
        name: "MSBuild",
        category: "buildSystem",
        confidence: 0.9,
        evidence: [
          {
            source: slnFiles[0],
            reason: "Visual Studio solution file detected",
          },
        ],
      });
    }
  }

  private detectFrameworks(
    result: AdapterResult,
    projContents: string[],
    projFiles: string[],
  ): void {
    for (let i = 0; i < projContents.length; i++) {
      const content = projContents[i];
      const file = projFiles[i];
      if (
        content.includes("Microsoft.AspNetCore") ||
        content.includes('Sdk="Microsoft.NET.Sdk.Web"')
      ) {
        result.frameworks.push({
          id: "aspnet-core",
          name: "ASP.NET Core",
          category: "framework",
          confidence: 0.95,
          evidence: [
            {
              source: file,
              reason: "ASP.NET Core SDK or package reference detected",
            },
          ],
        });
        break;
      }
    }
  }

  private detectTestFrameworks(
    result: AdapterResult,
    projContents: string[],
    projFiles: string[],
  ): void {
    const frameworks: {
      id: string;
      name: string;
      pattern: string;
    }[] = [
      { id: "xunit", name: "xUnit", pattern: "xunit" },
      { id: "nunit", name: "NUnit", pattern: "NUnit" },
      { id: "mstest", name: "MSTest", pattern: "MSTest" },
    ];

    for (const fw of frameworks) {
      const evidence: { source: string; reason: string }[] = [];
      for (let i = 0; i < projContents.length; i++) {
        if (projContents[i].includes(fw.pattern)) {
          evidence.push({
            source: projFiles[i],
            reason: `${fw.name} package reference detected`,
          });
        }
      }
      if (evidence.length > 0) {
        result.testFrameworks.push({
          id: fw.id,
          name: fw.name,
          category: "testFramework",
          confidence: 0.95,
          evidence,
        });
      }
    }
  }

  private discoverCommands(result: AdapterResult): void {
    result.commands.push({
      id: "dotnet:build",
      name: "build",
      category: "BUILD",
      command: "dotnet build",
      executable: "dotnet",
      args: ["build"],
      source: "detected build system",
      confidence: 0.9,
      executionSupport: "STRUCTURED",
    });

    if (result.testFrameworks.length > 0) {
      result.commands.push({
        id: "dotnet:test",
        name: "test",
        category: "TEST",
        command: "dotnet test",
        executable: "dotnet",
        args: ["test"],
        source: "detected test framework",
        confidence: 0.9,
        executionSupport: "STRUCTURED",
      });
    }
  }

  private populateCapabilities(result: AdapterResult): void {
    result.capabilities.push({
      id: "dotnet.build",
      type: "build_tool",
      provider: this.id,
      available: true,
      confidence: 0.95,
    });

    for (const tf of result.testFrameworks) {
      result.capabilities.push({
        id: `dotnet.${tf.id}`,
        type: "test_runner",
        provider: this.id,
        available: true,
        confidence: tf.confidence,
      });
    }
  }
}
