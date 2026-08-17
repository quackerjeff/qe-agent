# Independent Review Assignment — Milestone 3: QE Reasoning

**Milestone:** 3  
**Review Type:** Independent implementation review  
**Target:** QE Reasoning  
**Implementation Specification:** `docs/milestones/milestone-3-qe-reasoning.md`

# Objective

Perform an independent review of the completed Milestone 3 implementation.

You are a reviewer, not the implementation agent.

Do not assume the implementation agent's completion report is correct.

Inspect the actual repository, implementation, tests, fixtures, and Git diff.

Do NOT modify code during this review.

# Required Reading

Before reviewing the implementation, read:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. all accepted ADRs under `docs/adr/`
5. `docs/milestones/milestone-3-qe-reasoning.md`
6. the Milestone 3 implementation report, if present

Treat the implementation report only as a claim of what was implemented.

Verify those claims independently.

# Primary Review Question

Determine whether Milestone 3 reliably implements:

> **Bounded QE reasoning: change understanding, risk assessment, validation planning, gap analysis, and evidence-supported verdict generation.**

Milestone 3 must use bounded reasoning stages through a single QE Orchestrator.

It must NOT generate tests, modify production source, or implement multi-agent orchestration.

All Milestone 2 safety guarantees must remain intact.

# Review Areas

## 1. Milestone Scope

Verify that Milestone 3 implements QE reasoning without prematurely implementing later milestones.

Specifically verify that the implementation does NOT perform:

- test generation;
- production-source modification;
- multi-agent orchestration;
- project-memory persistence;
- GitHub Actions check publishing;
- GitHub issue creation;
- organizational policy engine;
- hosted infrastructure.

Flag any scope creep.

---

## 2. QE Orchestrator

Verify `QEOrchestrator` exists and coordinates a full QE reasoning run through:

```text
Repository Understanding → Change Analysis → Risk Assessment →
Validation Plan → Controlled Execution → Evidence →
Gap Analysis → QE Verdict
```

Verify the orchestrator:

- uses a single entry point;
- progresses through defined stages;
- handles errors without crashing;
- produces valid `QEResult` for both repository and change modes;
- collects evidence, findings, and requirement assessments.

---

## 3. Explicit Lifecycle State Machine

Verify runtime state transitions follow an explicit lifecycle.

The state machine must:

- enforce valid transitions;
- reject invalid transitions;
- allow BLOCKED from any non-terminal state;
- record transition history;
- prevent transition from terminal states.

Verify that completed `QEResult` contains observable lifecycle history, not merely a transition count.

---

## 4. Model Gateway Abstraction

Verify:

- at least one real model provider exists behind `ModelGateway`;
- core QE logic remains provider-independent;
- `FakeModelGateway` enables deterministic testing without live credentials;
- model output is schema-validated;
- invalid model output cannot silently enter the domain model.

---

## 5. Bounded Reasoning Stages

Inspect each reasoning stage:

### Change Analysis

- deterministic Git change data is separated from model inference;
- `buildDeterministicChangeAnalysis` operates without model calls;
- model-augmented analysis provides inferred semantic impact.

### Risk Assessment

- structured risk assessment is produced;
- risk level, factors, and confidence are present.

### Validation Planning

- validation plans are produced;
- selected actions resolve to safe structured execution;
- model cannot inject arbitrary commands;
- profile-based action limits are enforced.

### Failure Investigation

- distinguishes likely cause categories;
- suggests baseline comparison where appropriate.

### Gap Analysis

- requirement assessments reference evidence;
- gap analysis reports meaningful unverified behavior.

### Verdict Engine

- final verdict produced by a dedicated engine;
- passing tests alone cannot automatically produce PASS;
- deterministic guardrails override optimistic model recommendations.

---

## 6. Context Bounded

Verify context sent to models is bounded.

Inspect the Context Builder for:

- truncation of changed files;
- bounded evidence inclusion;
- bounded repository profile;
- no unbounded data passed to model.

---

## 7. Execution Safety

