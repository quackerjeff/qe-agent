**Milestone:** 1
**Status:** Accepted for Implementation
**Depends On:** Milestone 0
**Completed:** —
**Accepted:** —

# Implementation Assignment — Milestone 1: Repository Intelligence

Implement **Milestone 1 — Repository Intelligence** of the QE Agent.

Before making changes, read and follow:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. all accepted ADRs under `docs/adr/`

Milestone 0 is the accepted baseline.

Do not redesign or replace Milestone 0 architecture unless a genuine defect or specification conflict requires it.

The Technical Product Specification provides context for the full product. **Implement only Milestone 1.**

# Objective

Build deterministic repository intelligence capable of inspecting an unfamiliar source repository and producing a structured, evidence-backed `RepositoryProfile`.

At the end of this milestone:

```text
qe analyze
```

should inspect the current repository and report:

- detected ecosystems;
- languages;
- package managers;
- build systems;
- test frameworks;
- applications;
- CI systems;
- relevant repository instructions;
- discovered build/test commands;
- available QE capabilities;
- confidence and supporting evidence.

The system SHALL NOT execute discovered project commands during this milestone.

# Core Principle

Milestone 1 answers:

> **What is this repository, and how does the available evidence suggest it is built and tested?**

It does NOT yet answer:

> **Does the software work?**

Repository analysis must remain observational.

# Required Implementation

## 1. Implement `qe analyze`

Replace the Milestone 0 placeholder for:

```text
qe analyze
```

with functional repository analysis.

Default behavior:

```text
qe analyze
```

analyzes the current working directory.

Support an optional repository path if consistent with the existing CLI design, for example:

```text
qe analyze --repo ../some-project
```

Do not introduce unnecessary CLI options.

The command SHALL:

1. locate the repository root;
2. inspect repository structure;
3. discover relevant project metadata;
4. build a `RepositoryProfile`;
5. render a concise human-readable report;
6. optionally emit structured JSON if the current CLI architecture supports this cleanly.

Do not execute repository build or test commands.

---

## 2. Repository Root Discovery

Implement repository-root discovery.

Prefer deterministic Git information when available.

The analyzer SHOULD:

- detect whether the target path belongs to a Git repository;
- identify the repository root;
- handle execution from a nested directory;
- support non-Git source directories where practical;
- avoid requiring Git for all repository analysis.

A missing `.git` directory SHALL NOT automatically make a project unsupported.

Represent whether Git metadata was available.

---

## 3. Repository File Inventory

Build a bounded repository inventory suitable for deterministic discovery.

The inventory SHOULD identify relevant files and directories without blindly reading every file.

Important examples include:

```text
package.json
package-lock.json
pnpm-lock.yaml
yarn.lock
bun.lock
bun.lockb

pyproject.toml
requirements.txt
Pipfile
poetry.lock
uv.lock

*.sln
*.csproj
*.fsproj

pom.xml
build.gradle
build.gradle.kts
settings.gradle
settings.gradle.kts

go.mod
go.sum

Cargo.toml
Cargo.lock

Gemfile
Gemfile.lock

composer.json
composer.lock

Makefile

Dockerfile
docker-compose.yml
docker-compose.yaml
compose.yml
compose.yaml

README*
CONTRIBUTING*
AGENTS.md
CLAUDE.md

.github/workflows/*
```

The implementation SHOULD be extensible rather than one monolithic function containing every rule.

Ignore obvious generated or dependency directories such as:

```text
node_modules
dist
build
coverage
.git
vendor
target
bin
obj
.venv
venv
```

where appropriate.

Do not create an excessively broad ignore system yet.

---

## 4. Evidence-Backed Detection Model

Every important detection SHALL include evidence.

Do not return only:

```text
Python
```

Prefer a structured result conceptually similar to:

```typescript
interface DetectedTechnology {
  id: string;
  name: string;
  category: TechnologyCategory;
  confidence: number;
  evidence: DetectionEvidence[];
}
```

Example:

```json
{
  "id": "python",
  "name": "Python",
  "category": "language",
  "confidence": 0.98,
  "evidence": [
    {
      "source": "pyproject.toml",
      "reason": "Python project metadata detected"
    }
  ]
}
```

Confidence SHALL reflect the strength of available evidence.

Avoid artificial precision. Internally, confidence may be numeric if useful, but the human report may render:

```text
HIGH
MEDIUM
LOW
```

if that is clearer.

---

## 5. Detection Priority

Use deterministic repository evidence first.

A strong evidence hierarchy is:

```text
explicit project metadata
>
explicit configuration
>
CI configuration
>
project documentation
>
filename conventions
>
directory conventions
>
heuristics
```

Do NOT introduce LLM reasoning merely to identify known ecosystems in Milestone 1.

If evidence conflicts, preserve the conflict rather than silently selecting one answer.

---

## 6. Language Detection

Implement deterministic detection for common source languages.

Initial useful coverage SHOULD include at least:

```text
TypeScript
JavaScript
Python
C#
Java
Go
Rust
Ruby
PHP
```

Detection may use:

- project metadata;
- recognized build files;
- source extensions;
- repository composition.

Source extension counting alone SHALL NOT be treated as definitive ecosystem detection.

Generated/vendor directories must be excluded from source-language inference.

---

## 7. Package Manager Detection

Detect common package managers.

At minimum:

### JavaScript / TypeScript

```text
npm
pnpm
yarn
bun
```

### Python

```text
pip
poetry
uv
pipenv
```

### .NET

```text
NuGet / dotnet tooling
```

### Java

```text
Maven
Gradle
```

### Others

Recognize package/build metadata for:

```text
Go modules
Cargo
Bundler
Composer
```

Confidence and evidence SHALL be recorded.

Where multiple package managers are present, report the ambiguity rather than arbitrarily choosing one.

---

## 8. Framework Detection

Add deterministic detection for selected high-value frameworks.

Initial support SHOULD include common patterns such as:

### JavaScript / TypeScript

```text
React
Next.js
Express
Node.js
```

### Python

```text
Django
Flask
FastAPI
```

### .NET

```text
ASP.NET Core
```

Framework detection SHOULD primarily rely on package/dependency metadata and configuration rather than filenames alone.

This list is intentionally incomplete.

Unknown frameworks must not prevent useful repository analysis.

---

## 9. Build System Detection

Detect common build systems and build entry points.

Examples:

```text
npm/pnpm/yarn package scripts
Makefile
dotnet
MSBuild
Maven
Gradle
Go tooling
Cargo
Docker build configuration
```

Represent build systems separately from discovered commands.

Do not execute build commands.

---

## 10. Test Framework Detection

Detect existing test frameworks.

Initial useful coverage SHOULD include:

### JavaScript / TypeScript

```text
Vitest
Jest
Mocha
Playwright
```

### Python

```text
pytest
unittest
```

### .NET

```text
xUnit
NUnit
MSTest
```

### Java

```text
JUnit
```

### Other

```text
Go testing
Cargo test
RSpec
PHPUnit
```

Detection SHOULD use configuration and dependency metadata where possible.

Do not claim a test framework merely because a test-like directory exists.

---

## 11. Test Location Discovery

Identify likely test locations.

Examples:

```text
tests/
test/
__tests__/
spec/
e2e/
integration/
src/**/*.test.*
src/**/*.spec.*
```

Represent these as discovered locations with confidence/evidence.

Do not recursively ingest all test contents.

---

## 12. Repository Instruction Discovery

Discover relevant repository documentation and agent/developer instructions.

At minimum inspect for:

```text
README*
CONTRIBUTING*
AGENTS.md
CLAUDE.md
docs/
```

The analyzer SHOULD return metadata about relevant instruction files.

Milestone 1 MAY read bounded portions of these files for command discovery.

Do not build full documentation summarization with an LLM.

Instruction discovery SHOULD preserve where information came from.

---

## 13. CI Discovery

