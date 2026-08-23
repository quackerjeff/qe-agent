# Automated QE Agent
## Product and Functional Requirements

**Document Status:** Initial Product Definition  
**Working Name:** QE Agent  
**Primary Audience:** Product owner, engineering leadership, AI development agents, implementation team  
**Primary Objective:** Define an autonomous, reusable Quality Engineering agent that can analyze, test, and assess software projects across languages, frameworks, and development workflows.

---

# 1. Executive Summary

The QE Agent is an autonomous software quality engineering system designed to participate in virtually any software development project, regardless of whether the project itself was developed manually, with AI assistance, or through a mixture of both.

The QE Agent's purpose is broader than automated test generation.

It acts as an independent quality engineer that:

- understands the application and its architecture;
- understands what changed;
- identifies quality and regression risks;
- determines an appropriate validation strategy;
- discovers and executes existing quality tooling;
- creates additional tests when justified;
- exercises the software where feasible;
- analyzes failures and potential defects;
- identifies test gaps;
- detects likely regressions;
- produces evidence supporting its conclusions; and
- provides a clear quality assessment or release recommendation.

The product should operate both:

1. as an automated component of CI/CD workflows such as GitHub Actions; and
2. as a stand-alone application or CLI that developers and AI agents can invoke locally or programmatically.

The QE Agent should be designed as an extensible quality platform rather than attempting to implement native support for every language, framework, test system, and execution environment in its first release.

---

# 2. Product Vision

Create a persistent, highly capable virtual Quality Engineer that can be added to any engineering team or software repository and asked:

> "Determine whether this software works correctly, whether this change is safe, what we have failed to test, and what evidence supports your conclusion."

The QE Agent should behave more like an experienced QE engineer than a simple test runner or code-generation assistant.

Its fundamental workflow should be:

**Understand → Assess Risk → Plan → Execute → Investigate → Verify → Report**

---

# 3. Product Principles

## 3.1 Quality is more than test execution

Running an existing test suite is only one source of quality evidence. The agent must also consider architecture, changed behavior, test coverage, static analysis, build results, runtime behavior, APIs, contracts, edge cases, error handling, logs, and other relevant signals.

## 3.2 Risk determines effort

The agent should spend more effort validating high-risk changes than low-risk changes.

Examples of elevated risk include:

- authentication or authorization changes;
- financial calculations;
- data migrations;
- destructive operations;
- concurrency;
- public APIs;
- security-sensitive logic;
- large architectural changes;
- changes with large dependency blast radius;
- historically unstable code;
- code with little existing test coverage.

## 3.3 Evidence before conclusions

The agent must distinguish among:

- verified facts;
- test results;
- observations;
- inferred risks;
- suspected defects;
- unverified concerns.

It must never report an unexecuted test as successful.

## 3.4 Existing engineering conventions come first

The agent should discover and use the project's existing:

- build system;
- dependency manager;
- test framework;
- linting configuration;
- formatting rules;
- test organization;
- CI configuration;
- development documentation;
- architectural conventions.

It should avoid imposing a new framework simply because it is familiar with one.

## 3.5 Generated tests are product code

Tests created by the QE Agent must be maintainable, deterministic where practical, readable, and consistent with repository conventions.

## 3.6 The agent must be independently skeptical

The agent should not assume that an implementation is correct merely because:

- existing tests pass;
- another AI agent wrote the code;
- the developer says the feature is complete;
- the acceptance criteria appear to be implemented.

Its role is independent validation.

## 3.7 Safe execution is mandatory

Repositories contain executable code. The QE Agent must assume repository code may be unsafe and execute code only inside controlled environments with configurable permissions.

---

# 4. Target Users

Primary users include:

### Individual Developer

Wants an independent QE review before merging or releasing code.

### Engineering Team

Wants consistent quality gates applied automatically to pull requests.

### AI-Assisted Development Workflow

Wants an independent agent to validate code produced by coding agents.

### Technical Lead or CTO

Wants concise visibility into software quality, defects, risk, and release readiness.

### CI/CD System

Invokes the QE Agent non-interactively and uses its result as a quality gate.

### AI Orchestrator

Invokes the QE Agent as a specialist after an implementation agent completes work.

---

# 5. Primary Product Modes

The same QE engine should support multiple execution environments.

## 5.1 Local CLI Mode

Example conceptual invocation:

```text
qe analyze
qe test
qe review
qe verify --against main
qe verify --issue 123
qe release-check
```

The local mode should allow a developer or AI agent to request QE assessment from a working directory.

## 5.2 GitHub Pull Request Mode

The QE Agent should be invokable from GitHub Actions when:

- a pull request is created;
- commits are pushed to a pull request;
- a developer applies a label;
- a developer comments with an agent command;
- a branch is merged;
- a release is created.

