# Implementation Assignment — Milestone 3: QE Reasoning

**Milestone:** 3  
**Status:** Accepted  
**Depends On:** Milestone 2  
**Accepted:** 2026-08-17  
**Objective:** Introduce bounded QE reasoning for change understanding, risk assessment, validation planning, gap analysis, and evidence-supported verdict generation.

# Required Reading

Before making changes, read and follow:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. all accepted ADRs under `docs/adr/`
5. `docs/milestones/milestone-3-qe-reasoning.md`
6. relevant Milestone 0–2 implementation/review records

Milestone 2 is the accepted baseline.

Do not redesign prior milestones unless required to correct an actual defect or architectural conflict.

Do not begin Milestone 4.

# Objective

Build the first bounded QE reasoning workflow.

At the end of Milestone 3, the QE Agent should be able to accept:

```text
repository
+
requirements
+
optional baseline/target change
```

and independently produce:

```text
Repository Understanding
        ↓
Change Analysis
        ↓
Risk Assessment
        ↓
Validation Plan
        ↓
Controlled Execution
        ↓
Evidence
        ↓
Gap Analysis
        ↓
QE Verdict
```

The QE Agent may select and execute existing discovered validation commands.

It SHALL NOT generate or modify tests during this milestone.

# Central Principle

Milestone 3 introduces intelligence, not autonomy without limits.

The system SHALL use:

> **bounded reasoning stages operating through one QE Orchestrator**

not:

> **an unconstrained agent with arbitrary shell access**

The LLM decides what evidence would be useful.

The deterministic execution layer decides whether and how an approved action can execute.

# Required Implementation

## 1. QE Orchestrator

Implement the initial `QEOrchestrator`.

Conceptually:

```typescript
interface QEOrchestrator {
  run(request: QERequest): Promise<QEResult>;
}
```

The orchestrator SHALL coordinate the explicit lifecycle defined in the Technical Product Specification.

It SHALL NOT contain ecosystem-specific logic.

It SHALL NOT invoke shell commands directly.

It SHALL NOT call model-provider SDKs directly.

# 2. State-Machine Execution

Implement explicit runtime lifecycle transitions using the existing lifecycle model.

Relevant Milestone 3 states include:

```text
INITIALIZING
DISCOVERING
UNDERSTANDING_CHANGE
ASSESSING_RISK
PLANNING
EXECUTING
INVESTIGATING
ANALYZING_GAPS
FORMING_VERDICT
REPORTING
COMPLETE
BLOCKED
```

`GENERATING_TESTS` and `RETESTING` should remain unused until Milestone 4 unless needed as inert lifecycle definitions already established.

Record state transitions.

Invalid state transitions should fail deterministically.

Do not implement a generic graph/agent workflow framework.

# 3. QE Request Modes

Support at least:

```text
repository
change
```

## Repository Mode

Evaluate the repository and supplied requirements without requiring a Git comparison.

## Change Mode

Evaluate changes between a baseline and target revision.

Use the existing `QERequest` contract where practical.

# 4. Requirements Input

Support directly supplied requirements.

At minimum support:

```text
qe verify --requirements requirements.md
```

and/or:

```text
qe verify --requirement "Non-admin users cannot delete users."
```

Requirements SHALL be normalized into the existing `Requirement` model.

Do not add Jira, Linear, or GitHub Issue ingestion yet.

# 5. `qe verify`

Implement:

```text
qe verify
```

to run repository-oriented QE reasoning against supplied requirements.

Conceptual example:

```text
qe verify \
  --requirements feature.md \
  --profile standard
```

The command should invoke the same core QE orchestrator later used by other entry points.

Do not implement separate CLI-specific QE logic.

# 6. `qe review`

Implement:

```text
qe review
```

for change-oriented QE.

Example:

```text
qe review --base main --profile standard
```

The command SHALL:

1. identify baseline revision;
2. identify target revision;
3. analyze relevant changes;
4. invoke the same QE orchestrator;
5. return a canonical `QEResult`.

Do not introduce GitHub-specific behavior.

# 7. Change Analysis

Implement deterministic Git diff collection plus bounded reasoning about semantic impact.

Deterministically collect at least:

```text
baseline ref
target ref
changed files
added files
deleted files
renamed files
changed tests
changed configuration
changed dependency metadata
```

The reasoning layer MAY infer:

```text
affected components
behavior changes
potential blast radius
important unknowns
```

The raw Git evidence SHALL remain distinguishable from model inference.

# 8. Change Analysis Model

Populate the existing `ChangeAnalysis`.

It SHOULD include:

- summary;
- changed files;
- affected components;
- behavior changes;
- potential blast radius;
- unknowns;
- supporting evidence references where practical.

Do not invent confidence unsupported by evidence.

# 9. Context Builder

Implement a bounded Context Builder.

The QE Agent SHALL NOT send the entire repository blindly to the model.

The Context Builder should select relevant information from:

```text
requirements
RepositoryProfile
change diff
changed files
related project metadata
repository instructions
available capabilities
discovered commands
prior execution evidence from the current run
```

Project persistent memory is still deferred until Milestone 6.

# 10. Context Limits

Introduce explicit context limits.

Examples may include:

```text
maximum changed files included
maximum bytes per file
maximum total source context
maximum documentation excerpt size
```

When context is truncated or omitted, record that limitation.

Do not silently pretend the model saw content it did not receive.

# 11. Model Gateway Provider

Implement at least one real model provider behind the existing `ModelGateway`.

The provider SHALL remain isolated from QE business logic.

Do not hard-code provider SDK calls into:

- orchestrator;
- risk engine;
- planning;
- verdict engine;
- repository analyzer.

Provider selection should use configuration/environment.

# 12. Model Configuration

Introduce minimal configuration for model usage.

For example:

```yaml
model:
  provider: openai
  model: <configured-model>
```

Exact provider/model values should remain configurable.

Secrets such as API keys SHALL come from the execution environment and SHALL NOT be stored in `.qe/config.yml`.

Do not introduce commercial billing/account infrastructure.

# 13. Structured Model Output

All orchestration-critical model responses SHALL use runtime-validated structured outputs.

Reasoning stages SHOULD return typed objects rather than arbitrary prose.

Invalid model output SHALL:

1. fail schema validation;
2. optionally retry within configured budget;
3. never silently enter the domain model.

# 14. Reasoning Roles

Implement bounded reasoning responsibilities.

Suggested roles:

```text
repository_analyst
change_analyst
risk_analyst
test_strategist
failure_investigator
gap_analyst
verdict_reviewer
```

These are logical roles.

They SHALL NOT become autonomous peer agents.

They MAY all use the same underlying model provider.

# 15. Risk Assessment

Implement structured risk assessment.

Supported levels:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Risk should consider:

```text
change scope
business criticality
security sensitivity
data sensitivity
blast radius
test strength
authentication/authorization
financial logic
database changes
external integrations
concurrency
public API changes
```

The result SHALL explain which factors influenced risk.

Do not build a pseudo-precise numerical risk algorithm.

# 16. Risk Evidence

Risk reasoning should cite the repository/change evidence that led to the conclusion where practical.

Example:

```text
Risk: HIGH

Reason:
Shared authorization middleware changed.

Evidence:
src/auth/middleware.ts modified
4 API modules import middleware
```

Model inference remains inference.

# 17. Validation Strategy

Implement the Test Strategy / Validation Planning stage.

The agent SHALL determine:

```text
what should be validated
why
which existing capabilities can validate it
which commands should be considered
what remains unavailable
```

Create a structured `ValidationPlan`.

# 18. Validation Action Selection

Milestone 3 MAY select existing discovered commands for execution.

Examples:

```text
BUILD
TEST
LINT
TYPECHECK
STATIC_ANALYSIS
```

The agent SHALL select only capabilities/commands actually discovered or deterministically constructed from approved adapter behavior.

Do not allow the model to invent arbitrary shell commands and execute them.

Any model-suggested action must resolve to an approved structured capability or command proposal.

# 19. Action Authorization Boundary

The model may recommend:

```text
run command ID test:vitest
```

The deterministic system SHALL:

1. resolve that ID;
2. validate it;
3. construct structured `CommandProposal`;
4. send it through `ExecutionController`.

