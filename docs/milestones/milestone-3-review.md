# Independent Review Assignment — Milestone 3: QE Reasoning

**Milestone:** 3
**Review Type:** Independent implementation and correction review
**Target:** QE Reasoning
**Implementation Specification:** `docs/milestones/milestone-3-qe-reasoning.md`
**Correction Specification:** `docs/milestones/milestone-3-corrections.md`

# Objective

Perform an independent review of the completed Milestone 3 implementation and subsequent correction work.

Do NOT modify the repository.

Do NOT begin Milestone 4.

Do not assume the implementation agent's completion report or test results are correct. Independently inspect the repository, code, tests, fixtures, Git behavior, process execution, schemas, prompts, and documentation.

The primary question is:

> Is Milestone 3 sufficiently correct, safe, deterministic, evidence-driven, and operationally stable to become the foundation for Milestone 4 test generation?

# Required Reading

Before reviewing, read:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. all accepted ADRs under `docs/adr/`
5. `docs/milestones/milestone-3-qe-reasoning.md`
6. `docs/milestones/milestone-3-corrections.md`
7. `docs/milestones/milestone-3-review.md`
8. relevant Milestone 1 and Milestone 2 review/correction records
9. the Milestone 3 implementation/correction completion reports, if present

Treat completion reports only as claims requiring verification.

# Required Verdict

Return exactly one:

* `ACCEPT`
* `CHANGES REQUIRED`
* `REJECT`

Do not use `ACCEPT WITH MINOR CHANGES`.

If an unresolved defect can materially affect execution safety, evidence integrity, regression classification, requirement verification, verdict integrity, resource cleanup, or evaluation reliability, return `CHANGES REQUIRED`.

# 1. QE Orchestrator Architecture

Verify that one `QEOrchestrator` coordinates the QE lifecycle.

Verify it:

* does not contain ecosystem-specific discovery logic;
* does not invoke model-provider SDKs directly;
* does not execute shell commands directly;
* uses `ModelGateway`;
* uses `ExecutionController`;
* produces canonical `QEResult`;
* remains an orchestrator rather than an unconstrained autonomous agent.

# 2. State Machine

Verify explicit lifecycle transitions are enforced.

Exercise successful and BLOCKED runs.

Verify transition history is recorded and observable, not merely counted.

At minimum, transition records should identify:

```text
from
to
timestamp
```

or an equivalent auditable representation.

Verify invalid transitions are rejected.

# 3. Model Gateway Boundary

Verify provider-specific code remains behind `ModelGateway`.

Search for direct OpenAI/provider SDK usage outside provider modules.

Core reasoning components must remain provider independent.

# 4. Structured Model Outputs

Identify every model call influencing:

* change interpretation;
* risk;
* validation planning;
* failure investigation;
* requirement assessment;
* gap analysis;
* verdict recommendation.

Verify orchestration-critical responses are runtime schema validated.

Malformed model output must not silently enter domain state.

Retries must be bounded.

# 5. Model Output Is Untrusted

Verify model output cannot directly:

* execute arbitrary commands;
* modify execution policy;
* increase budgets;
* modify evidence;
* modify production source;
* invent executable capabilities;
* bypass `ExecutionController`.

Model-selected actions must resolve through deterministic capability/command resolution.

# 6. Context Builder

Verify model context is explicitly bounded.

Inspect limits for:

* changed files;
* bytes per file;
* total source context;
* diff size;
* documentation excerpts.

Verify omitted/truncated context is represented honestly.

The model must not be treated as having seen content it did not receive.

# 7. Requirements Input

Exercise direct requirement input.

Verify requirements normalize into the canonical `Requirement` model.

Verify empty/malformed input behaves clearly.

No Jira/Linear/GitHub Issue integration should be required.

# 8. Change Analysis

Verify deterministic Git facts remain separate from model inference.

Deterministic information should include relevant:

```text
baseline
target
changed files
added files
deleted files
renamed files
test changes
configuration changes
dependency changes
```

Semantic impact, blast radius, and behavioral interpretation may be inferred but must remain distinguishable from observed Git facts.

# 9. Real Baseline Execution — CRITICAL

This is a mandatory acceptance test.

Independently construct or use a deterministic Git scenario where:

```text
baseline revision → validation passes
target revision   → validation fails
```

Verify validation actually executes against different source contents.

Expected:

```text
baseline content
    ↓
baseline validation
    ↓
PASS evidence A

target content
    ↓
target validation
    ↓
FAIL evidence B

comparison
    ↓
INTRODUCED
```