Detect common CI systems.

Initial support SHOULD include:

```text
GitHub Actions
```

and MAY recognize obvious metadata for other systems if trivial.

For GitHub Actions, inspect workflow YAML files for useful repository intelligence such as:

- package installation commands;
- build commands;
- test commands;
- runtime versions.

Do not execute workflows.

Do not couple the core repository analyzer to GitHub-specific result reporting.

GitHub workflow parsing is repository intelligence, not GitHub integration.

---

## 14. Command Discovery

Discover likely commands for:

```text
install
build
test
lint
typecheck
browser/e2e
start/dev
```

Sources may include:

```text
package.json scripts
Makefile targets
README instructions
CI workflows
framework conventions
```

Every discovered command SHALL record provenance.

Conceptually:

```typescript
interface DiscoveredCommand {
  id: string;
  category:
    | "INSTALL"
    | "BUILD"
    | "TEST"
    | "LINT"
    | "TYPECHECK"
    | "BROWSER"
    | "START"
    | "OTHER";

  command: string;
  source: string;
  confidence: number;
}
```

Do not execute these commands.

---

## 15. Command Safety Boundary

Milestone 1 SHALL NOT invoke project commands during discovery.

This means no:

```text
npm install
npm test
pytest
dotnet test
mvn test
gradle test
docker build
docker compose up
playwright test
```

even if such commands are discovered.

Running safe QE Agent internal commands such as Git metadata queries is permitted where needed for repository analysis.

The distinction must remain explicit in code.

---

## 16. Capability Registry

Implement initial population of the Capability Registry.

Capabilities describe what the repository appears able to support later.

Examples:

```text
git.analysis
generic.shell
node.npm
node.pnpm
node.vitest
node.jest
python.pytest
dotnet.test
browser.playwright
docker
```

At Milestone 1, capabilities are **discovered**, not executed.

Each capability SHOULD include:

- ID;
- provider/adapter;
- availability;
- confidence;
- evidence or relevant metadata.

The capability registry SHALL not imply that execution has succeeded.

---

## 17. Adapter Structure

Introduce the initial adapter architecture required by ADR-002.

Suggested organization:

```text
src/adapters/
├── generic/
├── javascript/
├── python/
├── dotnet/
└── browser/
```

Exact structure may vary.

Adapters SHOULD remain small and focused on detection/capability contribution.

Do not implement execution adapters yet.

The orchestrator or analyzer SHALL NOT contain large ecosystem-specific conditional blocks.

---

## 18. Generic Repository Intelligence

The system MUST still produce useful output when no specialized ecosystem adapter recognizes the repository.

For an unknown project, attempt to discover:

- documentation;
- CI configuration;
- Makefile/build scripts;
- likely source languages;
- possible test directories;
- Docker configuration;
- custom commands mentioned in project docs or CI.

Example desired behavior:

```text
Detected Ecosystem
------------------
Unknown / Custom

Discovered Build Instructions
-----------------------------
./tools/build-project
Source: README.md

Discovered Test Instructions
----------------------------
./tools/run-tests
Source: .github/workflows/ci.yml

Analysis Confidence
-------------------
MEDIUM
```

Unknown technology is a valid result.

---

## 19. Application Detection

Populate `RepositoryProfile.applications` where evidence reasonably indicates distinct runnable applications or services.

Examples might include:

```text
frontend
backend
api
worker
web
service
```

Avoid over-engineering monorepo topology.

For Milestone 1, application detection may remain conservative.

It is better to report one repository-level application with uncertainty than invent complex service boundaries.

---

## 20. Monorepository Awareness

The analyzer SHOULD recognize obvious multi-project repositories.

Examples:

```text
apps/
packages/
services/
multiple package.json files
multiple *.csproj files
multiple pyproject.toml files
```

Milestone 1 does NOT need a full workspace dependency graph.

It SHOULD avoid assuming that one root-level tool configuration describes every subproject.

Record detected project roots where practical.

---

## 21. `RepositoryProfile`

