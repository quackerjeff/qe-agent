# Milestone 1 Correction Assignment — Repository Intelligence

**Milestone:** 1  
**Status:** ACCEPTED
**Purpose:** Resolve findings from the independent Milestone 1 review  
**Next Milestone:** Do NOT begin Milestone 2

## Required Reading

Before modifying code, read:

1. `AGENTS.md`
2. `docs/milestones/milestone-1-repository-intelligence.md`
3. `docs/milestones/milestone-1-review.md`
4. relevant PRD/System Design sections
5. all accepted ADRs

Inspect the actual implementation before making changes.

Do not redesign Milestone 1 unless required to correct the reviewed behavior.

# Objective

Correct the identified repository-intelligence defects while preserving the Milestone 1 architecture and observational execution boundary.

Milestone 1 must continue to answer:

> What is this repository, and how does deterministic evidence suggest it is built and tested?

It must not execute project-defined commands.

# Required Corrections

## 1. Nested Directory Analysis

Correct repository/project-root resolution.

Running `qe analyze` from a nested directory must resolve an appropriate analysis root rather than treating the nested directory as the entire project.

For example, analysis from:

```text
fixtures/node-vitest/src/
```

must be capable of discovering the relevant parent project metadata such as:

```text
package.json
package-lock.json
vitest configuration
```

Use deterministic root discovery.

Git repositories should use Git-root information where appropriate.

Non-Git projects should use a reasonable nearest-project-root strategy based on recognized project metadata.

Preserve the originally requested path separately if useful.

Add tests for:

- repository root invocation;
- nested invocation;
- non-Git nested project invocation.

## 2. Nested Project / Fixture Pollution

Correct root-level aggregation so nested independent projects do not automatically become technologies of the parent repository.

The correction MUST NOT simply special-case `fixtures/`.

The repository analyzer should distinguish, at a minimal level, between:

- repository-level evidence;
- nested project/application evidence;
- generated/vendor content;
- obvious independent example/fixture/sample projects where deterministically identifiable.

A nested `.csproj`, `package.json`, `pyproject.toml`, etc. should not automatically mean its ecosystem applies to the entire repository.

It is acceptable for nested projects to appear as detected applications/project roots without contaminating root-level technology conclusions.

Do NOT build a full monorepo dependency graph.

Add regression tests using the QE Agent repository or a representative fixture.

## 3. Python Packaging Detection

Improve Python packaging/package-management intelligence.

Do NOT assume:

```text
pyproject.toml → pip with high confidence
```

Use evidence appropriately.

Examples of stronger specific evidence include:

```text
poetry.lock       → Poetry
uv.lock           → uv
Pipfile           → Pipenv
requirements.txt  → pip-compatible dependency workflow
```

`pyproject.toml` alone may indicate Python project/package management without identifying one specific installer with high confidence.

The resulting RepositoryProfile must still provide useful packaging/build-management intelligence for the Python fixture.

Add tests for relevant evidence combinations.

## 4. Makefile / Custom Command Discovery

Improve generic command discovery sufficiently to recognize simple Makefile targets such as:

```makefile
build:
	...

test:
	...
```

and produce commands such as:

```text
make build
make test
```

with Makefile provenance.

Also correctly classify clear commands such as:

```text
make test
```

when found in CI configuration.

Do not implement a complete Makefile parser.

Do not execute Make targets.

Add tests for:

- build target discovery;
- test target discovery;
- CI command classification;
- provenance.

## 5. Valid JSON Output

Correct:

```text
qe analyze --json
```

so stdout contains valid machine-readable JSON and nothing else.

Diagnostic/progress logging must not contaminate stdout.

If logging is retained during JSON mode, send appropriate logs to stderr or suppress them.

Add an automated test that captures stdout and successfully parses it with `JSON.parse`.

## 6. Correct .NET Evidence Provenance

Correct .NET test/framework detection so evidence references the actual project/configuration file containing the matched evidence.

For example, if xUnit is declared in:

```text
tests/MyProject.Tests/MyProject.Tests.csproj
```

the xUnit detection must not cite an unrelated application `.csproj`.

Add a regression test verifying evidence source accuracy.

## 7. Ambiguous JavaScript Package Managers

When multiple package-manager signals exist, do not arbitrarily present one package manager as authoritative when generating discovered commands.

For example:

```text
package-lock.json
pnpm-lock.yaml
```

represents conflicting/ambiguous evidence unless stronger evidence resolves it.

Use the smallest reasonable solution.

Acceptable approaches include:

- explicitly representing ambiguity;
- lowering confidence;
- retaining the underlying package script without claiming an authoritative runner;
- using stronger repository evidence to resolve the package manager when available.

Do not build a complex package-manager scoring system.

Add a regression test for ambiguous lockfiles.