Verify:

* baseline execution uses actual baseline revision content;
* target execution uses actual target content;
* active developer working tree is not destructively modified;
* baseline execution uses `ExecutionController`;
* target and baseline have separate evidence IDs;
* temporary worktrees/directories are cleaned up;
* final comparison is represented in canonical evidence/result data.

Expected failure classification:

```text
INTRODUCED
```

An introduced material regression should result in an appropriate material finding and normally `FAIL`.

# 10. Pre-Existing Failure

Exercise:

```text
baseline → FAIL
target   → FAIL equivalently
```

Expected:

```text
PRE_EXISTING
```

Verify the target change is not falsely blamed for introducing the failure.

Also verify `PRE_EXISTING` does not automatically imply PASS.

# 11. Structured Command Resolution — CRITICAL

Verify executable commands are represented as structured:

```text
executable
args[]
```

or equivalent.

Search for naïve executable reconstruction such as:

```typescript
split(/\s+/)
```

Verify it is not used to convert arbitrary discovered strings into executable commands.

Exercise:

* quoted arguments;
* arguments containing spaces;
* shell metacharacters;
* pipelines;
* redirects;
* unsupported shell expressions.

Unsafe/ambiguous commands should remain discovered-only or be rejected.

Verify the correction did not introduce:

```text
shell: true
sh -c
bash -c
```

as a workaround.

# 12. Execution Controller Boundary

Verify all project validation execution flows through the Milestone 2 `ExecutionController`.

Confirm Milestone 3 has not introduced a parallel execution path.

Verify preservation of:

* directory confinement;
* environment filtering;
* timeout enforcement;
* bounded output;
* secret redaction;
* immutable evidence;
* process cleanup.

# 13. Process Hygiene / Orphaned Worker Regression — CRITICAL

A previous correction test run produced large numbers of orphaned Node/Vitest workers and extreme system load.

This must be independently verified as corrected.

Inspect all process-spawning code, including uses of:

```text
spawn
exec
execFile
fork
spawnSync
execSync
```

Verify evaluation fixtures do not accidentally execute the QE Agent repository's own test suite recursively.

Specifically inspect commands such as:

```text
npm test
npm run test
vitest
npx vitest
node ...vitest...
```

Verify fixture repository/root resolution prevents an evaluation fixture from discovering and executing the parent QE Agent's validation commands.

# 14. Timeout Process Cleanup

Exercise a validation command that intentionally exceeds its execution timeout.

Verify:

```text
spawn validation
      ↓
timeout
      ↓
terminate process tree
      ↓
await termination
      ↓
return timeout evidence
```

After the test completes, verify no descendant processes remain.

Where applicable, inspect process-group behavior.

A timeout must not terminate only the immediate parent while leaving descendants alive.

# 15. Test Timeout Cleanup

Verify that if a test/evaluation itself fails or times out, child validation processes and temporary worktrees are still cleaned up.

Inspect:

* `try/finally`;
* `afterEach`;
* `afterAll`;
* abort/cancellation behavior.

No test should rely on `pkill`, manual cleanup, or parent-process termination.

# 16. Repeated-Run Process Stability

Run the targeted correction/evaluation suite more than once.

Verify successive runs do not accumulate Node/Vitest child processes, temporary worktrees, or other execution resources.

The reviewer should explicitly report whether QE-created child processes remain after completion.

Do not accept a solution whose primary mitigation is merely:

* globally increasing test timeouts;
* globally reducing Vitest worker count;
* manually killing Node processes.

Those may be useful diagnostics but are not the root-cause fix.

# 17. Evaluation Fixtures

Verify deterministic scenarios exist for at least:

1. low-risk passing change;
2. introduced regression;
3. pre-existing failure;
4. missing coverage;
5. high-risk authorization change;
6. insufficient environment.

They must be reproducible scenarios, not merely prose requirements.

Git-dependent scenarios must contain meaningful revision history.

# 18. Evaluation Harness

Run the deterministic Milestone 3 evaluation harness.

It must not require `OPENAI_API_KEY`.

Verify it measures structured outcomes such as:

```text
risk
selected validation
failure classification
findings
gaps
requirement assessment
verdict
```

Do not accept a harness that primarily evaluates generated prose or keyword presence.

# 19. Low-Risk Passing Scenario

Expected:

```text
LOW or MEDIUM risk
focused validation
no material demonstrated defect
PASS or PASS_WITH_CONCERNS
```

A true PASS must still have adequate evidence.

# 20. Introduced Regression Scenario

Expected:

```text
baseline PASS
target FAIL
INTRODUCED
material finding
FAIL
```

# 21. Pre-Existing Failure Scenario

Expected:

```text
baseline FAIL
target FAIL
PRE_EXISTING
```

The change must not automatically be blamed.

# 22. Missing Coverage Scenario

Expected:

```text
meaningful TEST_GAP
reduced confidence
PASS_WITH_CONCERNS or NEEDS_REVIEW
```

A casual PASS is not acceptable.

# 23. High-Risk Authorization Scenario

Expected:

```text
HIGH or CRITICAL risk
appropriate security/negative validation when available
meaningful gap when unavailable
no casual PASS
```

# 24. Insufficient Environment Scenario

Expected:

```text
important validation unavailable
material gap
BLOCKED or defensible NEEDS_REVIEW
```

Unavailable validation must not be interpreted as successful validation.

# 25. Evidence Reference Integrity — CRITICAL

Inject model output referencing nonexistent evidence, for example:

```text
made-up-evidence-123
```

Attempt:

```text
status: VERIFIED
evidenceIds:
  - made-up-evidence-123
```

Verify the nonexistent reference cannot enter the canonical result as valid supporting evidence.

The requirement must not become legitimately VERIFIED.

Check equivalent evidence references in findings and other reasoning output.

# 26. Requirement Verification Guardrail

Create a scenario where source inspection suggests a requirement is implemented, but no appropriate execution evidence verifies the behavior.

Have the fake model recommend:

```text
VERIFIED
```

Verify the system prevents unsupported behavioral verification.

Code appearance alone is insufficient evidence.

# 27. Optimistic Verdict Attack — CRITICAL

Inject a fake model recommendation:

```text
PASS
```

while deterministic evidence demonstrates an introduced material regression.

Expected final verdict:

```text
FAIL
```

Verify the dedicated Verdict Engine controls the final result.

# 28. Invented Command Attack

Have the fake model select a nonexistent command/capability ID.

Verify:

```text
no arbitrary executable synthesized
no execution occurs
```

The unavailable action should become an appropriate planning/gap condition.

# 29. Risk Assessment

Review risk calibration.

Verify sensitive changes such as authorization changes raise risk appropriately.

Verify small changes are not arbitrarily classified CRITICAL.

Risk must explain evidence/factors influencing the assessment.

# 30. Validation Planning

Verify validation actions correspond to discovered capabilities.

Plans should distinguish:

```text
available and executable
available but not safely executable
desired but unavailable
```

Model suggestions must not become execution authority.

# 31. Failure Investigation

Verify a failed validation is not automatically classified as a product defect.

Review supported categories such as:

```text
PRODUCT_DEFECT
REGRESSION
TEST_DEFECT
ENVIRONMENT_ISSUE
FLAKY
UNKNOWN
```

Verify evidence supports classifications.

# 32. Gap Analysis

Verify gaps represent meaningful missing validation rather than generic boilerplate.

Examples include:

* missing browser capability;
* unavailable integration environment;
* uncovered requirement;
* concurrency not exercised;
* downstream dependency unavailable.

# 33. Verdict Integrity

Explicitly test whether PASS can be produced with insufficient evidence.

Passing one existing test command must not automatically produce PASS.

Verify meaningful behavior for:

```text
PASS
PASS_WITH_CONCERNS
NEEDS_REVIEW
FAIL
BLOCKED
```

# 34. Model Call Observability

Verify provider-independent model-call metadata is captured.

At minimum:

```text
reasoning role
provider
model
prompt version
duration
success/failure
retry count
```

and token usage where available.

Verify this also works with `FakeModelGateway`.

Do not require raw prompts/responses to be persisted.

Secrets must not appear in metadata.

# 35. Budget Enforcement

Verify model calls and retries count against configured budgets.

Exercise:

```text
attempt 1 → invalid/error
attempt 2 → retry
```

Then force budget exhaustion.

Verify:

* retries are bounded;
* retries consume budget;
* reasoning stops when exhausted;
* resulting status/verdict truthfully represents incomplete reasoning.

# 36. JSON Output

Exercise JSON output where feasible using deterministic/fake model execution.

Verify stdout is valid JSON only.

Logs must not contaminate stdout.

Verify canonical `QEResult` validation succeeds.

# 37. Human-Readable Reporting

Verify reporting clearly distinguishes:

```text
executed
observed
inferred
not verified
```

Narrative language must not imply stronger evidence than actually exists.

# 38. Default Tests Must Be Offline

Verify:

```text
npm test
```

