# QE Agent
## MVP Technical Product Specification & System Design

**Status:** Draft for Implementation  
**Version:** 0.1  
**Companion Document:** QE Agent Product & Functional Requirements  
**Audience:** CTO, engineering team, implementation agents, AI coding agents  
**Scope:** MVP

---

# 1. Purpose

This document defines the technical architecture and implementation requirements for the MVP of the QE Agent.

The QE Agent is an autonomous Quality Engineering system capable of evaluating a source-code repository or proposed code change, determining an appropriate validation strategy, executing available quality checks, generating additional tests when justified, investigating failures, and producing an evidence-supported QE verdict.

This document is intended to be sufficiently specific that an implementation agent can use it to construct the product incrementally.

The MVP SHALL prioritize:

1. trustworthy QE behavior;
2. clear evidence;
3. safe execution;
4. extensibility;
5. local-first operation;
6. GitHub integration;
7. project-specific persistent QE knowledge;
8. independence from any single programming language, framework, CI platform, or LLM vendor.

---

# 2. MVP Product Boundary

The MVP SHALL operate against source-code repositories.

The primary workflow is:

```text
Requirements
     +
Repository / Change
     |
     v
Repository Discovery
     |
     v
Change Analysis
     |
     v
Risk Assessment
     |
     v
QE Validation Plan
     |
     v
Capability Selection
     |
     v
Controlled Execution
     |
     v
Failure Investigation
     |
     v
Gap Analysis
     |
     v
Evidence Evaluation
     |
     v
QE Verdict
```

The MVP SHALL support three primary entry points:

```text
Local CLI
GitHub Actions
Programmatic Core API
```

All three entry points SHALL invoke the same core QE engine.

GitHub-specific behavior SHALL NOT be embedded inside the core reasoning engine.

---

# 3. Architectural Principles

## 3.1 Core Engine Is Environment Independent

The QE engine SHALL NOT depend directly on GitHub Actions, Docker, Playwright, pytest, npm, or any other execution technology.

Those capabilities SHALL be exposed through adapters.

---

## 3.2 LLM Independence

The QE Agent SHALL NOT embed direct calls to a specific AI provider throughout the application.

All model interaction SHALL occur through an LLM abstraction layer.

Conceptually:

```text
QE Engine
    |
    v
Model Gateway
    |
    +-- OpenAI Provider
    +-- Anthropic Provider
    +-- Future Provider
    +-- Local Model Provider
```

The MVP MAY initially implement only one or two providers.

The architecture SHALL allow additional providers without changing QE business logic.

---

## 3.3 Deterministic Execution, Probabilistic Reasoning

LLMs SHOULD decide:

- what changed;
- what is risky;
- what should be tested;
- what additional scenarios matter;
- what failures probably mean;
- what remains uncertain.

Deterministic components SHALL perform:

- Git operations;
- filesystem operations;
- command execution;
- test execution;
- timeout enforcement;
- result parsing;
- evidence storage;
- configuration loading;
- policy enforcement;
- GitHub status updates.

The LLM SHALL NOT be treated as evidence that an action occurred.

---

## 3.4 Evidence Is a First-Class Object

Every meaningful QE conclusion SHALL be traceable to evidence.

Examples:

```text
TEST_RESULT
COMMAND_RESULT
BUILD_RESULT
STATIC_ANALYSIS_RESULT
BROWSER_RESULT
SCREENSHOT
TRACE
SOURCE_INSPECTION
DIFF_ANALYSIS
REQUIREMENT_MAPPING
MANUAL_INFERENCE
```

The system SHALL distinguish between:

```text
observed
executed
inferred
not verified
```

---

## 3.5 Graceful Degradation

Unknown technologies SHALL NOT automatically make a repository unsupported.

The QE Agent SHALL first attempt generic repository discovery.

If specialized adapters are unavailable, the agent SHOULD attempt to determine appropriate build and test behavior from:

- documentation;
- scripts;
- CI workflows;
- build files;
- package metadata;
- repository instructions.

The final verdict SHALL reflect reduced confidence when capabilities are unavailable.

---

# 4. Recommended Implementation Technology

The reference implementation SHOULD use:

```text
Language:            TypeScript
Runtime:             Node.js
CLI Framework:       lightweight TypeScript CLI library
Validation:          JSON Schema and/or Zod
Git Operations:      git CLI
Process Execution:   controlled child-process abstraction
Container Runtime:   Docker CLI initially
Browser Automation:  Playwright
Persistence:         filesystem / JSON / Markdown
CI Integration:      GitHub Actions
```

TypeScript is recommended because:

- it is well suited to CLI and orchestration software;
- GitHub integration is straightforward;
- Playwright has excellent TypeScript support;
- JSON/schema-oriented agent communication maps naturally to TypeScript;
- asynchronous tool execution is straightforward;
- the eventual product can evolve toward a service architecture without rewriting the core domain model.

This recommendation applies to the QE Agent implementation itself.

It does NOT limit which languages the QE Agent can test.

---

# 5. High-Level System Architecture

