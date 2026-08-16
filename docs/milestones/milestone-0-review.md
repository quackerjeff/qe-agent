# Milestone 0 Independent Review Assignment

Review the completed **Milestone 0 — Foundation** implementation for the QE Agent.

You are acting as an independent architecture and implementation reviewer.

Do **not** modify code unless explicitly instructed later.

Before reviewing, read:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. all accepted ADRs under `docs/adr/`

Then inspect the actual repository implementation and diff for Milestone 0.

## Review Objectives

Determine whether Milestone 0:

- satisfies the stated acceptance criteria;
- preserves the approved architecture;
- avoids implementing future milestones;
- introduces unnecessary dependencies or abstractions;
- contains hidden technical debt that should be corrected before Milestone 1;
- has adequate automated test coverage;
- contains implementation choices that conflict with the PRD, system design, AGENTS.md, or ADRs.

## Required Review Areas

### 1. Scope Compliance

Check whether the implementation contains functionality that belongs to later milestones.

Flag any unnecessary implementation of:

- repository discovery;
- test execution;
- Docker execution;
- Git analysis;
- browser automation;
- autonomous QE reasoning;
- test generation;
- GitHub integration;
- multi-agent orchestration;
- SaaS infrastructure.

### 2. Architecture Compliance

Verify that:

- model access is provider independent;
- no specific LLM SDK leaks into core code;
- lifecycle/state definitions are explicit;
- no unconstrained autonomous agent loop exists;
- core domain types do not depend on GitHub;
- evidence is represented as a first-class domain concept;
- future ecosystem behavior can remain adapter-based;
- application-source modification is not accidentally enabled;
- project-local QE memory assumptions are preserved.

### 3. Domain Model Review

Inspect the core schemas and types.

Identify:

- fields invented beyond the current specification;
- overly rigid schemas likely to cause problems later;
- missing distinctions required by the specification;
- duplicate or inconsistent types;
- inappropriate coupling between domain objects.

Pay particular attention to:

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

### 4. Model Gateway Review

Verify that the Model Gateway is a small provider abstraction rather than a premature agent framework.

Check that:

- fake/test implementations remain test-focused;
- production-provider semantics have not been prematurely assumed;
- tool use, streaming, retries, conversational state, or agent memory have not been unnecessarily built into Milestone 0.

### 5. Configuration Review

Inspect `.qe/config.yml` support.

Verify:

- defaults are reasonable;
- invalid configuration fails clearly;
- `qe init` is idempotent;
- existing configuration is not overwritten;
- configuration is not larger than currently necessary.

Do not require migration infrastructure for schema version 1.

### 6. CLI Review

Verify:

```text
qe --help
qe --version
qe init
```

behave appropriately.

Placeholder commands must clearly indicate they are not implemented.

Report whether they return a success or failure exit status and whether that behavior is appropriate.

### 7. Logging and Execution IDs

Verify that:

- logging is structured but lightweight;
- logging does not introduce a large observability abstraction;
- execution IDs can be propagated;
- no persistence or tracing platform has been prematurely introduced.

### 8. Test Quality

Do not merely count tests.

Assess whether tests meaningfully verify:

- config behavior;
- init idempotency;
- schema validation;
- lifecycle states;
- execution IDs;
- logging;
- Model Gateway abstraction.

Identify brittle, trivial, or implementation-coupled tests.

Run the complete validation suite yourself.

### 9. Repository Hygiene

Check for:

- committed build output;
- temporary files;
- secrets;
- unnecessary generated artifacts;
- missing `.gitignore` entries;
- incorrect package metadata;
- CLI packaging problems.

Confirm whether `dist/` is ignored and whether it is tracked.

### 10. Dependency Review

For each dependency, determine whether it is justified for Milestone 0.

Flag:

- large frameworks;
- redundant packages;
- agent frameworks;
- provider SDKs;
- dependencies introduced only for hypothetical future needs.

## Required Validation

Run the project's documented commands for:

```text
build
test
lint
format check
```

Also exercise:

```text
qe --help
qe --version
qe init
```

where practical.

Do not rely solely on the original implementation agent's claimed results.

## Output Format

Produce the following review:

### Verdict

One of:

- ACCEPT
- ACCEPT WITH MINOR CHANGES
- CHANGES REQUIRED
- REJECT

### Acceptance Criteria

For each Milestone 0 acceptance criterion, mark:

- PASS
- FAIL
- PARTIAL

Provide a short explanation for any non-PASS result.

### Findings

For every finding include:

- severity: BLOCKER / HIGH / MEDIUM / LOW / INFORMATIONAL
- affected file(s)
- description
- why it matters
- recommended correction

### Architecture Assessment

State whether the implementation preserves each accepted ADR and the major rules in `AGENTS.md`.

### Scope Assessment

List any functionality that appears to belong to later milestones.

If none, explicitly say so.

### Validation Results

Report the commands you actually ran and their results.

### Recommended Actions Before Milestone 1

Separate into:

**Must Fix**

Issues that should be corrected before Milestone 1.

**Should Fix**

Useful corrections that are not architectural blockers.

**Defer**

Issues that are valid but should intentionally wait until a later milestone.

Do not modify the repository.

Stop after producing the review.