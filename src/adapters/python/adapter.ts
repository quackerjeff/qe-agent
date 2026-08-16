import type {
  EcosystemAdapter,
  FileInventory,
  AdapterResult,
} from "../../repository/types.js";
import { emptyAdapterResult } from "../../repository/types.js";
import { hasFile, hasAnyFile, readTextFile } from "../util.js";

const PYTHON_FILES = [
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "setup.py",
  "setup.cfg",
];

export class PythonAdapter implements EcosystemAdapter {
  readonly id = "python";
  readonly name = "Python";

  async detect(inventory: FileInventory): Promise<boolean> {
    return hasAnyFile(inventory, PYTHON_FILES);
  }

  async analyze(inventory: FileInventory): Promise<AdapterResult> {
    const result = emptyAdapterResult();
    const pyproject = await readTextFile(inventory.root, "pyproject.toml");

    this.detectLanguage(inventory, result, pyproject);
    this.detectPackageManagers(inventory, result, pyproject);
    this.detectFrameworks(result, pyproject);
    this.detectTestFrameworks(inventory, result, pyproject);
    this.detectBuildSystems(result, pyproject);
    this.discoverCommands(result);
    this.populateCapabilities(result);

    return result;
  }

  private detectLanguage(
    inventory: FileInventory,
    result: AdapterResult,
    pyproject: string | undefined,
  ): void {
    const evidence = [];
    if (pyproject) {
      evidence.push({
        source: "pyproject.toml",
        reason: "Python project metadata",
      });
    }
    if (hasFile(inventory, "requirements.txt")) {
      evidence.push({
        source: "requirements.txt",
        reason: "pip requirements file",
      });
    }
    if (hasFile(inventory, "Pipfile")) {
      evidence.push({
        source: "Pipfile",
        reason: "Pipenv manifest",
      });
    }
    if (hasFile(inventory, "setup.py")) {
      evidence.push({
        source: "setup.py",
        reason: "Python setuptools script",
      });
    }

    let version: string | undefined;
    if (pyproject) {
      const match = pyproject.match(/requires-python\s*=\s*"([^"]+)"/);
      if (match) version = match[1];
    }