```text
                         +----------------------+
                         |      CLI / CI / API  |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |    QE Orchestrator   |
                         +----------+-----------+
                                    |
             +----------------------+----------------------+
             |                      |                      |
             v                      v                      v
    +----------------+     +----------------+     +----------------+
    | Repository     |     | Reasoning      |     | Project Memory |
    | Intelligence   |     | Engine         |     | Manager        |
    +-------+--------+     +-------+--------+     +-------+--------+
            |                      |                      |
            +----------------------+----------------------+
                                   |
                                   v
                         +----------------------+
                         | Capability Registry  |
                         +----------+-----------+
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
        v                           v                           v
+---------------+          +----------------+          +----------------+
| Test / Build  |          | Browser / API  |          | Static Tool    |
| Adapters      |          | Adapters       |          | Adapters       |
+-------+-------+          +-------+--------+          +-------+--------+
        |                          |                           |
        +--------------------------+---------------------------+
                                   |
                                   v
                         +----------------------+
                         | Execution Controller |
                         +----------+-----------+
                                    |
                    +---------------+---------------+
                    |                               |
                    v                               v
             Local Execution                  Docker Execution
                    |                               |
                    +---------------+---------------+
                                    |
                                    v
                         +----------------------+
                         |    Evidence Store    |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         | Findings / Verdict   |
                         +----------+-----------+
                                    |
             +----------------------+----------------------+
             |                      |                      |
             v                      v                      v
          Console               JSON Report            GitHub Check
```

---

# 6. Core Components

## 6.1 QE Orchestrator

The `QEOrchestrator` SHALL coordinate an entire QE engagement.

It SHALL NOT contain ecosystem-specific test logic.

Conceptual interface:

```typescript
interface QEOrchestrator {
  run(request: QERequest): Promise<QEResult>;
}
```

A request SHOULD resemble:

```typescript
interface QERequest {
  repositoryPath: string;
  requirements?: Requirement[];
  baselineRef?: string;
  targetRef?: string;
  profile: "quick" | "standard" | "deep";
  mode: "repository" | "change";
}
```

---

# 7. QE Agent Lifecycle

The orchestrator SHALL operate as an explicit state machine.

Recommended states:

```text
INITIALIZING
DISCOVERING
UNDERSTANDING_CHANGE
ASSESSING_RISK
PLANNING
EXECUTING
INVESTIGATING
GENERATING_TESTS
RETESTING
ANALYZING_GAPS
FORMING_VERDICT
REPORTING
COMPLETE
BLOCKED
```

State transitions SHALL be recorded.

This makes execution:

- debuggable;
- resumable later;
- auditable;
- observable;
- easier to test.

The implementation SHOULD avoid one enormous unconstrained "QE Agent" prompt.

---

# 8. Repository Discovery Engine

The repository analyzer SHALL create a structured `RepositoryProfile`.

Example:

```typescript
interface RepositoryProfile {
  root: string;

  languages: DetectedTechnology[];
  frameworks: DetectedTechnology[];

  packageManagers: DetectedTechnology[];
  buildSystems: DetectedTechnology[];
  testFrameworks: DetectedTechnology[];

  applications: ApplicationProfile[];

  ciSystems: DetectedTechnology[];

  documentation: RepositoryDocument[];

  commands: DiscoveredCommand[];

  capabilities: Capability[];

  confidence: number;
}
```

Discovery SHALL use deterministic evidence before AI inference.

Example detection:

```text
package.json        -> Node ecosystem candidate
pyproject.toml      -> Python ecosystem candidate
requirements.txt    -> Python ecosystem candidate
*.csproj            -> .NET candidate
pom.xml             -> Maven/Java candidate
build.gradle        -> Gradle candidate
go.mod              -> Go candidate
Cargo.toml          -> Rust candidate
composer.json       -> PHP candidate
Gemfile             -> Ruby candidate
```

Detection rules SHALL NOT imply that a command is safe to execute.

---

# 9. Repository Instruction Discovery

Before planning or modifying tests, the agent SHALL search for project instructions.

Examples:

```text
README.md
CONTRIBUTING.md
AGENTS.md
CLAUDE.md
docs/
.github/workflows/
Makefile
package.json
docker-compose.yml
compose.yml
```

Relevant instructions SHALL become part of `ProjectContext`.

The system SHOULD summarize large documentation rather than repeatedly injecting complete files into model context.

---

# 10. Change Analyzer

When operating in change mode, the system SHALL determine:

```text
baseline revision
target revision
changed files
added files
deleted files
renamed files
changed dependencies
changed configuration
changed tests
changed public interfaces
```

Git SHALL provide deterministic diff data.

AI reasoning MAY then interpret semantic impact.

Conceptual output:

```typescript
interface ChangeAnalysis {
  summary: string;
  changedFiles: ChangedFile[];
  affectedComponents: ComponentImpact[];
  behaviorChanges: BehaviorChange[];
  potentialBlastRadius: ImpactArea[];
  unknowns: string[];
}
```

---

# 11. Risk Engine

Risk SHALL be represented separately from the final verdict.

Initial risk levels:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Risk analysis SHOULD consider:

```text
change size
change complexity
business criticality
security sensitivity
data sensitivity
dependency blast radius
existing test strength
historical QE knowledge
public API changes
database changes
concurrency
authentication / authorization
financial calculations
external integrations
```

The LLM MAY reason about these factors.

The output SHALL be structured.

Example:

```json
{
  "level": "HIGH",
  "factors": [
    {
      "factor": "authorization",
      "reason": "Shared authorization middleware changed.",
      "weight": "high"
    }
  ],
  "confidence": 0.91
}
```

The MVP SHALL NOT require a mathematically sophisticated risk algorithm.

Explainability is more important than artificial numerical precision.

---

# 12. Requirement Model

Directly supplied requirements SHALL be normalized.

```typescript
interface Requirement {
  id: string;
  description: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  priority?: "low" | "medium" | "high" | "critical";
}
```

Acceptance criteria SHALL be mapped to evidence.