The model SHALL NOT supply unrestricted executable strings directly to the executor.

# 20. Execution Profiles

Implement meaningful behavior for:

```text
quick
standard
deep
```

The profiles SHOULD influence:

```text
number of selected validation actions
breadth of regression
model-call budget
execution-time budget
investigation depth
```

Keep the first implementation simple.

Document exact profile differences.

# 21. Budget Manager

Implement active budget management.

Track at minimum:

```text
elapsed time
model calls
execution attempts
remaining execution duration
retries
```

The agent SHALL stop or reduce work when the budget is exhausted.

Budget exhaustion should produce a truthful result such as:

```text
BLOCKED
```

or a lower-confidence verdict where appropriate.

Do not continue unconstrained reasoning after the configured budget is exceeded.

# 22. Existing Validation Execution

The orchestrator MAY execute selected existing validation commands through Milestone 2's Execution Controller.

Typical sequence:

```text
Validation Plan
     ↓
Resolve discovered command
     ↓
Execution Controller
     ↓
Evidence
```

Do not bypass Milestone 2 execution policy.

# 23. Execution Ordering

Prioritize validation actions by value.

A reasonable approach:

```text
cheap/high-signal checks first
focused tests
broader relevant tests
expensive validation last
```

The reasoning layer may recommend priority.

The Budget Manager determines whether actions remain affordable.

# 24. Test Result Interpretation

Milestone 3 MAY interpret execution evidence semantically.

Examples:

```text
TEST_RESULT PASS
BUILD_RESULT FAIL
TYPECHECK PASS
COMMAND_RESULT OBSERVED
```

Do not require broad framework-specific result parsing yet.

Exit codes and action semantics may be used cautiously.

# 25. Failure Investigation

Implement a bounded failure-investigation stage.

A failed validation action SHALL NOT automatically become a product defect.

The investigator SHOULD classify possible causes as:

```text
PRODUCT_DEFECT
REGRESSION
TEST_DEFECT
ENVIRONMENT_ISSUE
FLAKY
UNKNOWN
```

For Milestone 3, investigation may use:

- execution evidence;
- changed source;
- relevant tests;
- baseline information;
- bounded re-execution where justified.

Do not generate new tests yet.

# 26. Retry Limits

Retries SHALL be bounded.

Do not repeatedly execute failures until they happen to pass.

Retry behavior should be explicit and recorded.

Potential flaky behavior should become a finding rather than being hidden.

# 27. Baseline Comparison

For change mode, implement limited baseline comparison where valuable and feasible.

Example:

```text
failure on target
      ↓
material to verdict?
      ↓
run equivalent validation on baseline
```

Classify result as:

```text
INTRODUCED
PRE_EXISTING
ENVIRONMENT_SPECIFIC
FLAKY
UNKNOWN
```

Do not implement expensive full baseline environments beyond available execution capabilities.

# 28. Gap Analysis

Implement explicit gap analysis.

The system SHALL ask:

> What important behavior remains unverified?

Produce structured gaps.

Examples:

```text
No browser capability available
Integration environment unavailable
Concurrency behavior untested
Requirement has no corresponding evidence
Changed API consumer unavailable
```

Gaps SHALL influence confidence and verdict.

# 29. Requirement Assessment

Map evidence to supplied requirements.

Each requirement/acceptance criterion SHOULD receive:

```text
VERIFIED
PARTIALLY_VERIFIED
NOT_VERIFIED
BLOCKED
NOT_APPLICABLE
```

A criterion SHALL NOT become VERIFIED solely because source code appears to implement it.

Evidence should support verification.

# 30. Findings

Generate structured findings based on evidence and reasoning.

Supported categories remain those already defined.

At minimum Milestone 3 should be capable of producing:

```text
DEFECT
REGRESSION
TEST_GAP
QUALITY_RISK
FLAKY_TEST
TEST_DEFECT
ENVIRONMENT_ISSUE
```

Every material finding SHOULD reference evidence.

# 31. Finding Confidence

Finding confidence SHALL remain separate from severity.

Example:

```text
Severity: HIGH
Confidence: 0.92
```

Do not conflate business impact with certainty.

# 32. Verdict Engine