# Evidence Requirements

All corrected detections must retain accurate provenance.

A detection must not cite a file merely because that file belongs to the same ecosystem.

Evidence must correspond to the evidence actually used to reach the conclusion.

# Safety Requirement

Milestone 1 remains observational.

Do NOT execute:

```text
npm install
npm test
pnpm test
pytest
dotnet test
make
docker
playwright
application startup commands
```

or any other project-defined command.

Deterministic Git metadata operations remain permitted.

# Do Not Implement

Do not implement:

- full monorepo dependency graphs;
- complete Makefile interpretation;
- complete GitHub Actions interpretation;
- Execution Controller;
- build execution;
- test execution;
- Docker execution;
- browser execution;
- LLM reasoning;
- risk assessment behavior;
- validation planning;
- test generation;
- verdict generation;
- project memory;
- GitHub reporting;
- multi-agent orchestration.

# Required Regression Tests

At minimum add tests proving:

1. nested directory analysis resolves appropriate project metadata;
2. nested projects do not incorrectly pollute parent repository technologies;
3. Python packaging signals produce appropriate evidence-backed results;
4. simple `make test` discovery works;
5. CI `make test` is classified correctly;
6. `qe analyze --json` produces parseable JSON stdout;
7. .NET framework evidence points to the correct source file;
8. ambiguous JavaScript package managers do not produce unjustified certainty.

# Required Demonstrations

After corrections, demonstrate:

### QE Agent Repository

Run repository analysis against QE Agent itself.

Verify fixture technologies do not appear incorrectly as root-level QE Agent technologies.

### Nested Node Fixture

Run analysis from a nested directory within the Node/Vitest fixture.

Verify project metadata, package manager, test framework, and commands remain discoverable.

### Python Fixture

Verify useful Python packaging intelligence is reported with accurate confidence/evidence.

### Custom Fixture

Verify both:

```text
make build
make test
```

are discovered where defined.

### JSON

Demonstrate that:

```text
qe analyze --json
```

produces output that can be parsed directly as JSON.

# Validation

Run:

```text
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

All must pass.

# Completion Report

Provide:

## Corrections Made

Map each independent-review finding to the correction made.

## Tests Added

Identify regression tests added for each finding.

## Demonstration Results

Report results from the required demonstrations.

## Validation Results

Report exact commands and results.

## Architecture Impact

Identify any changes to architectural boundaries, domain schemas, or adapters.

If none, state none.

## Remaining Findings

Identify anything intentionally deferred and why.

## Scope Confirmation

Explicitly confirm that no Milestone 2 functionality was implemented.

Stop after completing the Milestone 1 corrections.

Do not begin Milestone 2.



# Corrected after re-review
• ACCEPT

  I verified the Milestone 1 corrections against the previously reported HIGH, MEDIUM, and LOW findings. All are resolved.

  Verified Fixes

  - Nested directory analysis now resolves fixtures/node-vitest/src to fixtures/node-vitest and discovers TypeScript, npm, Vitest, and commands.
  - QE Agent root analysis is no longer polluted by fixture Python/.NET technologies.
  - Python pyproject.toml fixture now reports evidence-backed package management with low confidence.
  - Custom Makefile fixture now discovers make build and make test; CI also classifies both correctly.
  - qe analyze --json stdout parses as valid JSON; diagnostics go to stderr.
  - .NET evidence now cites tests/MyApp.Tests/MyApp.Tests.csproj for xUnit and src/MyApp/MyApp.csproj for ASP.NET Core.
  - Ambiguous JS lockfiles lower package-manager confidence and include ambiguity evidence.

  Validation Run

  - npm run build: PASS
  - npm test: PASS, 141 tests / 9 files
  - npm run lint: PASS
  - npm run format:check: PASS
  - npm run typecheck: PASS

  Demonstrations Run

  - qe analyze from fixtures/node-vitest/src: PASS, resolves project root correctly.
  - qe analyze on QE Agent root: PASS, no fixture ecosystem pollution.
  - qe analyze --repo fixtures/python-pytest: PASS, Python packaging detected with LOW confidence.
  - qe analyze --repo fixtures/custom-build: PASS, Makefile and CI build/test commands discovered.
  - qe analyze --repo fixtures/dotnet-xunit --json: PASS, evidence provenance corrected.
  - qe analyze --repo fixtures/node-ambiguous-pm --json: PASS, ambiguity represented.
  - JSON output parse check: PASS.

  Scope Check

  No Milestone 2 functionality was introduced. Product code still only executes deterministic Git metadata commands via git rev-parse; discovered project build/test/install/browser/Docker commands are not
  executed. No execution controller, evidence store, test execution, Docker execution, browser execution, verdict generation, risk reasoning, or autonomous QE behavior was added.