```typescript
interface RequirementAssessment {
  requirementId: string;

  status:
    | "VERIFIED"
    | "PARTIALLY_VERIFIED"
    | "NOT_VERIFIED"
    | "BLOCKED"
    | "NOT_APPLICABLE";

  evidenceIds: string[];
  explanation: string;
}
```

---

# 13. Validation Plan

Before execution, the QE Agent SHALL construct a structured validation plan.

Example:

```typescript
interface ValidationPlan {
  objectives: ValidationObjective[];
  plannedActions: ValidationAction[];
  identifiedRisks: string[];
  expectedCapabilities: string[];
}
```

A validation action SHALL include:

```typescript
interface ValidationAction {
  id: string;

  type:
    | "BUILD"
    | "TEST"
    | "LINT"
    | "TYPECHECK"
    | "STATIC_ANALYSIS"
    | "BROWSER"
    | "API"
    | "SOURCE_INSPECTION"
    | "GENERATE_TEST"
    | "CUSTOM";

  purpose: string;
  riskAddressed?: string[];
  requirementIds?: string[];

  command?: CommandProposal;

  priority: number;
  estimatedCost?: ExecutionEstimate;
}
```

The validation plan MAY evolve during execution.

Any significant deviation SHOULD be recorded.

---

# 14. Capability Registry

The system SHALL maintain a runtime capability registry.

Example:

```typescript
interface Capability {
  id: string;
  type: string;
  provider: string;
  available: boolean;
  confidence: number;
  metadata?: Record<string, unknown>;
}
```

Example capabilities:

```text
node.npm
node.vitest
node.jest
python.pytest
dotnet.test
browser.playwright
docker
git
generic.shell
```

Adapters SHALL register capabilities after discovery.

The reasoning engine asks:

> What capabilities are available?

rather than:

> Is this a Node project?

This distinction is important for future extensibility.

---

# 15. Adapter Contract

All ecosystem-specific behavior SHOULD implement a common adapter interface.

Conceptually:

```typescript
interface QEAdapter {
  id: string;

  detect(context: RepositoryContext): Promise<DetectionResult>;

  capabilities(
    context: RepositoryContext
  ): Promise<Capability[]>;

  proposeActions?(
    context: QEContext
  ): Promise<ValidationAction[]>;

  parseResult?(
    execution: ExecutionResult
  ): Promise<Evidence[]>;
}
```

Adapters SHOULD remain relatively small.

They SHALL NOT own the QE verdict.

---

# 16. Initial Adapters

The MVP SHOULD provide enhanced adapters for:

## Generic

```text
Git
Shell
Docker
```

## JavaScript / TypeScript

Recognize common:

```text
npm
yarn
pnpm
bun

Jest
Vitest
Mocha
Playwright

React
Next.js
Express
Node.js
```

## Python

Recognize common:

```text
pip
poetry
uv

pytest
unittest

Django
Flask
FastAPI
```

## .NET

Recognize common:

```text
dotnet
MSBuild

xUnit
NUnit
MSTest

ASP.NET Core
```

## Browser

```text
Playwright
```

Support for these ecosystems SHALL NOT prevent generic operation against other repositories.

---

# 17. Execution Controller

All external command execution SHALL flow through one controlled execution interface.

The reasoning engine SHALL NOT invoke shell commands directly.

Conceptual interface:

```typescript
interface ExecutionController {
  execute(
    proposal: CommandProposal,
    context: ExecutionContext
  ): Promise<ExecutionResult>;
}
```

A command proposal SHALL be structured.

```typescript
interface CommandProposal {
  executable: string;
  args: string[];
  workingDirectory: string;
  environment?: Record<string, string>;
  timeoutMs: number;
  purpose: string;
  mutability: "READ_ONLY" | "TEST_ARTIFACTS" | "REPOSITORY_WRITE";
  network: "NONE" | "RESTRICTED" | "ALLOWED";
}
```

Avoid accepting opaque shell strings wherever practical.

---

# 18. Command Safety

The Execution Controller SHALL enforce safety rules independently of the LLM.

Initial protections SHOULD include:

- working-directory confinement;
- command timeout;
- process-tree termination;
- output-size limits;
- environment-variable filtering;
- secret redaction;
- prohibited path access;
- destructive-command detection;
- network policy where supported.

Commands such as destructive filesystem operations SHALL NOT execute merely because the LLM requested them.

---

# 19. Execution Modes

The MVP SHALL support:

## Local

Commands execute directly against the local development environment.

Useful for trusted repositories and fast iteration.

## Docker

Commands execute in an isolated container where practical.

Docker SHOULD be preferred for unfamiliar repositories.

## GitHub Actions

Commands execute inside the GitHub Actions runner.

Execution behavior SHALL still pass through the Execution Controller abstraction.

Future:

```text
remote sandbox
ephemeral VM
Kubernetes
hosted QE runner
```

These SHALL NOT be required for MVP.

---

# 20. Test Generation

The QE Agent MAY modify test code.

It SHALL NOT modify production/application source code.

Generated tests SHOULD target:

- changed behavior;
- acceptance criteria;
- regression risks;
- negative scenarios;
- boundary conditions;
- previously demonstrated defects.

Before writing a test, the agent SHOULD inspect existing tests for:

```text
directory conventions
naming conventions
fixture patterns
mocking patterns
test framework
assertion style
setup/teardown
helper utilities
```

---

# 21. Test Change Classification

Every generated test SHALL be classified as:

```text
PERMANENT_REGRESSION
CANDIDATE
INVESTIGATIVE
```

`PERMANENT_REGRESSION` tests SHOULD normally remain in the working tree for commit.

`INVESTIGATIVE` tests SHOULD normally be removed before completion.