The agent should inspect the diff, repository, test history where available, requirements, and CI evidence before producing a QE assessment.

## 5.3 Stand-Alone Agent/API Mode

The QE Agent should expose a programmatic interface so another AI orchestration system can request:

```text
Assess this implementation against these requirements.
```

or:

```text
Determine whether commit X introduces regressions relative to commit Y.
```

## 5.4 Interactive Investigation Mode

A developer should eventually be able to ask questions such as:

```text
Why did you mark this PR high risk?

What behavior isn't tested?

Test the authentication failure scenarios more thoroughly.

Is this failure caused by the PR or an existing defect?

What would you test manually before releasing this?
```

---

# 6. Core QE Workflow

Every QE engagement should conceptually execute the following lifecycle.

## Phase 1 — Repository Discovery

Understand:

- languages;
- frameworks;
- package managers;
- build systems;
- application topology;
- test frameworks;
- test locations;
- CI configuration;
- runtime dependencies;
- infrastructure requirements;
- coding conventions;
- available project documentation.

## Phase 2 — Change Understanding

When evaluating a change, determine:

- files changed;
- behaviors changed;
- components affected;
- APIs changed;
- database changes;
- dependency changes;
- security implications;
- likely downstream impact.

## Phase 3 — Risk Assessment

Assign a risk profile using factors such as:

```text
change complexity
+
business criticality
+
blast radius
+
test coverage
+
historical instability
+
security sensitivity
+
data sensitivity
+
execution uncertainty
```

The exact formula may evolve, but the reasoning must remain visible.

## Phase 4 — QE Plan

Before executing expensive actions, generate an internal or visible validation plan specifying:

- existing tests to execute;
- additional tests needed;
- static analysis;
- build validation;
- API validation;
- browser/UI validation;
- data validation;
- negative cases;
- boundary cases;
- integration checks;
- regression areas.

## Phase 5 — Validation Execution

Execute the feasible validation plan.

## Phase 6 — Failure Investigation

For every significant failure:

1. reproduce it where possible;
2. determine whether it existed before the current change;
3. inspect relevant implementation;
4. classify likely cause;
5. separate product defects from test/infrastructure failures.

## Phase 7 — Gap Analysis

Ask:

> What important behavior remains unverified?

## Phase 8 — Quality Assessment

Produce a result such as:

- PASS;
- PASS WITH CONCERNS;
- NEEDS REVIEW;
- FAIL;
- BLOCKED / INSUFFICIENT EVIDENCE.

The result must include supporting evidence.

---

# 7. Functional Requirements

## FR-001 Repository Detection

The system SHALL automatically inspect an unfamiliar repository and identify relevant languages, frameworks, package managers, build systems, test frameworks, and project structure.

The system SHALL support projects containing multiple languages or applications.

---

## FR-002 Project Instruction Discovery

The agent SHALL inspect available project guidance before modifying or executing the project.

Examples may include:

```text
README files
CONTRIBUTING files
AGENTS.md
CLAUDE.md
package metadata
build files
CI workflows
test configuration
repository-specific QE configuration
```

Repository instructions SHALL override generic agent conventions where appropriate.

---

## FR-003 Existing Test Discovery

The system SHALL locate existing:

- unit tests;
- integration tests;
- end-to-end tests;
- API tests;
- component tests;
- contract tests;
- performance tests;
- snapshot tests;
- browser tests.

The system SHALL determine how each test category is normally executed.

---

## FR-004 Existing Quality Tool Discovery

The system SHALL discover available:

- linters;
- formatters;
- static analyzers;
- type checkers;
- security scanners;
- code coverage tooling;
- accessibility tooling;
- dependency auditing tools.

The system SHOULD use repository-configured tools before introducing alternatives.

---

## FR-005 Change Analysis

For change-based execution, the system SHALL determine the difference between the target revision and its comparison baseline.

The system SHALL analyze semantic impact rather than relying solely on changed filenames.

---

## FR-006 Blast Radius Analysis

The system SHOULD identify code and behaviors potentially affected indirectly by the change.

Possible signals include:

- imports;
- dependency graphs;
- callers;
- public interfaces;
- shared libraries;
- database schemas;
- configuration;
- feature flags;
- message contracts;
- API consumers.

---

## FR-007 Risk Classification

The system SHALL classify the risk associated with the change.

At minimum:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

The report SHALL explain the primary factors that contributed to the classification.

---

## FR-008 Test Strategy Generation

The system SHALL create a QE strategy appropriate to the detected change and risk.

The strategy SHOULD identify:

- what requires validation;
- why it matters;
- how it will be validated;
- whether an existing test provides sufficient evidence;
- what cannot currently be validated.

---

## FR-009 Existing Test Execution

The system SHALL execute appropriate existing tests where execution is available.

The system SHOULD prefer focused tests initially and broaden execution according to:

- risk;
- results;
- project size;
- configured execution budget.

---

## FR-010 Test Generation

The system SHALL be capable of creating additional tests when existing coverage does not adequately validate changed or critical behavior.

Generated tests SHALL:

- follow repository conventions;
- target meaningful behavior;
- avoid trivial assertions;
- avoid excessive mocking where it invalidates the behavior being tested;
- minimize nondeterministic behavior;
- document unusual setup where needed.

---

## FR-011 Temporary Investigative Tests

The system SHOULD support temporary exploratory tests that are used for investigation but are not committed to the repository.

The report SHALL distinguish between:

- permanent regression tests;
- generated candidate tests;
- temporary investigative tests.

---

## FR-012 Negative Testing

The system SHOULD intentionally test invalid or failure conditions where relevant.

Examples include:

- invalid inputs;
- missing inputs;
- unauthorized access;
- malformed requests;
- timeout behavior;
- dependency failures;
- empty datasets;
- duplicate operations;
- unexpected state transitions.

---

## FR-013 Boundary Testing

The system SHOULD identify meaningful boundary conditions from the implementation and requirements.

Examples include:

```text
zero
one
maximum
minimum
empty
null
large values
date boundaries
pagination boundaries
numeric precision
encoding differences
```

---

## FR-014 Regression Analysis

The system SHALL assess whether a change could negatively affect existing behavior.

The system SHOULD execute targeted regression checks in areas affected by the change's dependency or behavior graph.

---

## FR-015 Defect Reproduction

When an apparent defect is identified, the system SHOULD attempt to create a deterministic reproduction.

A defect report SHOULD contain:

- behavior expected;
- behavior observed;
- reproduction steps;
- evidence;
- likely affected component;
- severity;
- confidence.

---

## FR-016 Baseline Comparison

When practical, the system SHOULD determine whether a failure is:

```text
introduced by the current change
existing in the comparison branch
environment-specific
intermittent
unknown
```

This capability is particularly important for pull request analysis.

---

## FR-017 Flaky Test Detection

The system SHOULD identify probable nondeterministic failures.

Potential methods include:

- controlled retry;
- comparison with historical CI data;
- timing analysis;
- inconsistent outcome detection.

A flaky test SHALL NOT silently be converted into a passing result.

---

## FR-018 Test Coverage Analysis

Where coverage tooling exists, the system SHOULD analyze coverage changes.

Coverage SHALL be treated as a signal rather than the definition of quality.

The agent SHOULD identify important untested behaviors even when numerical code coverage is high.

---

## FR-019 API Validation

For services exposing APIs, the system SHOULD be able to:

- discover API definitions;
- inspect OpenAPI or similar schemas;
- invoke endpoints;
- validate response structure;
- validate errors;
- exercise authentication behavior;
- detect contract regressions.

---

## FR-020 Browser/Application Validation

For browser applications, an adapter MAY provide:

- browser automation;
- interaction testing;
- visual inspection;
- console error detection;
- network failure detection;
- accessibility checks;
- screenshots or trace artifacts.

Browser automation SHOULD be an optional capability rather than a mandatory dependency of the core engine.

---

## FR-021 Database and Migration Validation

Where applicable, the system SHOULD inspect schema and migration changes for:

- reversibility;
- compatibility;
- data loss risk;
- constraint violations;
- application/schema sequencing risks.

Potentially destructive database tests MUST require an isolated environment.

---

## FR-022 Security-Oriented Quality Checks

The system SHOULD identify common security-sensitive changes and apply stronger validation.

Examples include:

- authentication;
- authorization;
- session management;
- secret handling;
- injection boundaries;
- input sanitization;
- cryptography;
- file handling;
- access control.

Deep security assessment is not a substitute for dedicated application security tooling.

---

## FR-023 Acceptance Criteria Validation

When product requirements, issue descriptions, user stories, or acceptance criteria are available, the system SHALL map validation evidence against those requirements.

Each acceptance criterion SHOULD receive one of:

```text
VERIFIED
PARTIALLY VERIFIED
NOT VERIFIED
NOT APPLICABLE
BLOCKED
```

---

## FR-024 Requirement-to-Test Traceability

The system SHOULD maintain traceability among:

```text
requirement
→ behavior
→ risk
→ validation method
→ evidence
→ outcome
```

---

## FR-025 Quality Findings

The system SHALL classify findings.

Suggested categories:

```text
DEFECT
REGRESSION
TEST GAP
QUALITY RISK
SECURITY CONCERN
PERFORMANCE CONCERN
ACCESSIBILITY CONCERN
FLAKY TEST
TEST DEFECT
ENVIRONMENT ISSUE
MAINTAINABILITY CONCERN
```

---

## FR-026 Finding Severity

Findings SHALL support severity classifications such as:

```text
BLOCKER
CRITICAL
HIGH
MEDIUM
LOW
INFORMATIONAL
```