    if (evidence.length > 0) {
      result.languages.push({
        id: "python",
        name: "Python",
        category: "language",
        version,
        confidence: evidence.length >= 2 ? 0.98 : 0.95,
        evidence,
      });
    }
  }

  private detectPackageManagers(
    inventory: FileInventory,
    result: AdapterResult,
    pyproject: string | undefined,
  ): void {
    if (hasFile(inventory, "Pipfile")) {
      result.packageManagers.push({
        id: "pipenv",
        name: "Pipenv",
        category: "packageManager",
        confidence: 0.95,
        evidence: [{ source: "Pipfile", reason: "Pipenv manifest detected" }],
      });
    }

    if (
      hasFile(inventory, "poetry.lock") ||
      this.hasTool(pyproject, "poetry")
    ) {
      const evidence = [];
      if (hasFile(inventory, "poetry.lock"))
        evidence.push({
          source: "poetry.lock",
          reason: "Poetry lockfile detected",
        });
      if (this.hasTool(pyproject, "poetry"))
        evidence.push({
          source: "pyproject.toml",
          reason: "Poetry build system configured",
        });
      result.packageManagers.push({
        id: "poetry",
        name: "Poetry",
        category: "packageManager",
        confidence: 0.95,
        evidence,
      });
    }

    if (hasFile(inventory, "uv.lock") || this.hasTool(pyproject, "uv")) {
      const evidence = [];
      if (hasFile(inventory, "uv.lock"))
        evidence.push({
          source: "uv.lock",
          reason: "uv lockfile detected",
        });
      if (this.hasTool(pyproject, "uv"))
        evidence.push({
          source: "pyproject.toml",
          reason: "uv tool configuration detected",
        });
      result.packageManagers.push({
        id: "uv",
        name: "uv",
        category: "packageManager",
        confidence: 0.95,
        evidence,
      });
    }

    if (
      result.packageManagers.length === 0 &&
      hasFile(inventory, "requirements.txt")
    ) {
      result.packageManagers.push({
        id: "pip",
        name: "pip",
        category: "packageManager",
        confidence: 0.7,
        evidence: [
          {
            source: "requirements.txt",
            reason: "pip requirements file without lockfile",
          },
        ],
      });
    }

    if (result.packageManagers.length === 0 && pyproject) {
      result.packageManagers.push({
        id: "python-pm-unknown",
        name: "Python package management",
        category: "packageManager",
        confidence: 0.4,
        evidence: [
          {
            source: "pyproject.toml",
            reason:
              "pyproject.toml present without lockfile or requirements.txt; specific package manager unknown",
          },
        ],
      });
    }
  }

  private detectFrameworks(
    result: AdapterResult,
    pyproject: string | undefined,
  ): void {
    const frameworks: {
      id: string;
      name: string;
      patterns: string[];
    }[] = [
      { id: "django", name: "Django", patterns: ["django"] },
      { id: "flask", name: "Flask", patterns: ["flask"] },
      { id: "fastapi", name: "FastAPI", patterns: ["fastapi"] },
    ];

    if (!pyproject) return;

    for (const fw of frameworks) {
      for (const pattern of fw.patterns) {
        if (this.hasDependency(pyproject, pattern)) {
          result.frameworks.push({
            id: fw.id,
            name: fw.name,
            category: "framework",
            confidence: 0.9,
            evidence: [
              {
                source: "pyproject.toml",
                reason: `${pattern} listed as dependency`,
              },
            ],
          });
          break;
        }
      }
    }
  }

  private detectTestFrameworks(
    inventory: FileInventory,
    result: AdapterResult,
    pyproject: string | undefined,
  ): void {
    const hasPytestDep = pyproject
      ? this.hasDependency(pyproject, "pytest")
      : false;
    const hasPytestIni =
      hasFile(inventory, "pytest.ini") || hasFile(inventory, "conftest.py");
    const hasPytestConfig = pyproject?.includes("[tool.pytest") ?? false;

    if (hasPytestDep || hasPytestIni || hasPytestConfig) {
      const evidence = [];
      if (hasPytestDep)
        evidence.push({
          source: "pyproject.toml",
          reason: "pytest listed as dependency",
        });
      if (hasPytestIni)
        evidence.push({
          source: hasFile(inventory, "pytest.ini")
            ? "pytest.ini"
            : "conftest.py",
          reason: "pytest configuration detected",
        });
      if (hasPytestConfig)
        evidence.push({
          source: "pyproject.toml",
          reason: "pytest tool configuration in pyproject.toml",
        });
      result.testFrameworks.push({
        id: "pytest",
        name: "pytest",
        category: "testFramework",
        confidence: evidence.length >= 2 ? 0.98 : 0.9,
        evidence,
      });
    }
  }

  private detectBuildSystems(
    result: AdapterResult,
    pyproject: string | undefined,
  ): void {
    if (!pyproject) return;

    if (pyproject.includes("[build-system]")) {
      result.buildSystems.push({
        id: "python-build",
        name: "Python build system",
        category: "buildSystem",
        confidence: 0.9,
        evidence: [
          {
            source: "pyproject.toml",
            reason: "build-system section defined",
          },
        ],
      });
    }
  }

  private discoverCommands(result: AdapterResult): void {
    if (result.testFrameworks.some((tf) => tf.id === "pytest")) {
      result.commands.push({
        id: "pytest:test",
        name: "test",
        category: "TEST",
        command: "pytest",
        source: "detected test framework",
        confidence: 0.85,
      });
    }

    if (result.packageManagers.some((pm) => pm.id === "pip")) {
      result.commands.push({
        id: "pip:install",
        name: "install",
        category: "INSTALL",
        command: "pip install -r requirements.txt",
        source: "detected package manager",
        confidence: 0.8,
      });
    }

    if (result.packageManagers.some((pm) => pm.id === "poetry")) {
      result.commands.push({
        id: "poetry:install",
        name: "install",
        category: "INSTALL",
        command: "poetry install",
        source: "detected package manager",
        confidence: 0.9,
      });
    }

    if (result.packageManagers.some((pm) => pm.id === "uv")) {
      result.commands.push({
        id: "uv:install",
        name: "install",
        category: "INSTALL",
        command: "uv sync",
        source: "detected package manager",
        confidence: 0.9,
      });
    }
  }

  private populateCapabilities(result: AdapterResult): void {
    for (const tf of result.testFrameworks) {
      result.capabilities.push({
        id: `python.${tf.id}`,
        type: "test_runner",
        provider: this.id,
        available: true,
        confidence: tf.confidence,
      });
    }
  }

  private hasTool(pyproject: string | undefined, tool: string): boolean {
    if (!pyproject) return false;
    return (
      pyproject.includes(`[tool.${tool}`) || pyproject.includes(`"${tool}"`)
    );
  }

  private hasDependency(pyproject: string, name: string): boolean {
    const pattern = new RegExp(`"${name}[^"]*"`, "s");
    const sections = [
      /\[project\]\s[\s\S]*?dependencies\s*=\s*\[([^\]]*)\]/,
      /\[project\.optional-dependencies\]\s[\s\S]*?=\s*\[([^\]]*)\]/g,
    ];
    for (const re of sections) {
      const matches = pyproject.matchAll(
        re instanceof RegExp && re.global ? re : new RegExp(re.source, "g"),
      );
      for (const m of matches) {
        if (pattern.test(m[1] ?? m[0])) return true;
      }
    }
    return false;
  }
}