The Evidence Store SHALL retain information about what the investigative test demonstrated even after its source file is removed.

---

# 22. Source Code Write Boundary

The repository write controller SHALL distinguish:

```text
application source
test source
QE metadata
temporary artifacts
```

The QE Agent SHALL have permission to write:

```text
test source
QE metadata
temporary artifacts
```

The QE Agent SHALL NOT write application source.

If classification is uncertain, the write SHALL be denied or require explicit approval.

This rule SHALL be enforced by software rather than prompt instructions alone.

---

# 23. Browser Testing

Playwright SHALL provide the initial browser-testing capability.

Browser validation MAY include:

```text
page loading
navigation
form submission
workflow completion
negative workflows
visible errors
browser console errors
uncaught exceptions
failed network requests
basic accessibility signals
screenshots
execution traces
```

Browser testing SHALL only be planned when:

1. the repository contains a browser application;
2. the application can reasonably be started;
3. the required environment is available.

Failure to provide browser capability SHALL reduce confidence when browser behavior is material.

It SHALL NOT automatically fail non-browser projects.

---

# 24. Application Startup Discovery

The agent SHOULD discover how to start applications from:

```text
README instructions
package scripts
Makefile
Docker Compose
CI workflows
framework conventions
existing browser test configuration
```

Startup SHALL be modeled explicitly.

Example:

```typescript
interface ServiceDefinition {
  id: string;
  command: CommandProposal;
  healthCheck?: HealthCheck;
  dependencies?: string[];
}
```

The Execution Controller SHALL manage lifecycle and cleanup.

---

# 25. Evidence Model

Evidence SHALL be immutable once recorded.

Conceptual model:

```typescript
interface Evidence {
  id: string;

  type: EvidenceType;

  timestamp: string;

  source: string;

  status:
    | "PASS"
    | "FAIL"
    | "OBSERVED"
    | "INCONCLUSIVE";

  summary: string;

  details?: unknown;

  artifacts?: ArtifactReference[];

  relatedRequirementIds?: string[];
  relatedFindingIds?: string[];
}
```

Every test execution SHALL generate evidence.

---

# 26. Evidence Provenance

Evidence SHALL record enough information to determine how it was obtained.

Examples:

```text
command executed
working directory
revision
exit code
duration
test counts
environment
adapter
artifact locations
```

AI-generated analysis SHALL be clearly distinguishable from deterministic execution evidence.

---

# 27. Finding Model

A finding SHALL be a structured object.

```typescript
interface Finding {
  id: string;

  category:
    | "DEFECT"
    | "REGRESSION"
    | "TEST_GAP"
    | "QUALITY_RISK"
    | "SECURITY_CONCERN"
    | "PERFORMANCE_CONCERN"
    | "ACCESSIBILITY_CONCERN"
    | "FLAKY_TEST"
    | "TEST_DEFECT"
    | "ENVIRONMENT_ISSUE"
    | "MAINTAINABILITY_CONCERN";

  severity:
    | "BLOCKER"
    | "CRITICAL"
    | "HIGH"
    | "MEDIUM"
    | "LOW"
    | "INFORMATIONAL";

  confidence: number;

  title: string;
  description: string;

  evidenceIds: string[];

  affectedFiles?: string[];

  reproduction?: ReproductionInstructions;

  proposedRemediation?: string;
}
```

Severity and confidence SHALL remain separate concepts.

---

# 28. Failure Investigation Loop

A failed command SHALL NOT automatically become a product defect.

For material failures, the orchestrator SHOULD execute:

```text
Failure
   |
   v
Classify
   |
   +-- Product defect?
   +-- Regression?
   +-- Test defect?
   +-- Environment problem?
   +-- Flaky?
   +-- Unknown?
   |
   v
Attempt Reproduction
   |
   v
Compare Baseline When Appropriate
   |
   v
Collect Evidence
   |
   v
Create / Update Finding
```

The agent SHOULD avoid excessive retries.

Retry count SHALL be constrained by the execution budget.

---

# 29. Baseline Comparison

For change-based QE, the system SHOULD be capable of determining whether important failures reproduce against the baseline branch.

Conceptually:

```text
Failure on target
       |
       v
Material to verdict?
       |
      yes
       |
       v
Safe/feasible baseline comparison?
       |
      yes
       |
       v
Execute equivalent validation against baseline
```

Results SHOULD classify the failure as:

```text
INTRODUCED
PRE_EXISTING
ENVIRONMENT_SPECIFIC
FLAKY
UNKNOWN
```

---

# 30. QE Project Memory

Persistent QE knowledge SHALL live under:

```text
.qe/
```

Recommended initial structure:

```text
.qe/
├── config.yml
├── PROJECT.md
├── TESTING.md
├── RISKS.md
├── knowledge/
│   └── *.md
├── history/
│   └── summaries/
└── .gitignore
```

---

# 31. PROJECT.md

`PROJECT.md` SHOULD contain distilled project information useful to future QE runs.

Examples:

```text
major applications
architectural boundaries
important workflows
external dependencies
test environment assumptions
critical business behavior
```

It SHALL NOT become a dump of repository contents.

---

# 32. TESTING.md

`TESTING.md` SHOULD contain durable QE knowledge such as:

```text
how tests are organized
known test commands
required dependencies
browser startup procedure
useful fixtures
known test limitations
```

---

# 33. RISKS.md

`RISKS.md` SHOULD record durable project quality risks.

Example:

```markdown
## Authorization

Shared authorization middleware protects all administrative APIs.

Changes under `src/auth/` should be considered high-risk and should
include negative authorization testing.
```