Severity and confidence SHOULD be represented independently.

---

## FR-027 Confidence Reporting

Important conclusions SHOULD include confidence.

Example:

```text
High confidence: reproduced consistently and isolated to changed code.

Medium confidence: strong implementation evidence but runtime reproduction unavailable.

Low confidence: plausible risk requiring human investigation.
```

---

## FR-028 Quality Verdict

At the completion of an engagement, the system SHALL produce a QE verdict.

Recommended initial states:

### PASS

Strong evidence supports the expected behavior and no release-blocking defect was found.

### PASS WITH CONCERNS

Tests pass but material quality concerns remain.

### NEEDS REVIEW

Evidence indicates possible problems requiring human judgment.

### FAIL

A material defect or violated acceptance criterion has been demonstrated.

### BLOCKED

The agent could not obtain enough evidence to make a reliable determination.

---

## FR-029 GitHub Pull Request Integration

The system SHALL support pull-request-oriented execution.

It SHOULD be able to produce:

- check-run status;
- QE summary;
- annotations;
- findings;
- test evidence;
- risk score;
- final QE verdict.

The system SHOULD avoid flooding pull requests with repetitive comments.

---

## FR-030 GitHub Quality Gate

Projects SHALL be able to configure whether individual QE verdicts:

```text
allow merge
allow merge with warning
require human approval
block merge
```

---

## FR-031 Local CLI

The product SHALL provide a command-line interface independent of GitHub Actions.

The CLI SHOULD provide machine-readable and human-readable output.

Suggested output formats:

```text
terminal
Markdown
JSON
JUnit XML
SARIF
```

---

## FR-032 Programmatic Interface

The QE engine SHOULD expose an API or agent interface enabling external AI systems to initiate analysis and retrieve structured results.

---

## FR-033 Configuration

Repositories SHOULD optionally contain configuration such as:

```text
.qe/config.yml
```

Conceptual configuration may contain:

```yaml
risk:
  default: medium

execution:
  max_minutes: 20

tests:
  allow_generation: true
  allow_test_modification: true

quality_gate:
  fail_on:
    - blocker
    - critical
    - high

commands:
  unit: "..."
  integration: "..."
  build: "..."

ignore:
  paths:
    - generated/
```

Configuration format is illustrative and not yet normative.

---

## FR-034 Policy System

Organizations SHOULD eventually be able to define QE policies independently of repository configuration.

Examples:

```text
All authorization changes require negative tests.

Database migrations require compatibility analysis.

Critical projects require full regression execution before release.
```

---

## FR-035 Execution Budgets

The system SHALL support configurable budgets for:

- elapsed time;
- compute;
- AI tokens;
- monetary cost;
- retry count;
- test depth.

The agent SHOULD maximize confidence within the available budget.

---

## FR-035A Token and Cost Telemetry

The system SHALL expose first-class AI usage telemetry for QE runs that use the
Model Gateway.

Telemetry SHOULD include, where available:

- model call count;
- input/context tokens;
- output/completion tokens;
- cached tokens;
- maximum response token reservation;
- estimated token-per-minute demand;
- applicable model or account throughput limit when known;
- estimated cost.

The system SHOULD estimate token demand before making model calls. If the
estimated request demand exceeds the effective model or TPM limit, the agent
SHOULD reduce, chunk, or summarize context before dispatching the call.

The agent SHALL NOT rely on exponential backoff as the only response to an
intrinsically oversized request. Backoff is appropriate for temporary quota
exhaustion, but it does not make a single oversized request fit under a lower
throughput ceiling.

When a request still cannot fit after reasonable reduction, the system SHOULD
return a clear blocked or degraded result explaining that the context exceeds
available model throughput.

Human-readable and JSON output SHOULD explain the major token contributors
well enough for users to understand why a run consumed or attempted to consume
the reported number of tokens.

See `docs/features/token-cost-telemetry.md` for the feature addendum.

---

## FR-036 Artifact Collection

The system SHOULD retain useful evidence such as:

- logs;
- test reports;
- coverage reports;
- screenshots;
- traces;
- failing inputs;
- generated test diffs.

Artifact retention SHALL be configurable.

---

## FR-037 Structured QE Report

Every execution SHALL produce a structured result capable of being consumed by another system.

The report SHOULD contain:

```text
repository
revision
comparison revision
environment
change summary
risk assessment
validation plan
actions executed
test results
requirements validation
findings
remaining gaps
confidence
QE verdict
recommended next action
```

---

# 8. Agent Intelligence Requirements

The core differentiator of the product should be its reasoning layer.

The agent should answer five fundamental questions during every engagement.

## 8.1 What changed?

The system identifies relevant behavior introduced, removed, or modified.

## 8.2 What could break?

The system reasons about the direct and indirect consequences of that change.

