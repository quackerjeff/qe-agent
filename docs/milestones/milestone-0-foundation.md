**Milestone:** 0
**Status:** Accepted
**Depends On:** 
**Completed:** 2026-08-16
**Accepted:** 2026-08-16

# Implementation Assignment — Milestone 0: Foundation

Implement **Milestone 0 — Foundation** of the QE Agent.

Before making changes, read and follow:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. All accepted ADRs under `docs/adr/`

The Technical Product Specification provides context for the complete product. **Do not implement functionality belonging to later milestones.**

## Objective

Establish the smallest clean, tested TypeScript foundation upon which the QE Agent can be built incrementally.

At the end of this milestone, the repository should have:

- a working TypeScript/Node.js project;
- a working CLI entry point;
- core domain types and schemas;
- configuration loading;
- `.qe/` initialization;
- structured logging;
- execution ID generation;
- a model-provider abstraction;
- automated testing infrastructure.

No autonomous QE behavior is required yet.

# Required Implementation

## 1. TypeScript Project

Initialize the project as a modern TypeScript application running on Node.js.

Configure:

- package management;
- TypeScript compilation;
- development execution;
- testing;
- linting;
- formatting.

Prefer a minimal dependency set.

Document any meaningful dependency choices.

## 2. CLI Foundation

Create the `qe` CLI.

The following must work:

```text
qe --help
qe --version
qe init
```

Do not implement `qe analyze`, `qe test`, `qe verify`, or `qe review` yet beyond an optional clear "not implemented" placeholder if required by the CLI design.

## 3. `qe init`

`qe init` SHALL initialize QE configuration for the current repository.

At minimum, create:

```text
.qe/
└── config.yml
```

Use the MVP configuration model defined in the Technical Product Specification.

Initialization SHALL be safe to run more than once.

It SHALL NOT silently destroy existing configuration.

## 4. Configuration

Implement typed loading and validation of `.qe/config.yml`.

Invalid configuration SHALL produce a useful error.

Do not silently accept malformed configuration.

Provide sensible defaults for omitted optional values.

Keep the configuration surface intentionally small.

## 5. Core Domain Models

Create the initial domain types required by the Technical Product Specification.

At minimum establish types/interfaces or schemas for:

```text
QERequest
QEResult
RepositoryProfile
ChangeAnalysis
RiskAssessment
Requirement
RequirementAssessment
ValidationPlan
ValidationAction
Capability
Evidence
Finding
ExecutionBudget
ExecutionMetrics
```

These types do not require full business behavior during Milestone 0.

Avoid speculative fields beyond those justified by the specification.

## 6. Runtime Schemas

Important boundary objects SHALL have runtime validation.

Use the project's selected schema-validation mechanism consistently.

TypeScript compile-time typing alone is insufficient for external/model/configuration boundaries.

## 7. QE Lifecycle Model

Define the QE lifecycle states specified by the system design:

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

Do NOT implement the full orchestrator behavior yet.

Establish only the domain representation needed for later milestones.

## 8. Model Gateway

Define the provider-independent Model Gateway abstraction.

Conceptually:

```typescript
interface ModelGateway {
  reason<T>(
    task: ReasoningTask<T>
  ): Promise<ModelResult<T>>;
}
```

The exact TypeScript design may improve on this example.

Do NOT implement production integrations with OpenAI, Anthropic, or other model providers during this milestone unless strictly necessary for compilation/testing.

Provide a fake/mock implementation for tests where useful.

## 9. Structured Logging

Implement a small structured logging abstraction.

Logs SHOULD support:

```text
ERROR
WARN
INFO
DEBUG
TRACE
```

Logging architecture SHALL allow future correlation by QE execution ID.

Do not introduce a large observability platform.

## 10. Execution IDs

Every future QE engagement will require an execution ID.

Implement execution-ID creation and basic propagation structures.

Use a standard collision-resistant identifier.

Do not build persistence for QE runs yet.

## 11. Testing Infrastructure

Configure automated testing.

Add tests covering at minimum:

- configuration defaults;
- valid configuration;
- invalid configuration;
- `qe init`;
- repeated `qe init`;
- domain schema validation;
- lifecycle state definitions;
- execution ID generation;
- Model Gateway abstraction using a fake implementation.

Tests SHALL NOT require network access or external AI services.

## 12. Fixture Foundation

Create the top-level fixture structure intended for future QE Agent evaluation.

For example:

```text
fixtures/
└── README.md
```

The README should explain that fixture repositories will contain controlled projects and intentionally seeded defects used to evaluate QE Agent effectiveness.

Do NOT build all ecosystem fixtures yet.

## 13. Developer Documentation

Update or create the project README with:

- purpose of the project;
- MVP status;
- prerequisites;
- installation;
- development commands;
- test command;
- lint command;
- build command;
- how to run `qe --help`;
- how to run `qe init`;
- high-level documentation links.

# Architecture Constraints

The implementation MUST preserve the accepted architecture.

Specifically:

- one QE Orchestrator architecture;
- explicit lifecycle/state-machine design;
- provider-independent model access;
- adapter-based future ecosystem capabilities;
- deterministic execution separated from AI reasoning;
- evidence-first domain model;
- GitHub independence;
- no production-code modification by future QE operation;
- repository-local QE memory;
- evaluation as a first-class product concern.

# Do Not Implement Yet

Do NOT implement:

- repository ecosystem discovery;
- `qe analyze`;
- Git diff analysis;
- autonomous test execution;
- Execution Controller;
- Docker execution;
- test generation;
- Playwright execution;
- browser testing;
- autonomous QE reasoning;
- risk analysis behavior;
- validation-plan generation behavior;
- verdict reasoning;
- GitHub Actions integration;
- GitHub issue creation;
- persistent QE execution history;
- commercial/SaaS infrastructure;
- multi-agent orchestration.

Those belong to later milestones.

# Acceptance Criteria

Milestone 0 is complete when all of the following are true:

1. The TypeScript project installs successfully from a clean checkout.
2. The project builds without TypeScript errors.
3. Automated tests pass.
4. Linting passes.
5. Formatting checks pass.
6. `qe --help` succeeds.
7. `qe --version` succeeds.
8. `qe init` creates valid `.qe/config.yml`.
9. Running `qe init` again does not destroy existing configuration.
10. Invalid QE configuration produces a useful validation error.
11. Core domain models compile and important boundary schemas have runtime validation.
12. QE lifecycle states are explicitly represented.
13. Model access exists behind a provider-independent interface.
14. Tests do not require external model providers or network access.
15. No functionality belonging to later milestones has been unnecessarily implemented.

# Completion Report

When finished, provide:

## Implemented

Briefly describe what was created.

## Architecture

Describe important implementation choices, including dependencies introduced and why.

## Validation

Report the exact commands executed for:

- build;
- tests;
- lint;
- formatting.

Include their results.

## Repository Changes

List important files/directories added or modified.

## Deviations

Identify any deviation from the Technical Product Specification or ADRs.

If none, explicitly state that there were none.

## Deferred

List functionality intentionally deferred to later milestones.

## Concerns

Identify architectural concerns, ambiguities, or decisions that should be reviewed before Milestone 1.

**Stop after completing Milestone 0. Do not begin Milestone 1.**