Risk entries SHOULD remain understandable to humans.

---

# 34. Knowledge Files

The agent MAY maintain focused files such as:

```text
.qe/knowledge/authentication.md
.qe/knowledge/payments.md
.qe/knowledge/api-contracts.md
```

Knowledge SHALL be:

- concise;
- durable;
- project specific;
- evidence based where possible;
- human readable.

Raw LLM conversation SHALL NOT be stored as project memory.

---

# 35. Execution History

Historical summaries MAY be retained.

The repository SHOULD NOT accumulate every raw QE artifact indefinitely.

Committed history SHOULD contain only durable information.

Large or temporary artifacts SHALL be ignored.

Example `.gitignore`:

```text
runs/
cache/
artifacts/
screenshots/tmp/
traces/
```

---

# 36. Memory Update Process

At the end of a QE engagement, the agent SHOULD ask:

> Did this execution teach us something that would materially improve future QE?

If yes, it MAY propose updates to `.qe/`.

Examples:

```text
new startup requirement
new persistent risk
confirmed flaky test
important architectural dependency
valuable regression scenario
```

Memory updates SHALL be visible in the repository diff.

---

# 37. LLM Gateway

The model abstraction SHALL provide structured model execution.

Conceptual interface:

```typescript
interface ModelGateway {
  reason<T>(
    task: ReasoningTask<T>
  ): Promise<ModelResult<T>>;
}
```

The caller SHALL supply a schema for expected structured output.

Model responses used for orchestration SHOULD be validated before use.

Invalid structured responses MAY be retried within budget.

---

# 38. Model Roles

The MVP SHOULD support logical model roles even if they initially use the same underlying model.

MVP Agent Architecture: The MVP SHALL use a single QE Orchestrator with bounded, role-specific reasoning calls through the Model Gateway. It SHALL NOT implement autonomous peer-to-peer or hierarchical multi-agent orchestration. Specialized agents MAY be introduced after MVP only when evaluation results demonstrate a material improvement in QE effectiveness sufficient to justify the additional complexity.

Suggested roles:

```text
repository_analyst
risk_analyst
test_strategist
failure_investigator
gap_analyst
verdict_reviewer
```

This DOES NOT mean six persistent agents are required.

These are reasoning responsibilities.

A single model provider can perform them through separate bounded calls.

---

# 39. Context Construction

The agent SHALL NOT blindly send the entire repository to the model.

A Context Builder SHALL select relevant information.

Potential inputs include:

```text
requirements
repository profile
project QE memory
diff
changed files
dependency context
related tests
execution results
relevant documentation
previous findings
```

Context selection SHALL become a first-class component.

---

# 40. Prompt Architecture

Prompts SHOULD be versioned in source control.

Suggested structure:

```text
src/prompts/
    repository-analysis/
    risk-analysis/
    validation-plan/
    test-generation/
    failure-analysis/
    gap-analysis/
    verdict/
```

Each prompt SHOULD define:

```text
role
objective
available evidence
constraints
required output schema
prohibited assumptions
```

Prompt versions SHOULD be included in execution metadata.

---

# 41. Agent Trust Rules

Every reasoning prompt SHOULD reinforce the following principles:

```text
Do not assume implementation correctness.

Do not claim execution that did not occur.

Separate evidence from inference.

Passing existing tests is not proof of correctness.

Attempt to falsify important behavior.

Report meaningful uncertainty.

Do not modify production code to make tests pass.
```

These rules SHOULD additionally be enforced architecturally wherever possible.

---

# 42. Verdict Engine

Supported verdicts:

```text
PASS
PASS_WITH_CONCERNS
NEEDS_REVIEW
FAIL
BLOCKED
```

The LLM MAY recommend a verdict.

The final verdict SHALL be produced by a dedicated Verdict Engine using:

```text
requirements status
findings
severity
confidence
execution failures
validation completeness
remaining gaps
risk
```

The MVP MAY use a combination of deterministic rules and model reasoning.

---

# 43. Initial Verdict Guardrails

The following rules SHOULD apply:

### FAIL

A demonstrated material defect, regression, or violated high-priority requirement exists.

### BLOCKED

Required validation could not be performed and insufficient evidence exists for a defensible assessment.

### NEEDS_REVIEW

Evidence is conflicting or material uncertainty requires human judgment.

### PASS WITH CONCERNS

No blocking defect was demonstrated, but meaningful residual risk exists.

### PASS

No material defect was identified and validation provides strong evidence for expected behavior.

A successful test command alone SHALL NOT automatically produce PASS.

---

# 44. Confidence

The QE report SHOULD include overall confidence:

```text
LOW
MEDIUM
HIGH
```

Optionally backed internally by a numeric value.

Confidence SHOULD consider:

```text
requirements coverage
test execution breadth
risk coverage
environment fidelity
unverified behavior
quality of reproduction evidence
```

---

# 45. Execution Profiles

The MVP SHALL support:

## Quick

Target: approximately 5 minutes.

Prioritize:

```text
change analysis
existing focused tests
build/typecheck where inexpensive
highest-risk validation
```

## Standard

Target: approximately 15–20 minutes.

Default for pull requests.

Includes:

```text
focused tests
broader relevant regression
targeted generated tests
failure investigation
browser validation when relevant
gap analysis
```

## Deep

Target: approximately 30–60+ minutes.

Includes broader:

```text
regression
browser workflows
negative testing
boundary testing
baseline comparison
investigation
```

Time limits SHALL be configurable.

---

# 46. Budget Manager