and the evaluation harness do not require a live model API key.

The real model provider should exist for actual use, but default automated validation must remain deterministic and credential-free.

# 39. Scope Compliance

Verify Milestone 3 does NOT implement:

* test generation;
* test-file modification;
* production-source modification;
* project-memory persistence;
* GitHub integration;
* dedicated browser QE behavior beyond generic command execution;
* multi-agent orchestration;
* SaaS infrastructure.

# 40. Documentation

Verify:

```text
docs/milestones/milestone-3-review.md
```

is actually this Milestone 3 review assignment and does not contain stale Milestone 1 instructions.

Check relevant CLI/documentation changes for consistency.

# Required Validation

Run independently:

```text
npm test -- tests/milestone-3-corrections.test.ts
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

All must pass before `ACCEPT`.

Also run the deterministic Milestone 3 evaluation harness if it is a separate command.

Do not require `OPENAI_API_KEY` for default validation.

# Process-Hygiene Validation

Before the targeted test run, establish a reasonable baseline for relevant QE-created Node/Vitest child processes.

After the targeted test completes, verify that it did not leave QE-created Node/Vitest workers running.

Repeat the targeted suite at least once.

Verify the second run does not accumulate additional surviving workers.

Do not kill unrelated user/system Node processes as part of the test.

# Required Output Format

## Verdict

Return exactly one:

```text
ACCEPT
CHANGES REQUIRED
REJECT
```

## Executive Assessment

Explain whether Milestone 3 is sufficiently trustworthy to proceed to Milestone 4.

## Acceptance Criteria

Evaluate the Milestone 3 acceptance criteria as:

```text
PASS
PARTIAL
FAIL
```

Explain every PARTIAL and FAIL.

## Previous Findings Re-Review

For each previous correction finding, mark:

```text
RESOLVED
PARTIALLY RESOLVED
NOT RESOLVED
REGRESSION
```

Cover at minimum:

1. real baseline execution;
2. structured command resolution;
3. evaluation fixtures;
4. evaluation harness;
5. evidence-reference integrity;
6. lifecycle history;
7. model-call observability;
8. retry/budget accounting;
9. Milestone 3 review documentation;
10. orphaned Node/Vitest process behavior.

## Baseline Comparison Results

Explicitly report results for:

```text
baseline PASS + target FAIL
```

and:

```text
baseline FAIL + target FAIL
```

State whether genuinely different revision contents were executed.

## Process Hygiene Results

Explicitly report:

* whether recursive Vitest execution was observed;
* whether fixture commands executed from the correct repository;
* whether timeout cleanup terminates descendants;
* whether worktrees are cleaned up;
* whether targeted tests leave Node/Vitest workers behind;
* whether repeated runs accumulate processes.

This section is required even if everything passes.

## Adversarial Results

Report results for:

* invented evidence;
* unsupported VERIFIED requirement;
* optimistic PASS recommendation;
* invented command/capability;
* retry-budget exhaustion;
* ambiguous/unsafe command representation.

## Evaluation Results

Report each of the six required evaluation scenarios and expected versus actual behavior.

## Architecture Assessment

Assess:

* single QE Orchestrator;
* state machine;
* ModelGateway boundary;
* ExecutionController boundary;
* evidence integrity;
* canonical QEResult;
* provider independence;
* relevant ADR compliance.

## Milestone 2 Regression Assessment

Explicitly state whether Milestone 3 or its corrections weakened any Milestone 2 execution safety property.

## Scope Assessment

Identify any Milestone 4+ functionality introduced.

If none, state none.

## Validation Results

Report exact commands run and results.

Do not report only test counts.

## Findings

For every remaining issue provide:

**Severity**

* BLOCKER
* HIGH
* MEDIUM
* LOW
* INFORMATIONAL

**Location**

Relevant files.

**Description**

What is wrong.

**Why It Matters**

Explain impact on trust, safety, evidence integrity, correctness, or maintainability.

**Recommended Correction**

Provide a bounded correction.

Do not implement it.

## Recommended Actions

Separate into:

### Must Fix Before Milestone 4

### Should Fix

### Defer

## Final Recommendation

Answer explicitly:

> Is Milestone 3 sufficiently trustworthy and operationally stable to become the foundation for Milestone 4 test generation?

If yes, return `ACCEPT`.

If baseline comparison, structured execution, evidence integrity, verdict integrity, budget enforcement, evaluation reliability, or process cleanup remains materially defective, return `CHANGES REQUIRED`.

Do not modify the repository.

Stop after producing the review.