## 8.3 How would an experienced QE engineer try to break it?

The system develops adversarial, boundary, negative, workflow, and regression scenarios.

## 8.4 What evidence do we actually have?

The system separates assumptions from executed validation.

## 8.5 What remains uncertain?

The system reports remaining risk rather than treating incomplete validation as success.

---

# 9. Proposed Architecture

The platform should initially be designed around the following conceptual components.

## QE Orchestrator

Owns the overall workflow:

```text
discover
→ understand
→ assess risk
→ plan
→ execute
→ analyze
→ report
```

## Repository Analyzer

Understands:

- project structure;
- languages;
- frameworks;
- dependencies;
- tests;
- CI systems;
- changed code.

## Capability Registry

Determines which QE capabilities are available for the current project.

Examples:

```text
node
python
dotnet
java
go
rust
browser
docker
database
mobile
security scanner
coverage
```

## Tool / Adapter Layer

Provides controlled access to:

- shell commands;
- test runners;
- browsers;
- APIs;
- containers;
- version control;
- GitHub;
- static analyzers.

## Test Strategy Engine

Converts requirements, repository understanding, changes, and risk into a validation plan.

## Test Generation Engine

Produces or modifies tests where justified.

## Execution Sandbox

Safely runs repository code.

## Evidence Store

Records every important validation action and result.

## Finding Engine

Normalizes detected issues.

## Reporting Engine

Produces both structured and human-readable results.

## Policy Engine

Determines organization-specific quality gates.

---

# 10. Adapter Architecture

Universal support should be achieved through adapters rather than a giant collection of hard-coded behavior.

Examples:

### Language Adapter

Understands common project and testing conventions for a language.

### Framework Adapter

Adds framework-specific knowledge.

### Test Runner Adapter

Executes and parses a specific test system.

### Runtime Adapter

Provides execution environments such as:

```text
local process
Docker
remote sandbox
Kubernetes
ephemeral VM
```

### CI Adapter

Examples:

```text
GitHub Actions
GitLab
Azure DevOps
CircleCI
Jenkins
```

### Interface Adapter

Examples:

```text
HTTP API
browser
CLI
database
message queue
mobile UI
```

Adapters should advertise capabilities rather than requiring the core agent to know every implementation.

---

# 11. AI Versus Deterministic Components

The system should intentionally separate probabilistic reasoning from deterministic execution.

## AI is appropriate for:

- repository comprehension;
- change interpretation;
- risk assessment;
- test scenario generation;
- requirements interpretation;
- failure analysis;
- gap analysis;
- prioritization;
- report explanation.

## Deterministic software is preferable for:

- Git operations;
- test execution;
- command execution;
- diff calculation;
- coverage parsing;
- test-result parsing;
- schema validation;
- policy enforcement;
- quality gate decisions where rules are explicit.

The AI should decide **what evidence is needed**.

Deterministic systems should collect and verify that evidence whenever possible.

---

# 12. Security Requirements

Because the QE Agent runs arbitrary repository code, security must be treated as a fundamental architectural requirement.

The execution environment SHOULD support:

- filesystem isolation;
- network restriction;
- secret isolation;
- resource limits;
- process limits;
- execution timeout;
- dependency controls;
- ephemeral environments.

Untrusted pull requests SHALL NOT automatically receive privileged production secrets.

Commands proposed by the AI SHOULD be subject to execution policy.

Potentially destructive commands SHOULD be blocked or require explicit permission.

---

# 13. Non-Goals for Initial Release

Version 1 should NOT attempt to:

- guarantee correctness of arbitrary software;
- replace specialized penetration testing;
- replace production monitoring;
- automatically understand every programming language;
- automatically test every physical device;
- provide perfect visual UX judgment;
- guarantee performance scalability without appropriate infrastructure;
- execute destructive tests against production systems;
- eliminate the need for human QE in every situation.

The system should instead provide excellent automated QE reasoning and evidence gathering within the environment and capabilities available to it.

---

# 14. MVP Definition

The first usable release should intentionally be narrower than the complete vision.

## MVP Goal

Given a Git repository and optional code change, the QE Agent can independently determine:

> "What changed, what should be tested, what available tests can demonstrate correctness, what important tests are missing, and whether the change appears safe."

## MVP Capabilities

The MVP SHOULD:

1. inspect an unfamiliar repository;
2. detect common project ecosystems;
3. inspect git changes;
4. discover existing tests;
5. discover build/lint/test commands;
6. assess change risk;
7. create a validation plan;
8. execute appropriate commands;
9. analyze failures;
10. generate targeted tests;
11. rerun validation;
12. identify remaining test gaps;
13. produce a structured QE report;
14. provide a QE verdict;
15. operate from a local CLI;
16. operate inside GitHub Actions.

## Suggested MVP Ecosystems