Implement the initial Verdict Engine.

Supported verdicts:

```text
PASS
PASS_WITH_CONCERNS
NEEDS_REVIEW
FAIL
BLOCKED
```

The final verdict SHALL consider:

```text
requirements
findings
risk
validation completeness
execution evidence
remaining gaps
budget exhaustion
confidence
```

# 33. Verdict Guardrails

At minimum enforce deterministic guardrails such as:

### FAIL

A demonstrated material defect, regression, or violated high-priority requirement exists.

### BLOCKED

Critical required validation could not be performed and evidence is insufficient for a defensible assessment.

### NEEDS_REVIEW

Evidence conflicts or material uncertainty requires human judgment.

### PASS WITH CONCERNS

No blocking defect was demonstrated but meaningful residual risk remains.

### PASS

No material defect was identified and available evidence strongly supports expected behavior.

Passing one test command SHALL NOT automatically produce PASS.

# 34. Verdict Recommendation vs Final Verdict

The model MAY recommend a verdict.

The final verdict SHALL be produced through a dedicated Verdict Engine.

The Verdict Engine may combine:

- deterministic rules;
- structured model assessment.

The final outcome must remain explainable.

# 35. Confidence

Produce overall QE confidence:

```text
LOW
MEDIUM
HIGH
```

Confidence should consider:

```text
requirement coverage
risk coverage
validation breadth
execution fidelity
remaining gaps
conflicting evidence
```

Do not simply map confidence from risk.

# 36. Canonical QEResult

A completed Milestone 3 run SHALL produce a valid canonical `QEResult`.

It should contain:

```text
repository
target revision
baseline where applicable
profile
RepositoryProfile
ChangeAnalysis where applicable
RiskAssessment
ValidationPlan
Evidence
Findings
RequirementAssessment
RemainingGaps
Verdict
Confidence
Summary
RecommendedNextActions
ExecutionMetrics
```

Do not create separate incompatible output models for `verify` and `review`.

# 37. Human-Readable Report

Implement readable QE output.

Recommended structure:

```text
QE VERDICT

Change Summary

Risk Assessment

Requirements Validation

Validation Performed

Findings

Remaining Gaps

Confidence

Recommended Next Actions
```

The report should distinguish:

```text
executed
observed
inferred
not verified
```

# 38. JSON Output

Support canonical JSON output for QE runs.

For example:

```text
qe verify --requirements feature.md --json
qe review --base main --json
```

stdout must contain valid JSON only.

Logs belong on stderr or should be suppressed.

# 39. Model Call Observability

Record model-call metadata.

At minimum:

```text
role
provider
model
prompt version
duration
token usage where available
success/failure
retry count
```

Do not store raw secrets.

Do not automatically persist entire prompts/responses as project memory.

# 40. Prompt Versioning

Add versioned prompts under the approved prompt structure.

For example:

```text
src/prompts/
├── change-analysis/
├── risk-analysis/
├── validation-plan/
├── failure-analysis/
├── gap-analysis/
└── verdict/
```

Prompts SHOULD define:

```text
objective
input evidence
constraints
required schema
prohibited assumptions
```

# 41. Prompt Trust Rules

Reasoning prompts SHOULD reinforce:

```text
Do not assume implementation correctness.
Do not claim actions occurred unless evidence exists.
Separate inference from execution.
Passing existing tests is not proof of correctness.
Attempt to identify what could break.
Report uncertainty.
Do not modify production code.
```

Prompt rules are supplementary to architectural enforcement.

# 42. No Test Generation

Milestone 3 SHALL NOT create or modify tests.

If gap analysis determines new tests are required, report:

```text
TEST GAP
```

or recommended next action.

Test generation begins in Milestone 4.

# 43. No Production Source Modification

The QE Agent SHALL NOT modify production source.

Milestone 3 should remain effectively read-only except for existing QE runtime artifacts if necessary.

# 44. Fixture Expansion

Extend the evaluation fixtures with known changes and seeded defects.

At minimum create scenarios for:

```text
safe low-risk change
obvious regression
pre-existing failing test
missing requirement coverage
high-risk authorization change
ambiguous/inconclusive validation
```