This is a critical review area.

Verify all Milestone 2 safety guarantees remain intact:

- structured commands only (`shell: false`);
- no `shell: true`, `sh -c`, or `bash -c` patterns;
- `ExecutionController` mediates all execution;
- secret redaction is applied;
- evidence is immutable;
- output is bounded;
- execution budgets are enforced;
- model reasoning cannot execute arbitrary shell commands.

Search for all process-spawning mechanisms:

```text
spawn
exec
execFile
fork
spawnSync
execSync
```

Verify none bypass the `ExecutionController` except for Git metadata operations.

---

## 8. Structured Command Boundary

Verify:

- discovered commands carry `executionSupport: "STRUCTURED" | "DISCOVERED_ONLY"`;
- only `STRUCTURED` commands with explicit `executable` and `args` can execute;
- commands containing shell metacharacters are classified `DISCOVERED_ONLY`;
- validation planner does not reconstruct commands via whitespace splitting.

---

## 9. Evidence Reference Validation

Verify:

- model-supplied evidence IDs are validated against the evidence store;
- dangling evidence references are rejected;
- `VERIFIED` requirement status requires executed evidence;
- source-code inspection alone cannot produce VERIFIED;
- finding evidence IDs are validated.

---

## 10. Budget Management

Verify:

- execution budgets are enforced;
- model retries count against the budget;
- budget exhaustion produces BLOCKED or reduced confidence;
- profile behavior affects validation breadth;
- `BudgetAwareGateway` wraps model calls with budget-controlled retries.

---

## 11. Provider-Independent Model Call Metadata

Verify:

- model-call records are captured regardless of provider;
- records include role, provider, model, promptVersion, timing, success, retryCount;
- no API keys or secrets appear in metadata;
- prompt version corresponds to version-controlled prompt files;
- metadata is included in execution metrics.

---

## 12. Lifecycle Transition History

Verify:

- actual transitions are recorded (from, to, timestamp);
- not merely a transition count;
- transitions are included in the canonical result;
- BLOCKED transitions are recorded.

---

## 13. Baseline Comparison

Verify:

- baseline comparison creates a real Git worktree at the baseline ref;
- baseline command executes against baseline source content, not target;
- worktree is cleaned up in a finally block;
- classifications: INTRODUCED, PRE_EXISTING, UNKNOWN;
- equivalent command matching uses structured fields, not shell parsing.

---

## 14. CLI Integration

Verify:

- `qe verify` works with directly supplied requirements;
- `qe review` works against a Git baseline;
- `--json` produces parseable canonical `QEResult` JSON;
- `--profile` selects execution profile;
- human-readable reporting works.

---

## 15. Evaluation Fixtures

Inspect fixture quality and coverage.

At minimum verify fixtures exist for:

- low-risk passing change;
- introduced regression;
- pre-existing failure;
- missing coverage;
- authorization/high-risk change;
- insufficient environment.

Each fixture must include:

- requirements;
- expected risk or risk range;
- expected verdict or allowed verdict set.

Fixtures should be small and deterministic.

---

## 16. Test Quality

Review tests for meaningful behavior.

Look specifically for:

- orchestrator end-to-end behavior;
- state machine transitions;
- budget management;
- evidence reference validation;
- model call metadata capture;
- lifecycle history recording;
- adversarial model output handling;
- baseline comparison classification;
- verdict guardrails.

Flag tests that merely reproduce implementation details.

Verify default automated tests do not require real model credentials.

---

## 17. Process Safety

Verify:

- tests do not recursively launch the project's own test runner;
- no evaluation fixture discovers and executes the QE Agent's own `npm test`;
- spawned child processes are cleaned up on timeout;
- process groups are terminated (SIGTERM → SIGKILL);
- no orphaned Vitest/Node processes remain after test completion.

---

## 18. Schema Changes

Review changes to domain schemas.

Verify:

- `DiscoveredCommand` includes `executionSupport`;
- `LifecycleTransition` schema exists;
- `ModelCallMetadata` schema exists;
- `ExecutionMetrics` includes lifecycle history and model call details;
- domain types remain independent of specific LLM providers.

---

## 19. Security / Safety

Verify Milestone 3 preserves Milestone 2 safety boundaries.

Search for:

- `shell: true` usage;
- `sh -c` or `bash -c` patterns;
- unredacted secrets in output;
- unbounded process execution;
- unsafe parsing assumptions.

---

## 20. Repository Hygiene

Check:

- build output is ignored;
- dependencies are not committed;
- no secrets are present;
- no temporary output is tracked;
- fixture content is minimal.

---

# Required Demonstrations

## Requirements Verification

Independently run:

```text
qe verify --requirements <fixture-requirements>
```

Verify risk, plan, execution, evidence, requirement assessment, gaps, and verdict.

## Change Review

Independently run:

```text
qe review --base <fixture-baseline>
```

Verify deterministic change analysis, semantic impact assessment, targeted validation, and final verdict.

## Introduced Regression

Demonstrate target fails and baseline passes.

Expected classification: `INTRODUCED` with a blocking/material finding.

## Pre-Existing Failure

Demonstrate target and baseline both failing.

Expected classification: `PRE_EXISTING`.

## Missing Coverage

Demonstrate requirements that available execution cannot fully verify.

Expected: gap identified, lower confidence, non-PASS verdict where appropriate.

## High-Risk Change

Demonstrate a security/authorization-sensitive change.

Expected: HIGH or CRITICAL risk, appropriate validation strategy, no casual PASS.

## JSON

Demonstrate that `qe review --base <ref> --json` produces parseable canonical `QEResult` JSON.

---

# Required Validation

Run the project's documented validation independently.

At minimum:

```text
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

All must pass.

Exercise the built CLI rather than relying only on unit tests.

Do not rely on the implementation agent's reported validation.

# Output Format

Produce the following review report.

## Verdict

Choose exactly one:

- ACCEPT
- ACCEPT WITH MINOR CHANGES
- CHANGES REQUIRED
- REJECT

## Executive Assessment

Briefly explain the verdict.

## Acceptance Criteria

Evaluate **every acceptance criterion** in:

`docs/milestones/milestone-3-qe-reasoning.md`

Mark each:

- PASS
- PARTIAL
- FAIL

Explain all PARTIAL or FAIL results.

## Findings

For each finding provide:

**Severity**

- BLOCKER
- HIGH
- MEDIUM
- LOW
- INFORMATIONAL

**Location**

Relevant file(s).

**Description**

What was found.

**Why It Matters**

Connect the issue to product correctness, architecture, safety, maintainability, or milestone requirements.

**Recommended Correction**

Give a bounded recommendation.

Do not implement it.

## Architecture Assessment

Explicitly assess compliance with:

- ADR-001
- ADR-002
- ADR-003
- ADR-004
- ADR-005
- ADR-006
- ADR-007
- ADR-008
- ADR-009
- ADR-010

Also assess relevant `AGENTS.md` constraints.

## Evidence / Confidence Assessment

Evaluate whether requirement assessments are genuinely evidence-backed and whether confidence is understandable.

## Safety Assessment

State whether Milestone 3 preserves all Milestone 2 safety boundaries.

If any boundary was violated, identify it precisely.

## Scope Assessment

Identify any later-milestone functionality that was implemented.

If none, explicitly state none.

## Fixture Assessment

Evaluate whether evaluation fixtures meaningfully exercise QE reasoning scenarios.

## Validation Results

Report commands actually executed and their results.

## Recommended Actions Before Milestone 4

Separate findings into:

### Must Fix

Issues that should be corrected before Milestone 4.

### Should Fix

Useful corrections that do not block Milestone 4.

### Defer

Valid concerns that belong to later milestones.

## Final Recommendation

State whether Milestone 3 should be:

- accepted as-is;
- corrected and re-reviewed;
- substantially reworked.

Do not modify the repository.

Stop after producing the review.