At the end of analysis, return a validated `RepositoryProfile`.

Review and minimally extend the Milestone 0 schema as required.

Do not casually break the canonical domain model.

Any schema changes SHALL remain consistent with:

- ADR-004;
- ADR-009;
- the Technical Product Specification.

If the existing schema is insufficient, change it intentionally and add tests.

---

## 22. Human-Readable Report

`qe analyze` SHOULD produce concise output.

Example:

```text
QE Repository Analysis

Repository
----------
/path/to/project

Git
---
Detected
Branch: feature/example

Detected Ecosystems
-------------------
TypeScript / Node.js    HIGH
React                   HIGH

Package Manager
---------------
pnpm                    HIGH

Build
-----
pnpm build
Source: package.json

Tests
-----
Vitest
Command: pnpm test

Browser Testing
---------------
Playwright detected
Command: pnpm test:e2e

CI
--
GitHub Actions

Project Instructions
--------------------
README.md
AGENTS.md

Capabilities
------------
✓ git.analysis
✓ node.pnpm
✓ node.vitest
✓ browser.playwright

Analysis Confidence
-------------------
HIGH
```

Output must not imply that any discovered command was executed.

Use wording such as:

```text
detected
discovered
configured
appears available
```

rather than:

```text
passed
verified
working
```

unless actual execution occurred.

---

## 23. JSON Output

If practical within the existing CLI design, support:

```text
qe analyze --json
```

The JSON output SHALL serialize the validated `RepositoryProfile` and any analysis metadata.

If adding `--json` requires disproportionate CLI redesign, defer it and document the decision.

Do not build multiple reporting formats yet.

---

## 24. Fixture Repositories

Create real Milestone 1 fixture repositories.

At minimum include representative fixtures for:

```text
JavaScript / TypeScript
Python
.NET
Unknown / custom repository
```

Prefer tiny fixtures.

Each fixture SHOULD contain enough metadata to test detection without installing dependencies.

Example:

```text
fixtures/
├── node-vitest/
├── python-pytest/
├── dotnet-xunit/
└── custom-build/
```

A browser-capable fixture SHOULD be added if Playwright detection is implemented in this milestone.

---

## 25. Detection Tests

Add automated tests covering:

- repository-root detection;
- nested working-directory analysis;
- language detection;
- package-manager detection;
- framework detection;
- test-framework detection;
- CI detection;
- command discovery;
- instruction discovery;
- capability population;
- conflicting evidence;
- unknown/custom repository handling;
- monorepo-like structure;
- exclusion of generated/vendor directories.

Tests SHALL NOT require network access.

Tests SHALL NOT install fixture dependencies.

Tests SHALL NOT execute fixture build/test commands.

---

## 26. Evidence Tests

Add tests proving that detections retain provenance.

For example:

```text
Vitest detected
```

must be traceable to something such as:

```text
package.json devDependency
vitest.config.ts
package script
```

Do not allow a detection to exist without supporting evidence unless explicitly categorized as heuristic.

---

## 27. Confidence Tests

Add tests for obvious confidence distinctions.

Examples:

### Strong evidence

```text
package.json contains vitest dependency
+
vitest.config.ts exists
```

should produce stronger confidence than:

```text
tests/example.test.ts exists
```

The exact numerical scoring does not need to be sophisticated.

The behavior must be predictable and documented.

---

## 28. No LLM Dependency

Milestone 1 SHALL work without any real LLM provider.

Do not add OpenAI, Anthropic, or other provider dependencies.

Do not invoke the Model Gateway for routine repository discovery.

If a future fallback using AI appears useful, defer it to a later milestone unless explicitly approved.

---

## 29. Documentation

Update project documentation to describe:

```text
qe analyze
```

including:

- what it inspects;
- what it does not do;
- that discovered commands are not executed;
- supported enhanced ecosystems;
- unknown-project behavior;
- example output.

Update ADRs only if an actual architectural decision changes.

Do not create ADRs merely to document ordinary implementation details.