The orchestrator SHALL use a Budget Manager.

Conceptually:

```typescript
interface ExecutionBudget {
  maxDurationMs: number;
  maxModelCalls?: number;
  maxRetries?: number;
  maxGeneratedTests?: number;
}
```

The system SHOULD track estimated remaining budget.

High-value validation SHALL be prioritized over low-value exhaustive execution.

---

# 47. CLI

The MVP CLI SHOULD expose:

```text
qe init
qe analyze
qe test
qe verify
qe review
```

Recommended semantics:

## `qe init`

Initialize `.qe/`.

## `qe analyze`

Analyze repository structure and QE capabilities.

## `qe test`

Execute repository quality validation without requiring a Git comparison.

## `qe verify`

Validate supplied requirements against the current repository.

## `qe review`

Evaluate changes against a baseline revision.

Example:

```text
qe review --base main --profile standard
```

---

# 48. CLI Requirements Input

For MVP, requirements MAY be supplied through:

```text
--requirements requirements.md
```

or:

```text
--requirement "Users without admin rights cannot delete users."
```

The CLI SHOULD support both.

Example:

```text
qe verify \
  --requirements ./feature.md \
  --profile standard
```

---

# 49. Output Formats

CLI output SHALL support:

```text
human-readable terminal
JSON
Markdown
```

JUnit XML and SARIF MAY be added when useful.

Machine-readable output SHALL be based on the same canonical `QEResult` model.

---

# 50. Canonical QE Result

Conceptual structure:

```typescript
interface QEResult {
  executionId: string;

  repository: RepositoryIdentity;

  baseline?: string;
  target: string;

  profile: string;

  repositoryProfile: RepositoryProfile;

  changeAnalysis?: ChangeAnalysis;

  riskAssessment: RiskAssessment;

  validationPlan: ValidationPlan;

  evidence: Evidence[];

  findings: Finding[];

  requirements: RequirementAssessment[];

  remainingGaps: QualityGap[];

  verdict:
    | "PASS"
    | "PASS_WITH_CONCERNS"
    | "NEEDS_REVIEW"
    | "FAIL"
    | "BLOCKED";

  confidence:
    | "LOW"
    | "MEDIUM"
    | "HIGH";

  summary: string;

  recommendedNextActions: string[];

  metrics: ExecutionMetrics;
}
```

This SHALL be the canonical contract used by CLI and CI integrations.

---

# 51. Human QE Report

Human output SHOULD emphasize decisions rather than raw logs.

Recommended report structure:

```text
QE VERDICT

Change Summary

Risk Assessment

Requirements Validation

Validation Performed

Defects / Findings

Test Changes

Remaining Gaps

Confidence

Recommended Next Actions
```

Detailed raw evidence SHOULD remain available separately.

---

# 52. GitHub Actions Integration

GitHub Actions SHALL invoke the CLI rather than implementing a separate QE engine.

Conceptually:

```text
Checkout
   |
Install QE
   |
qe review --base <base-sha>
   |
Generate JSON + Markdown
   |
Publish GitHub Check
```

The GitHub integration SHALL interpret the canonical result.

---

# 53. GitHub Check

The check SHOULD display:

```text
QE verdict
risk level
confidence
requirements status
important findings
validation summary
remaining gaps
```

If repository configuration enables blocking:

```text
FAIL -> failed check
```

Other verdict behavior SHOULD initially remain configurable and conservative.

---

# 54. GitHub Issue Creation

Confirmed findings MAY produce GitHub issues.

Issue creation SHALL be configurable.

Suggested threshold:

```text
category = DEFECT or REGRESSION
AND
severity >= configured threshold
AND
confidence >= configured threshold
```

Before issue creation, the integration SHOULD attempt lightweight duplicate detection.

Issue creation SHALL NOT occur merely for every failed test.

---

# 55. Proposed `.qe/config.yml`

Initial configuration SHOULD remain intentionally small.

Example:

```yaml
version: 1

profile: standard

execution:
  mode: auto
  maxMinutes: 20

tests:
  generation: true
  commitPermanentTests: true

browser:
  enabled: auto

github:
  blockOnFail: true
  createIssues: true

memory:
  enabled: true

model:
  provider: default
```

Additional configuration SHALL be added only when demonstrated by real use cases.

---

# 56. `execution.mode`

Recommended values:

```text
auto
local
docker
```

`auto` SHOULD:

1. inspect repository configuration;
2. prefer an appropriate existing container setup where safe;
3. otherwise use configured/default execution;
4. clearly report the selected environment.

---

# 57. Secrets

Secrets SHALL be injected by the execution environment.

The model SHOULD receive references to available capabilities rather than raw secret values.

For example:

```text
TEST_DATABASE_URL is available
```

rather than:

```text
TEST_DATABASE_URL=postgres://username:password@...
```

Output SHALL be passed through secret-redaction filters before persistence or model analysis where practical.

---

# 58. Observability

Every QE run SHALL have an execution ID.

Structured telemetry SHOULD capture:

```text
start/end
state transitions
model calls
model provider
model identifier
token usage when available
command executions
command duration
test duration
browser duration
retry count
generated tests
findings
verdict
```

This information is important both for debugging and eventual commercial cost analysis.

---

# 59. Logging

Logging levels SHOULD include:

```text
ERROR
WARN
INFO
DEBUG
TRACE
```

Normal users SHOULD see concise progress.

Debug mode SHOULD expose detailed orchestration behavior without exposing secrets.

---

# 60. Deterministic Testing of the QE Agent

The QE Agent itself SHALL have extensive automated tests.

Important components SHOULD be testable without an LLM.