Initial validation should focus deeply on a limited set of ecosystems rather than superficially supporting everything.

A reasonable starting group might include:

```text
JavaScript / TypeScript
Python
.NET
```

Additional ecosystems can then be added through the adapter architecture.

---

# 15. Phase 2 Capabilities

Following successful MVP validation, likely extensions include:

- browser-based testing;
- API contract testing;
- test impact analysis;
- coverage-diff intelligence;
- historical defect awareness;
- flaky-test intelligence;
- deeper security checks;
- database migration analysis;
- PR conversation integration;
- Jira / Linear / GitHub Issue requirement ingestion;
- persistent repository quality memory;
- cross-service validation;
- performance regression testing;
- accessibility validation.

---

# 16. Longer-Term Autonomous QE Capabilities

Future versions may behave as a persistent QE team member.

Potential capabilities include:

### Historical Awareness

Remember recurring failures and risky areas of the repository.

### Defect Pattern Learning

Recognize areas that frequently produce production defects.

### Production Feedback

Use appropriately sanitized production telemetry to improve future testing strategy.

### Autonomous Exploratory Testing

Operate an application and intentionally explore unusual workflows without relying exclusively on predefined test cases.

### Quality Trend Analysis

Answer questions such as:

```text
Is this repository getting safer or riskier?

Where is our biggest untested business risk?

Which tests provide little value?

What areas have repeatedly escaped to production?
```

### Multi-Agent QE

Specialized agents could collaborate:

```text
QE Lead Agent
Unit Test Agent
API Test Agent
Browser Test Agent
Security Test Agent
Performance Agent
Accessibility Agent
Failure Triage Agent
```

The QE Lead would coordinate the specialists and produce one unified quality verdict.

---

# 17. QE Report Example

A human-facing report might resemble:

## QE Verdict

**PASS WITH CONCERNS**

## Change Risk

**HIGH**

The change modifies authorization logic shared by four API endpoints.

## Validation Performed

- existing unit tests passed;
- API integration suite passed;
- three authorization scenarios generated and executed;
- unauthorized cross-tenant access was explicitly tested;
- static analysis passed.

## Defects

No confirmed blocker or critical defect identified.

## Test Gaps

Concurrent permission updates were not exercised because the test environment does not provide an appropriate concurrency harness.

## Confidence

**Medium-High**

Strong evidence exists for the primary behavior, but one meaningful risk area remains unverified.

## Recommended Action

Merge is reasonable if the concurrency behavior is unchanged. If the implementation modified permission caching or transaction boundaries, perform additional concurrency validation before release.

---

# 18. Success Metrics

Product success should not be measured by the number of tests generated.

Useful measures include:

## Defect Detection Rate

How often does the QE Agent identify genuine defects before merge or release?

## Signal-to-Noise Ratio

What percentage of reported findings are actionable?

## Escaped Defects

Do projects using the agent experience fewer defects escaping into production?

## Regression Detection

How frequently does the system correctly detect regressions introduced by proposed changes?

## QE Confidence Calibration

When the agent reports high confidence, how often is that assessment justified?

## Developer Acceptance

How frequently are QE findings accepted rather than dismissed?

## Runtime Efficiency

How much useful quality evidence is produced per unit of execution cost?

## Autonomous Resolution

How often can the agent identify, reproduce, and validate a defect without human intervention?

---

# 19. Product Guardrails

The QE Agent MUST NOT:

- claim tests passed when they were not executed;
- hide failed tests;
- silently weaken assertions merely to achieve a green build;
- delete failing tests without explaining why;
- mark uncertain behavior as verified;
- expose protected secrets;
- execute destructive actions without authorization;
- treat code coverage percentage as proof of correctness;
- assume generated implementation code is correct;
- modify production data as part of ordinary QE execution.

---

# 20. Definition of Done for an Agent QE Engagement

A QE engagement is complete when the agent has:

1. understood the relevant repository context;
2. understood the requested change or validation objective;
3. assessed quality risk;
4. created a proportional test strategy;
5. executed all feasible high-value validation;
6. investigated material failures;
7. identified meaningful unverified areas;
8. collected evidence;
9. reported findings with severity and confidence;
10. provided a defensible QE verdict.

A passing test suite alone does not satisfy the Definition of Done.

---

# 21. Implementation Direction

The recommended initial product topology is:

```text
                     ┌──────────────────────┐
                     │      QE Agent        │
                     │     Orchestrator     │
                     └──────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
      ┌───────▼────────┐ ┌──────▼───────┐ ┌──────▼───────┐
      │ Repo / Change  │ │ QE Reasoning │ │    Policy    │
      │    Analyzer    │ │    Engine    │ │    Engine    │
      └───────┬────────┘ └──────┬───────┘ └──────┬───────┘
              │                 │                 │
              └─────────────────┼─────────────────┘
                                │
                     ┌──────────▼───────────┐
                     │ Capability Registry │
                     └──────────┬───────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
    ┌─────▼──────┐       ┌──────▼─────┐       ┌──────▼─────┐
    │ Test/Build │       │ Browser/API│       │ Static/Scan│
    │  Adapters  │       │  Adapters  │       │  Adapters  │
    └─────┬──────┘       └──────┬─────┘       └──────┬─────┘
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                │
                     ┌──────────▼──────────┐
                     │ Execution Sandbox  │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │ Evidence + Findings│
                     └──────────┬──────────┘
                                │
                   ┌────────────▼────────────┐
                   │ QE Report / Quality Gate│
                   └─────────────────────────┘

       GitHub Actions ─┐
       Local CLI      ─┼────> same QE core
       REST/Agent API ─┤
       Other CI       ─┘
```

The architecture intentionally prevents GitHub from becoming the product boundary.

GitHub Actions is one invocation mechanism.

The QE Agent is the product.

---

# 22. Initial Build Sequence

A practical implementation sequence is:

### Milestone 1 — Repository Intelligence

Build repository discovery, ecosystem detection, git diff understanding, and test/tool discovery.

### Milestone 2 — Deterministic Execution

Build secure command execution, result capture, test parsing, timeout handling, and evidence recording.

### Milestone 3 — QE Reasoning

Add change risk analysis, validation planning, gap analysis, and quality verdict generation.

### Milestone 4 — Test Generation

Enable targeted generation of tests followed by execution and validation.

### Milestone 5 — CLI Product

Package the engine behind a stable local CLI.

### Milestone 6 — GitHub Integration

Invoke the same engine through GitHub Actions and publish checks against pull requests.

### Milestone 7 — Browser/API Capabilities

Add interface-level validation adapters.

### Milestone 8 — Organizational Policy

Add centrally managed quality gates and organization-level QE configuration.

---

# 23. QE Agent — Product Decisions v1

### 1. Application Code Modification

The QE Agent SHALL NOT modify application or production source code.

When the agent identifies a probable application defect, it SHALL:

1. document the defect;
2. provide evidence;
3. identify the likely affected code;
4. propose a remediation where useful;
5. leave implementation of the remediation to a developer or implementation agent.

This separation is intentional. The QE Agent acts as an independent evaluator rather than simultaneously acting as the author and judge of application changes.

---

### 2. Test Modification

The QE Agent MAY create or modify automated tests.

Tests considered valuable as permanent regression protection SHOULD normally be committed to the repository.

The agent SHALL distinguish between:

* permanent regression tests;
* proposed test changes;
* temporary investigative tests.

Temporary investigative tests SHALL NOT be committed unless the agent determines they provide ongoing regression value.

---

### 3. GitHub Pull Request Blocking

The QE Agent MAY block a GitHub pull request through a failed GitHub check.

For V1, blocking behavior SHALL remain simple and configurable.

A repository may configure whether a `FAIL` verdict causes the QE GitHub check to fail.

More sophisticated organizational quality-gate policies are deferred beyond MVP.

---

### 4. GitHub Issue Creation

The QE Agent MAY create GitHub issues for confirmed or sufficiently high-confidence defects.

Automatic issue creation SHOULD be configurable.

The agent SHALL avoid generating duplicate issues when an existing issue can reasonably be identified.

Created issues SHOULD contain reproduction evidence, severity, confidence, affected functionality, and relevant QE execution information.

---

### 5. Execution Environment

MVP execution SHALL support:

* execution on the developer's local machine;
* Docker-based isolated execution where Docker is available;
* execution within GitHub Actions.

Docker SHOULD be preferred for executing unfamiliar application code where practical.

The architecture SHALL permit additional sandbox providers to be added later without changing the core QE reasoning engine.

Cloud sandboxes, Kubernetes execution, and dedicated ephemeral VM infrastructure are outside the initial MVP.

---

### 6. Secrets

The QE Agent SHALL operate with the minimum secrets required to execute the relevant test environment.

Secret availability SHALL be determined by project configuration and execution environment.

The QE Agent SHALL NOT assume access to production credentials.

Secrets SHALL NOT be included in prompts, reports, committed evidence, logs, or persistent QE memory unless explicitly permitted and safely handled.

Pull requests containing untrusted code SHALL NOT automatically receive privileged secrets.

---

### 7. Execution and AI Budget

MVP SHALL optimize around execution budgets rather than fixed monetary limits.

The QE Agent SHOULD support configurable execution profiles.

#### Quick

Designed for rapid developer feedback.

Target execution time: approximately 5 minutes.

#### Standard

Default pull-request QE assessment.

Target execution time: approximately 15–20 minutes.

#### Deep

Higher-confidence validation for significant or high-risk changes.

May execute broader regression, browser, integration, and investigative testing.