# Architecture Constraints

Preserve all existing accepted architecture.

Especially:

- single QE Orchestrator direction;
- explicit state-machine architecture;
- provider-independent Model Gateway;
- deterministic discovery before AI reasoning;
- evidence-first domain model;
- adapter-based ecosystem capabilities;
- GitHub remains an integration, not the core;
- no project command execution in Milestone 1;
- no production-code mutation;
- no multi-agent architecture.

# Do Not Implement Yet

Do NOT implement:

- Execution Controller;
- project build execution;
- test execution;
- Docker execution;
- dependency installation;
- test result parsing;
- failure investigation;
- baseline comparison behavior;
- autonomous change analysis;
- risk reasoning;
- validation-plan reasoning;
- test generation;
- Playwright execution;
- browser workflow testing;
- application startup execution;
- evidence persistence for QE runs;
- verdict generation behavior;
- GitHub checks;
- GitHub issue creation;
- project-memory persistence behavior;
- multi-agent orchestration;
- hosted infrastructure.

# Milestone 1 Acceptance Criteria

Milestone 1 is complete when all of the following are true:

1. `qe analyze` operates against the current repository.
2. Analysis works from a nested directory and resolves the appropriate repository/project root.
3. Repository analysis does not execute project build/test/install/start commands.
4. Known ecosystems are detected from deterministic evidence.
5. Unknown/custom repositories produce useful analysis instead of failing.
6. Language detections contain supporting evidence.
7. Package-manager detections contain supporting evidence.
8. Framework detections contain supporting evidence.
9. Test-framework detections contain supporting evidence.
10. Relevant repository instruction files are discovered.
11. CI configuration is discovered where present.
12. Likely build/test/lint/typecheck/browser/start commands are discovered with provenance.
13. The Capability Registry is populated from repository evidence.
14. Specialized detection behavior is implemented through adapters rather than hard-coded orchestration logic.
15. RepositoryProfile is runtime validated.
16. Fixture repositories cover JavaScript/TypeScript, Python, .NET, and unknown/custom behavior.
17. Automated tests cover both successful and ambiguous/conflicting detection scenarios.
18. No real LLM provider is required.
19. No network access is required for tests.
20. No fixture dependency installation is required.
21. Build passes.
22. Tests pass.
23. Lint passes.
24. Formatting checks pass.
25. Type checking passes.
26. No functionality from later milestones has been unnecessarily implemented.

# Required Demonstration

Demonstrate at least the following four analyses:

## Fixture 1 — JavaScript / TypeScript

Show detection of:

```text
language/ecosystem
package manager
test framework
commands
capabilities
evidence
```

## Fixture 2 — Python

Show detection of:

```text
language/ecosystem
package manager
test framework
commands
capabilities
evidence
```

## Fixture 3 — .NET

Show detection of:

```text
language/ecosystem
build tooling
test framework
commands
capabilities
evidence
```

## Fixture 4 — Unknown / Custom

Show that QE Agent still discovers useful build/test/documentation information without a recognized specialized ecosystem.

# Completion Report

When finished, provide:

## Implemented

Summarize repository-intelligence capabilities added.

## Detection Architecture

Describe:

- adapter organization;
- evidence model;
- confidence approach;
- repository inventory strategy;
- command discovery strategy.

## Demonstrations

Provide representative output from the four required fixtures.

## Tests

Summarize important test scenarios, not merely total test count.

## Validation

Report exact commands and results for:

```text
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

## Repository Changes

List important files/directories added or modified.

## Schema Changes

Describe any changes to Milestone 0 domain schemas and why they were necessary.

## Deviations

Identify any deviation from:

- PRD;
- Technical Product Specification;
- `AGENTS.md`;
- accepted ADRs.

If none, explicitly state none.

## Deferred

List functionality intentionally left for Milestone 2 or later.

## Concerns

Identify design questions or technical concerns that should be reviewed before Milestone 2.

**Stop after completing Milestone 1. Do not begin Milestone 2.**