Examples:

```text
repository detection
adapter selection
command policy
write boundaries
evidence recording
finding normalization
verdict rules
configuration
budget enforcement
Git parsing
```

LLM behavior SHOULD be tested through fixtures and recorded/mocked structured responses where practical.

---

# 61. Evaluation Repositories

The project SHOULD maintain small fixture repositories representing different ecosystems.

Example:

```text
fixtures/
    node-good/
    node-regression/
    python-good/
    python-regression/
    dotnet-good/
    dotnet-regression/
    browser-good/
    browser-regression/
```

Each fixture SHOULD contain known defects or test gaps.

These repositories become an evaluation suite for the QE Agent itself.

---

# 62. QE Agent Evaluation Harness

A dedicated evaluation harness SHOULD measure whether the agent:

```text
detected the intended defect
avoided false positives
selected useful tests
generated valid tests
correctly classified risk
correctly classified verdict
identified important gaps
stayed within budget
```

This is strategically important.

The product cannot improve reliably if QE quality is evaluated only through anecdotes.

---

# 63. Initial Evaluation Metrics

Track:

```text
true defect detection
false positive rate
false negative rate
correct verdict
test generation success
generated test usefulness
execution success
average duration
model usage
average cost when available
```

Do NOT optimize primarily for number of generated tests.

---

# 64. Suggested Repository Structure

```text
qe-agent/
├── src/
│   ├── cli/
│   ├── core/
│   │   ├── orchestrator/
│   │   ├── lifecycle/
│   │   ├── risk/
│   │   ├── planning/
│   │   ├── findings/
│   │   └── verdict/
│   ├── repository/
│   ├── context/
│   ├── adapters/
│   │   ├── generic/
│   │   ├── javascript/
│   │   ├── python/
│   │   ├── dotnet/
│   │   └── browser/
│   ├── execution/
│   │   ├── local/
│   │   └── docker/
│   ├── evidence/
│   ├── memory/
│   ├── models/
│   │   ├── gateway/
│   │   └── providers/
│   ├── prompts/
│   ├── reporting/
│   ├── github/
│   ├── config/
│   └── security/
├── schemas/
├── tests/
├── fixtures/
├── docs/
└── .github/
```

Module boundaries SHOULD matter more than this exact directory structure.

---

# 65. MVP Milestones

## Milestone 0 — Foundation

Deliver:

- TypeScript project;
- CLI shell;
- configuration loader;
- domain models;
- structured logging;
- execution IDs;
- model gateway interface;
- test harness.

No autonomous QE required yet.

### Acceptance Criteria

```text
qe --help works.

qe init creates valid project configuration.

Core domain schemas validate correctly.

Model providers can be substituted behind the gateway.
```

---

## Milestone 1 — Repository Intelligence

Deliver:

- repository discovery;
- Git inspection;
- instruction discovery;
- language/framework detection;
- build/test discovery;
- capability registry;
- `qe analyze`.

### Acceptance Criteria

Against fixture repositories, the system correctly identifies:

```text
ecosystem
test framework
build commands
test commands
browser capability where applicable
```

Unknown repositories produce useful generic analysis rather than failing.

---

## Milestone 2 — Safe Execution & Evidence

Deliver:

- Execution Controller;
- local executor;
- Docker executor;
- command safety;
- timeout handling;
- evidence store;
- test-result capture;
- secret redaction.

### Acceptance Criteria

The system can execute discovered tests and produce structured evidence.

Dangerous commands are rejected.

Timeouts terminate process trees.

Secrets do not appear in normal persisted reports.

---

## Milestone 3 — QE Reasoning

Deliver:

- change analysis;
- risk assessment;
- validation planning;
- model prompts;
- structured model output validation;
- gap analysis;
- verdict engine.

### Acceptance Criteria

Given a repository, requirements, and change, the agent produces:

```text
risk assessment
validation plan
executed evidence
remaining gaps
verdict
confidence
```

The verdict references evidence.

---

## Milestone 4 — Test Generation

Deliver:

- test-context discovery;
- targeted test generation;
- write-boundary enforcement;
- investigative tests;
- permanent regression tests;
- retesting.

### Acceptance Criteria

The agent can discover an untested defect in fixture repositories, generate a test that demonstrates the defect, and preserve that evidence without modifying production code.

---

## Milestone 5 — Browser QE

Deliver:

- Playwright adapter;
- application startup management;
- browser observations;
- screenshots;
- traces;
- console/network-error evidence.

### Acceptance Criteria

The agent can validate a browser-based fixture application and identify at least one intentionally seeded browser-level regression.

---

## Milestone 6 — Project Memory

Deliver:

- `.qe/` knowledge;
- memory reader;
- memory distillation;
- proposed memory updates;
- historical summaries.

### Acceptance Criteria

Knowledge learned during one run can materially influence a later run without depending on previous LLM conversation state.

---

## Milestone 7 — GitHub Integration

Deliver:

- GitHub Action;
- PR diff invocation;
- check reporting;
- optional PR blocking;
- optional issue creation.

### Acceptance Criteria

A fixture repository PR containing a known regression causes the QE Agent to:

```text
analyze the change
demonstrate the regression
produce evidence
return FAIL
cause the configured GitHub check to fail
```

---

# 66. MVP Definition of Done

The MVP is complete when the following scenario works reliably:

A developer provides:

```text
source repository
+
feature requirements
+
proposed change
```

The QE Agent independently:

1. discovers the repository;
2. understands available quality tooling;
3. analyzes the change;
4. identifies important risks;
5. constructs a validation strategy;
6. executes appropriate existing tests;
7. creates targeted additional tests when justified;
8. performs browser validation when relevant;
9. investigates material failures;
10. compares against baseline when useful;
11. records evidence;
12. identifies unverified behavior;
13. produces findings;
14. produces a QE verdict;
15. explains its confidence;
16. proposes application fixes without implementing them;
17. leaves useful permanent regression tests in the repository;
18. updates durable project QE knowledge where appropriate;
19. performs the same workflow locally and through GitHub Actions.

---

# 67. Explicit MVP Non-Goals

Do NOT build during MVP unless required to satisfy a preceding requirement:

```text
hosted SaaS platform
web management UI
billing
multi-tenancy
enterprise administration
Jira integration
Linear integration
GitLab integration
Azure DevOps integration
Jenkins integration
Kubernetes execution
proprietary cloud sandbox
production monitoring
mobile device farms
full penetration testing
advanced performance infrastructure
automatic production-code repair
large multi-agent hierarchy
```

Avoid building infrastructure for hypothetical future requirements.

---

# 68. Architectural Decision Records

Important technical decisions SHALL be recorded as ADRs.

Initial ADRs SHOULD include:

```text
ADR-001  TypeScript as reference implementation language
ADR-002  Adapter-based capability architecture
ADR-003  Model-provider abstraction
ADR-004  Evidence-first QE model
ADR-005  QE may modify tests but not production code
ADR-006  Repository-local persistent QE knowledge
ADR-007  Local/Docker execution strategy
ADR-008  Playwright as initial browser adapter
ADR-009  Canonical QEResult contract
ADR-010  State-machine orchestration
```

This will help prevent future coding agents from casually undoing foundational architecture.

---

# 69. Implementation Agent Rules

Any AI agent implementing this specification SHALL follow these rules:

1. Build only the current milestone unless explicitly instructed otherwise.
2. Do not introduce SaaS infrastructure during MVP.
3. Do not couple the QE core to GitHub.
4. Do not couple the QE core to a specific LLM provider.
5. Do not place ecosystem-specific behavior in the orchestrator.
6. Do not permit LLM-generated commands to bypass the Execution Controller.
7. Do not permit the QE Agent to modify production source.
8. Treat execution evidence as more authoritative than model inference.
9. Validate structured LLM output.
10. Keep public interfaces small.
11. Prefer simple filesystem persistence during MVP.
12. Write automated tests for deterministic behavior.
13. Add fixture repositories for important QE behaviors.
14. Record significant architecture changes as ADRs.
15. Do not implement speculative abstraction without a demonstrated requirement.

---

# 70. First Implementation Assignment

The first coding-agent assignment SHOULD be limited to **Milestone 0 and Milestone 1**.

The implementation agent SHALL:

1. initialize the TypeScript project;
2. establish domain models;
3. implement `.qe/config.yml`;
4. implement `qe init`;
5. implement repository discovery;
6. implement Git repository inspection;
7. implement project-instruction discovery;
8. implement deterministic ecosystem detection;
9. implement build/test command discovery;
10. implement the capability registry;
11. implement `qe analyze`;
12. add fixture repositories;
13. add unit/integration tests;
14. create the initial ADRs;
15. document how to run and test the project.

The implementation agent SHALL NOT yet implement:

```text
autonomous test execution
test generation
browser execution
GitHub Actions
GitHub issue creation
complex agent loops
production-code modification
hosted infrastructure
```

---

# 71. Milestone 1 Demonstration

At the completion of Milestone 1, the following should work:

```text
$ cd some-project
$ qe analyze
```

Example conceptual output:

```text
QE Repository Analysis

Project
-------
Type: Web Application

Detected Ecosystems
-------------------
TypeScript / Node.js
React

Package Manager
---------------
pnpm

Build
-----
pnpm build

Tests
-----
Vitest
Command: pnpm test

Browser Testing
---------------
Playwright detected

CI
--
GitHub Actions

Applications
------------
Frontend application
Port configuration discovered from project scripts

Project Instructions
--------------------
README.md
AGENTS.md

QE Capabilities
---------------
✓ Git analysis
✓ Build
✓ Unit testing
✓ Browser testing
✓ Generic command execution

QE Configuration
----------------
.qe/config.yml detected

Analysis Confidence
-------------------
HIGH
```

For an unfamiliar ecosystem, output might instead be:

```text
Detected Ecosystem
------------------
Unknown / Custom

Discovered Build Instructions
-----------------------------
README.md describes:
./tools/build-project

Discovered Test Instructions
----------------------------
CI configuration executes:
./tools/run-tests

QE Capabilities
---------------
✓ Git analysis
✓ Generic build execution
✓ Generic test execution
? Structured test-result parsing unavailable

Analysis Confidence
-------------------
MEDIUM
```

That second result is intentional.

The QE Agent's objective is not:

> "Do I recognize this framework?"

It is:

> "Can I determine how this software is built, exercised, and evaluated?"

---

# 72. Central Technical Thesis

The architecture should optimize around the following distinction:

> **The LLM is the QE reasoning engine, not the operating system.**

The model determines what should be investigated.

Adapters describe what capabilities exist.

The Execution Controller performs actions safely.

The Evidence Store records what actually happened.

The Verdict Engine determines what the available evidence supports.

Project memory preserves useful QE knowledge.

The CLI, GitHub Actions, and future integrations are simply different ways of invoking that same system.

This separation is the foundation that allows the QE Agent to evolve from an internal developer tool into a commercially viable autonomous Quality Engineering platform without requiring the MVP to be designed like a SaaS product.