Fixtures should remain small and deterministic.

# 45. Evaluation Harness

Extend the evaluation harness to measure reasoning quality.

At minimum measure:

```text
expected risk classification
expected selected validation
expected defect detection
expected gap identification
expected verdict
```

Do not judge output primarily by prose quality.

# 46. Model-Independent Reasoning Tests

Most orchestration behavior should remain testable without real model calls.

Use `FakeModelGateway` or recorded structured fixtures for tests covering:

```text
risk outputs
validation plans
failure classifications
gap analysis
verdict recommendation
invalid model output
retry behavior
budget exhaustion
```

# 47. Live Model Tests

If live model integration tests are added, they SHALL:

- be opt-in;
- not run in the default unit test suite;
- require explicit credentials;
- avoid uncontrolled cost;
- avoid being required for CI success.

# 48. Evaluation Scenarios

Create at least these Milestone 3 evaluation scenarios.

## Scenario A — Low-Risk Passing Change

Expected:

```text
LOW/MEDIUM risk
focused validation
evidence collected
PASS or PASS_WITH_CONCERNS
```

## Scenario B — Introduced Regression

Expected:

```text
material finding
FAIL
evidence references failure
```

## Scenario C — Pre-Existing Failure

Expected:

```text
baseline comparison
PRE_EXISTING classification
not automatically blamed on target change
```

## Scenario D — Missing Coverage

Expected:

```text
TEST_GAP
lower confidence
PASS_WITH_CONCERNS or NEEDS_REVIEW
```

## Scenario E — High-Risk Authorization Change

Expected:

```text
HIGH/CRITICAL risk
negative authorization validation requested if capability exists
otherwise meaningful gap
not casual PASS
```

## Scenario F — Insufficient Environment

Expected:

```text
important validation unavailable
BLOCKED or NEEDS_REVIEW
```

# 49. Reasoning Safety

Treat model output as untrusted input.

Validate every structured response.

Do not permit model output to:

- bypass execution policy;
- invent capability IDs silently;
- mutate production source;
- alter evidence;
- bypass budgets;
- invoke arbitrary executables.

# 50. Configuration

Add only minimal Milestone 3 configuration.

Potentially:

```yaml
model:
  provider: <provider>
  model: <model>

reasoning:
  maxModelCalls: 12
```

Execution profile configuration should remain consistent with existing config.

Do not introduce enterprise policy configuration.

# 51. Dependencies

Any real model-provider SDK introduced must be isolated to its provider module.

Avoid introducing a generic agent framework unless explicitly justified and approved.

Do not add:

```text
LangChain
LangGraph
AutoGen
CrewAI
```

or equivalent simply to coordinate the state machine.

The project already has an explicit orchestration architecture.

# 52. Documentation

Update documentation to describe:

```text
qe verify
qe review
```

Explain:

- how requirements are supplied;
- how risk is determined;
- how validation actions are selected;
- how evidence differs from inference;
- how verdicts work;
- what PASS does and does not mean;
- that test generation is not yet implemented.

# Architecture Constraints

Preserve:

- single QE Orchestrator;
- explicit state machine;
- bounded role-specific model calls;
- Model Gateway abstraction;
- deterministic execution through Execution Controller;
- evidence immutability;
- adapter-based capabilities;
- evidence-first reasoning;
- no production-code modification;
- no multi-agent orchestration.

# Do Not Implement Yet

Do NOT implement:

- test generation;
- permanent test modification;
- investigative generated tests;
- Playwright execution beyond any generic existing command execution already supported;
- dedicated browser QE reasoning beyond capability recognition;
- project-memory persistence;
- GitHub Actions check publishing;
- GitHub issue creation;
- organizational policy engine;
- hosted infrastructure;
- multi-agent orchestration.

# Acceptance Criteria

Milestone 3 is complete when all of the following are true:

1. `QEOrchestrator` exists and coordinates a full QE reasoning run.
2. Runtime state transitions follow the explicit lifecycle.
3. `qe verify` works with directly supplied requirements.
4. `qe review` works against a Git baseline.
5. deterministic Git change data is separated from model inference.
6. context sent to models is bounded.
7. at least one real model provider exists behind `ModelGateway`.
8. core QE logic remains provider independent.
9. orchestration-critical model output is schema validated.
10. invalid model output cannot silently enter the domain model.
11. structured risk assessment is produced.
12. validation plans are produced.
13. selected existing validation actions can execute through `ExecutionController`.
14. model reasoning cannot execute arbitrary shell commands.
15. execution budgets are enforced.
16. profile behavior affects validation breadth.
17. failure investigation distinguishes likely cause categories.
18. baseline comparison can distinguish an introduced vs pre-existing failure where feasible.
19. requirement assessments reference evidence.
20. gap analysis reports meaningful unverified behavior.
21. findings reference evidence.
22. severity and confidence remain separate.
23. final verdict is produced by a dedicated Verdict Engine.
24. passing tests alone cannot automatically produce PASS.
25. canonical `QEResult` validates.
26. human-readable reporting works.
27. JSON reporting is valid machine-readable output.
28. reasoning runs require no test generation.
29. production source is not modified.
30. evaluation fixtures include known reasoning scenarios.
31. default automated tests do not require real model credentials.
32. live-model tests, if any, are opt-in.
33. build passes.
34. tests pass.
35. lint passes.
36. formatting checks pass.
37. type checking passes.
38. no Milestone 4 functionality is unnecessarily implemented.

# Required Demonstrations

## Requirements Verification

Run:

```text
qe verify --requirements <fixture-requirements>
```

Demonstrate:

- risk;
- plan;
- execution;
- evidence;
- requirement assessment;
- gaps;
- verdict.

## Change Review

Run:

```text
qe review --base <fixture-baseline>
```

Demonstrate:

- deterministic change analysis;
- semantic impact assessment;
- targeted validation;
- final verdict.

## Introduced Regression

Demonstrate a fixture where target fails and baseline passes.

Expected classification:

```text
INTRODUCED
```

and a blocking/material finding.

## Pre-Existing Failure

Demonstrate target and baseline both failing.

Expected classification:

```text
PRE_EXISTING
```

The change should not automatically be blamed for the failure.

## Missing Coverage

Demonstrate requirements that available execution cannot fully verify.

Expected:

```text
gap identified
lower confidence
non-PASS verdict where appropriate
```

## High-Risk Change

Demonstrate a security/authorization-sensitive change.

Expected:

```text
HIGH or CRITICAL risk
appropriate validation strategy
no casual PASS
```

## JSON

Demonstrate that:

```text
qe review --base <ref> --json
```

produces parseable canonical `QEResult` JSON.

# Required Validation

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

## Implemented

Summarize Milestone 3 reasoning capabilities.

## Orchestration Architecture

Describe:

- lifecycle execution;
- reasoning stages;
- Context Builder;
- Budget Manager;
- Model Gateway integration.

## Model Integration

Describe:

- provider implemented;
- configuration;
- structured output validation;
- retry behavior;
- live-model test isolation.

## Change Analysis

Describe deterministic vs inferred change information.

## Risk and Planning

Describe risk and validation-plan behavior.

## Execution Selection

Explain how model-selected actions resolve to safe structured execution.

## Failure Investigation

Describe failure classification and baseline comparison.

## Gap and Requirement Analysis

Describe requirement-evidence mapping and remaining-gap generation.

## Verdict

Explain deterministic/model roles in the Verdict Engine.

## Evaluation Fixtures

Describe the seeded scenarios and expected outcomes.

## Tests

Summarize meaningful behavioral tests.

Do not report only test count.

## Validation Results

Report exact command results.

## Schema Changes

Describe changes to domain schemas and why.

## Dependencies Added

List and justify new dependencies.

## Deviations

Identify deviations from:

- PRD;
- Technical Product Specification;
- `AGENTS.md`;
- accepted ADRs.

If none, state none.

## Deferred

List functionality intentionally deferred to Milestone 4 or later.

## Concerns

Identify architectural, model-quality, cost, or reliability concerns before Milestone 4.

## Scope Confirmation

Explicitly confirm:

- no test generation was implemented;
- no production-source modification was implemented;
- no multi-agent orchestration was implemented.

Stop after completing Milestone 3.

Do not begin Milestone 4.
