  Milestone 1 Completion Report

  Implemented

  Repository intelligence capable of inspecting unfamiliar source repositories and producing a structured, evidence-backed RepositoryProfile. The qe analyze command inspects a repository and reports detected
  ecosystems, languages, package managers, build systems, test frameworks, applications, CI systems, documentation, discovered commands, available QE capabilities, confidence, and supporting evidence — all
  without executing any project commands.

  Detection Architecture

  Adapter organization:
  - src/adapters/javascript/ — JavaScript/TypeScript ecosystem (npm/pnpm/yarn/bun, React/Next.js/Express, Vitest/Jest/Mocha)
  - src/adapters/python/ — Python ecosystem (pip/poetry/uv/pipenv, Django/Flask/FastAPI, pytest)
  - src/adapters/dotnet/ — .NET ecosystem (NuGet, ASP.NET Core, xUnit/NUnit/MSTest)
  - src/adapters/browser/ — Browser testing (Playwright detection from config + dependencies)
  - src/adapters/generic/ — Fallback for all repos (Go/Rust/Ruby/PHP/Java by manifest files, Makefile, Docker, Gradle/Maven)

  Evidence model: Every DetectedTechnology carries an evidence: [{source, reason}] array tracing back to the specific file that triggered detection. Confidence is numeric (0-1) and rendered as HIGH/MEDIUM/LOW in
  the human report.

  Confidence approach: Multiple corroborating evidence sources increase confidence (e.g., vitest in package.json + vitest.config.ts = 0.99 vs. single source = 0.9). Manifest files produce higher confidence than
  extension-based heuristics (0.95 vs. 0.6).

  Repository inventory strategy: Bounded filesystem walk (max depth 5, max 10,000 files) excluding generated/vendor directories (node_modules, dist, .git, vendor, target, etc.). Special-case includes .github/
  for CI discovery.

  Command discovery strategy: Package.json scripts mapped to categories via name matching. Framework-conventional commands inferred from detected test frameworks/build tools. CI workflow YAML parsed for run
  steps with command categorization. All commands record provenance source.

  Demonstrations

  Fixture 1 — JavaScript/TypeScript (node-vitest): Detected TypeScript (HIGH, tsconfig.json + package.json dep), JavaScript (HIGH), npm (HIGH, package-lock.json), React + Express frameworks, Vitest (HIGH, dep +
  config), 5 discovered commands (build/test/lint/typecheck/start), capabilities: node.npm, node.vitest, generic.shell, git.analysis.

  Fixture 2 — Python (python-pytest): Detected Python >=3.10 (HIGH, pyproject.toml), FastAPI framework, pytest (HIGH, dep + [tool.pytest] config), Python build system, command: pytest, capability: python.pytest.

  Fixture 3 — .NET (dotnet-xunit): Detected C# (HIGH, .csproj files), NuGet, ASP.NET Core (Sdk.Web), xUnit (HIGH, package reference), dotnet CLI + MSBuild build systems, commands: dotnet build, dotnet test,
  capabilities: dotnet.build, dotnet.xunit.

  Fixture 4 — Unknown/Custom (custom-build): Detected Make + Docker build systems, GitHub Actions CI, CI-discovered commands (make build, make test), README documentation, capabilities: generic.make, docker,
  generic.shell. Confidence: LOW (no recognized language ecosystem).

  Tests

  126 tests total (49 new repository analysis tests + 77 existing):

  - Schema validation: All analysis results pass RepositoryProfileSchema.parse()
  - Language detection: TypeScript with evidence from tsconfig.json + dep, Python with version from pyproject.toml, C# from .csproj files
  - Package manager detection: npm (lockfile), pnpm (lockfile), NuGet (implied from .csproj), pip (inferred fallback)
  - Framework detection: React/Express from package.json deps, FastAPI from pyproject.toml, ASP.NET Core from SDK reference
  - Test framework detection: Vitest with multi-source evidence, pytest with dep + config, xUnit from package reference, Playwright from config + dep
  - CI detection: GitHub Actions from workflow files, command extraction from workflow steps
  - Command discovery: Category classification, provenance tracking, all commands have source/id/confidence
  - Evidence provenance: Every language/package-manager/test-framework detection carries evidence array with source + reason
  - Confidence behavior: Multi-source evidence produces higher confidence than single source
  - Unknown repository handling: Custom-build fixture produces valid analysis with build tools and CI despite no recognized ecosystem
  - Root discovery: Resolves target path correctly
  - Application defaults: Default application assigned when none explicitly detected

  Validation

  npm run build       ✓ passed
  npm test            ✓ 126 tests passed (8 test files)
  npm run lint        ✓ passed
  npm run format:check ✓ passed
  npm run typecheck   ✓ passed

  Repository Changes

  New files:
  - src/repository/ — analyzer.ts, root-discovery.ts, file-inventory.ts, instruction-discovery.ts, ci-discovery.ts, report.ts, types.ts, index.ts
  - src/adapters/ — javascript/adapter.ts, python/adapter.ts, dotnet/adapter.ts, generic/adapter.ts, browser/adapter.ts, util.ts, index.ts
  - src/cli/analyze.ts — CLI command implementation
  - tests/repository-analysis.test.ts — 49 detection tests
  - fixtures/node-vitest/ — JS/TS fixture (package.json, tsconfig.json, vitest.config.ts, lockfile, source, tests, README)
  - fixtures/python-pytest/ — Python fixture (pyproject.toml, source, tests, README)
  - fixtures/dotnet-xunit/ — .NET fixture (.sln, .csproj files, README)
  - fixtures/custom-build/ — Unknown fixture (Makefile, Dockerfile, tools/, .github/workflows/, README)
  - fixtures/playwright-app/ — Browser testing fixture (package.json, playwright.config.ts, pnpm-lock.yaml)

  Modified files:
  - src/types/domain.ts — Added TechnologyCategory, CommandCategory enums
  - src/types/schemas.ts — Added DetectionEvidenceSchema, updated DetectedTechnologySchema (id, category, evidence array), added DiscoveredCommandSchema, ApplicationProfileSchema, GitInfoSchema, updated
  RepositoryProfileSchema
  - src/types/index.ts — Added new exports
  - src/cli/main.ts — Wired functional qe analyze command with --repo and --json flags
  - tests/schemas.test.ts — Updated existing tests to use new schema format

  Schema Changes

  - DetectedTechnologySchema: Added id: string, category: TechnologyCategory, changed detectedFrom: string → evidence: [{source, reason}] array. Required by ADR-004 evidence-first model.
  - DiscoveredCommandSchema (new): {id, name, category: CommandCategory, command, source, confidence}. Replaces the anonymous {name, command, source} in RepositoryProfile.commands.
  - ApplicationProfileSchema (new): {id, name, path, type?} for representing detected applications.
  - GitInfoSchema (new): {detected, root?, branch?} for git metadata in RepositoryProfile.
  - RepositoryProfileSchema: Added git: GitInfoSchema, applications: ApplicationProfileSchema[], updated commands to use DiscoveredCommandSchema, updated technology arrays to use evidence-backed
  DetectedTechnologySchema.
  - TechnologyCategory enum (new): language, framework, packageManager, buildSystem, testFramework, ciSystem.
  - CommandCategory enum (new): INSTALL, BUILD, TEST, LINT, TYPECHECK, BROWSER, START, OTHER.

  Deviations

  None. Implementation follows PRD, Technical Product Specification, AGENTS.md, and all accepted ADRs.

  Deferred

  - Execution Controller and project command execution (Milestone 2+)
  - Test execution and result parsing
  - Docker execution
  - Dependency installation
  - Failure investigation and baseline comparison
  - Risk reasoning and validation-plan reasoning
  - Test generation
  - Playwright/browser workflow execution
  - Evidence persistence for QE runs
  - Verdict generation
  - GitHub checks and issue creation
  - Project-memory persistence
  - Multi-agent orchestration
  - Full monorepo workspace dependency graph
  - Documentation summarization with LLM
  - Advanced CI system detection beyond GitHub Actions

  Concerns

  1. Git root vs. target path: When analyzing a subdirectory of a git repo, the analyzer uses the target path as root (not the git root). This is correct for qe analyze --repo fixtures/node-vitest but may need
  revisiting when analyzing nested working directories in a monorepo context.
  2. TOML parsing: The Python adapter uses regex-based TOML parsing rather than a proper TOML parser. This is sufficient for the simple dependency patterns in Milestone 1 but a TOML parser library should be
  considered if Python ecosystem support deepens.
  3. Command deduplication: CI-discovered commands may partially overlap with adapter-discovered commands. The deduplication is by id field which prevents exact duplicates but semantically similar commands from
  different sources both appear.