Target execution time: configurable and potentially 30–60 minutes or longer.

The system SHALL collect execution telemetry including:

* elapsed time;
* AI/model usage where available;
* tool invocations;
* test execution time;
* retries;
* generated tests.

This information will later be used to establish appropriate commercial cost controls.

---

### 8. Project Memory

The QE Agent SHALL support persistent project-specific memory.

Memory SHALL exist only within the project being tested.

The agent SHALL NOT depend on global cross-project memory for normal operation.

Project QE memory SHOULD be stored in a repository-local structure such as:

```text
.qe/
```

Potential contents include:

```text
.qe/
    config.yml
    knowledge/
    history/
    findings/
```

The exact structure will be defined during technical design.

---

### 9. Shared QE Knowledge

Repository QE configuration and durable project knowledge MAY be committed to source control.

This allows QE knowledge to:

* travel with the repository;
* be shared between developers;
* be available to GitHub Actions;
* be available to different AI models;
* evolve with the application.

Machine-specific data, secrets, temporary execution artifacts, and unnecessary historical output SHALL NOT be committed.

---

### 10. Initial Project Scope

MVP SHALL focus on source-code repositories.

Testing already-deployed production environments is outside MVP scope.

The architecture SHOULD permit environment-based validation to be added later.

---

### 11. Ecosystem Support

The QE Agent SHALL NOT define support exclusively through a fixed list of programming languages.

Repository discovery SHALL be generic.

The agent SHALL attempt to determine how an unfamiliar project is built and tested using evidence such as:

* repository structure;
* build files;
* package-manager files;
* documentation;
* CI configuration;
* test configuration;
* existing scripts;
* container definitions.

Known ecosystem adapters MAY provide enhanced capabilities.

Initial high-value adapters SHOULD include common ecosystems such as:

* JavaScript / TypeScript;
* Python;
* .NET.

Additional ecosystems SHALL be extensible without changing the QE core.

An unknown ecosystem SHOULD degrade gracefully rather than automatically be considered unsupported.

---

### 12. Browser Testing

Browser-based testing SHALL be included as an optional MVP capability.

When the project exposes a browser-based application and an executable test environment can be established, the QE Agent SHOULD consider browser validation as part of its QE strategy.

Playwright SHOULD be the initial browser automation adapter.

Browser testing MAY include:

* functional workflows;
* negative workflows;
* navigation;
* forms;
* client-side errors;
* failed network requests;
* browser console errors;
* basic accessibility signals;
* screenshots and traces for defect evidence.

Projects without browser interfaces SHALL NOT require browser tooling.

---

### 13. Requirements Input

For MVP, requirements SHALL be supplied directly to the QE Agent.

Requirements MAY include:

* feature descriptions;
* acceptance criteria;
* bug descriptions;
* implementation objectives;
* expected behavior.

Automatic ingestion from Jira, Linear, GitHub Issues, or other product-management systems is deferred.

The internal requirements interface SHOULD nevertheless be designed so those integrations can be added later.

---

### 14. QE Decision Model

MVP SHALL provide an evidence-supported QE verdict rather than a sophisticated organizational policy engine.

Supported verdicts SHALL initially be:

#### PASS

Available evidence provides strong confidence that the evaluated behavior works as expected and no material defect was identified.

#### PASS WITH CONCERNS

Validation substantially succeeded, but meaningful residual risk or test gaps remain.

#### NEEDS REVIEW

The agent discovered evidence or uncertainty requiring human judgment.

#### FAIL

The agent demonstrated a material defect, regression, or violated requirement.

#### BLOCKED

The agent was unable to collect sufficient evidence to reach a defensible conclusion.

Every verdict SHALL include supporting evidence and remaining uncertainty.

---

### 15. Product Direction

The initial implementation SHALL optimize for simplicity and usefulness as an internal engineering tool.

Architectural decisions SHOULD preserve a reasonable path toward eventual commercial distribution.

MVP SHALL NOT introduce multi-tenancy, billing, hosted infrastructure, organization administration, or other SaaS capabilities unless they are independently required for the QE function.

The product SHALL first prove that autonomous QE provides meaningful engineering value.

---

## Governing Principle

The QE Agent is an independent evaluator.

Its responsibility is not to make software pass.

Its responsibility is to determine, as rigorously as practical:

> **What evidence do we have that this software behaves correctly, what evidence suggests that it does not, and what important uncertainty remains?**

A green result without sufficient evidence is not a successful QE execution.


---

# 24. Central Product Thesis

The QE Agent should not be built as:

> "An AI that writes tests."

It should be built as:

> **"An autonomous quality engineer that decides what evidence is necessary to establish confidence in a software change, gathers that evidence using the tools available to it, challenges the implementation, and reports what it can and cannot prove."**

That distinction should govern the architecture, backlog, user experience, and definition of success.
