# Final Targeted Review Assignment — Milestone 3

**Milestone:** 3  
**Review Type:** Final targeted acceptance review  
**Purpose:** Determine whether Milestone 3 can be closed and Milestone 4 may begin

# Objective

Perform a final independent review of the last Milestone 3 correction pass.

This is NOT a new full Milestone 3 architecture review.

Previous reviews have already established that the overall Milestone 3 architecture is substantially correct.

This review exists to verify the remaining acceptance blockers and ensure their corrections did not regress previously accepted safety properties.

Do NOT modify the repository.

Do NOT begin Milestone 4.

# Required Reading

Read:

1. `AGENTS.md`
2. `docs/milestones/milestone-3-qe-reasoning.md`
3. `docs/milestones/milestone-3-corrections.md`
4. `docs/milestones/milestone-3-review.md`
5. the latest Milestone 3 correction assignment
6. the latest correction completion report, if present
7. relevant accepted ADRs

Inspect actual code, tests, fixtures, and Git history.

Treat implementation-agent claims as claims to verify.

# Required Verdict

Return exactly one:

```text
ACCEPT
CHANGES REQUIRED
REJECT
```

Use `ACCEPT` if the acceptance gates below pass and no new material regression is found.

Do not block Milestone 4 for cosmetic cleanup or unrelated future improvements.

Use `CHANGES REQUIRED` only for a material Milestone 3 defect.

# Acceptance Gate 1 — Structured Baseline Comparison

Verify baseline comparison is now represented as structured machine-readable canonical data.

It must NOT require parsing finding titles or descriptions.

Verify the canonical representation contains, directly or equivalently:

```text
classification
targetEvidenceId
baselineEvidenceId
```

Supported classification should include relevant values such as:

```text
INTRODUCED
PRE_EXISTING
ENVIRONMENT_SPECIFIC
FLAKY
UNKNOWN
```

Verify evidence references correspond to actual evidence records.

## Introduced Regression

Independently exercise:

```text
baseline validation → PASS
target validation   → FAIL
```

Expected:

```text
classification = INTRODUCED
```

Verify:

- actual baseline revision content is executed;
- actual target content is executed;
- baseline and target evidence are separate;
- structured comparison references both;
- finding/verdict are consistent with the structured classification.

A material introduced regression should normally produce:

```text
FAIL
```

## Pre-Existing Failure

Independently exercise:

```text
baseline validation → FAIL
target validation   → FAIL equivalently
```

Expected:

```text
classification = PRE_EXISTING
```

Verify the target change is not falsely identified as introducing the failure.

PASS this gate only if downstream consumers can determine the classification without parsing prose.

# Acceptance Gate 2 — `qe exec --command-id` Uses Structured Commands

Inspect the `qe exec --command-id` path.

Verify it uses structured discovered-command information:

```text
executable
args
executionSupport
```

or equivalent.

Search specifically for naïve reconstruction such as:

```typescript
split(/\s+/)
```

in executable command-resolution paths.

Verify a display string is not treated as executable authority.

Exercise:

### Structured Command

A safely structured command should execute through `ExecutionController`.

### Argument Containing Spaces

Verify an argument containing spaces remains one argument.

### DISCOVERED_ONLY Command

Expected:

```text
execution rejected
```

It must not be guessed or reconstructed.

### Nonexistent Command ID

Expected:

```text
no execution
clear failure
```

Verify the correction did NOT introduce:

```text
shell: true
sh -c
bash -c
```

as a workaround.

# Acceptance Gate 3 — Real Evaluation Scenarios

Inspect all six Milestone 3 evaluation scenarios:

```text
low-risk passing change
introduced regression
pre-existing failure
missing coverage
high-risk authorization change
insufficient environment
```

Verify they now use real deterministic repository state rather than merely:

```text
scenario metadata
requirements files
process.cwd()
injected RepositoryProfile
fabricated execution outcomes
```

The implementation may use:

- committed fixture repositories; or
- deterministic temporary repository generators.

Either is acceptable.

The important requirement is that repository intelligence, Git behavior, command discovery, and execution evidence come from controlled scenario repository state.

Fake/scripted model reasoning is still appropriate and desirable for deterministic tests.

# Acceptance Gate 4 — Git-Based Evaluation Scenarios

Inspect the scenarios where history matters.

## Introduced Regression Fixture

Verify there is genuine revision history representing:

```text
baseline → validation passes
target   → validation fails
```

The evaluation must discover and execute this behavior rather than simply inject the expected result.

Expected structured outcomes include:

```text
INTRODUCED
material finding
FAIL
```

## Pre-Existing Failure Fixture

Verify genuine revision history representing:

```text
baseline → validation fails
target   → validation fails equivalently
```

Expected:

```text
PRE_EXISTING
```

The target change must not be falsely blamed.

# Acceptance Gate 5 — Evaluation Harness

Run the deterministic Milestone 3 evaluation harness.

It must not require:

```text
OPENAI_API_KEY
```

Verify it evaluates structured behavior, not primarily prose keywords.

At minimum verify expected vs actual behavior for:

```text
risk
selected validation
baseline classification where applicable
important findings
important gaps
requirement status where applicable
verdict
```

Allowed verdict sets are acceptable where more than one outcome is defensible.

Report every scenario individually.

# Acceptance Gate 6 — Six Scenario Outcomes

Verify all six.

## A. Low-Risk Passing Change

Expected:

```text
LOW or MEDIUM risk
focused validation
no material demonstrated defect
PASS or PASS_WITH_CONCERNS
```

If PASS is returned, evidence must be sufficient.

## B. Introduced Regression

Expected:

```text
baseline PASS
target FAIL
INTRODUCED
material finding
FAIL
```

## C. Pre-Existing Failure

Expected:

```text
baseline FAIL
target FAIL
PRE_EXISTING
```

The target change must not automatically be blamed.

## D. Missing Coverage

Expected:

```text
meaningful TEST_GAP
reduced confidence
PASS_WITH_CONCERNS or NEEDS_REVIEW
```

A casual PASS is not acceptable.

## E. High-Risk Authorization Change

Expected:

```text
HIGH or CRITICAL risk
appropriate validation strategy
meaningful gap if required validation unavailable
no casual PASS
```

## F. Insufficient Environment

Expected:

```text
important validation unavailable
material gap
BLOCKED or defensible NEEDS_REVIEW
```

Unavailable validation must not count as successful evidence.

# Acceptance Gate 7 — Provider Retry Accounting

Inspect the real model-provider path and `BudgetAwareGateway`.

Verify there are no opaque provider retries that bypass the orchestrator's budget accounting.

Acceptable approaches include:

```text
provider SDK internal retries disabled
```

or:

```text
every actual provider attempt surfaced and charged to budget
```

Exercise deterministic retry behavior with the fake/scripted gateway.

## Retry Then Success

```text
attempt 1 → fail
attempt 2 → succeed
```

Verify actual attempt accounting reflects both attempts.

## Budget Exhaustion

Force repeated failures.

Verify:

```text
configured budget exhausted
        ↓
no additional provider attempt
        ↓
reasoning stops
        ↓
truthful incomplete/BLOCKED result
```

There must not be effectively unlimited hidden retries.

# Acceptance Gate 8 — Evidence Integrity Regression Check

Re-run adversarial evidence tests.

Inject a nonexistent evidence ID.

Verify it cannot validly support:

```text
VERIFIED
```

for a requirement.

Verify model-generated findings/assessments cannot introduce dangling evidence references into canonical results.

# Acceptance Gate 9 — Verdict Integrity Regression Check

Inject a model recommendation of:

```text
PASS
```

while deterministic evidence establishes an introduced material regression.

Expected final verdict:

```text
FAIL
```

The model recommendation must not override deterministic evidence guardrails.

# Acceptance Gate 10 — Execution Boundary Regression Check

Verify the final corrections did not weaken Milestone 2/Milestone 3 execution guarantees.

Confirm:

- execution goes through `ExecutionController`;
- structured commands remain authoritative;
- arbitrary model command strings cannot execute;
- directory confinement remains enforced;
- environment filtering remains enforced;
- output remains bounded;
- secret redaction remains active;
- execution evidence remains immutable;
- timeout cleanup remains active.

Do not perform another exhaustive Milestone 2 review unless evidence of regression appears.

# Acceptance Gate 11 — Baseline Worktree Hygiene

Verify baseline execution:

- does not alter the active developer worktree;
- creates isolated baseline content;
- executes from the correct baseline repository root;
- cleans up temporary worktrees;
- creates separate baseline evidence.

After baseline demonstrations, verify no QE-created baseline worktrees remain.

# Acceptance Gate 12 — Process Hygiene

The prior orphaned Node/Vitest worker problem must remain fixed.

Run:

```text
npm test -- tests/milestone-3-corrections.test.ts
```

twice.

After EACH run verify:

- no QE-created Node/Vitest/npm descendants remain;
- no runaway validation processes remain;
- no accumulated temporary worktrees remain.

Do not use `pkill` as part of successful validation.

Do not accept globally increased timeouts or globally disabled concurrency as substitutes for correct cleanup.

If the tests pass quickly and no processes remain, consider this gate satisfied.

# Acceptance Gate 13 — Targeted Correction Suite

Run:

```text
npm test -- tests/milestone-3-corrections.test.ts
```

Expected:

```text
PASS
```

Report exact test count and duration where available.

Run it twice as required by the process-hygiene gate.

# Acceptance Gate 14 — Full Validation

Independently run:

```text
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

All must pass.

Default tests must not require live model credentials.

# Acceptance Gate 15 — Scope

Verify the final correction did NOT introduce:

- test generation;
- test-file modification by the QE Agent;
- production-source modification;
- project memory;
- GitHub integration;
- dedicated browser QE functionality;
- multi-agent orchestration;
- SaaS infrastructure.

Do not penalize test fixtures or test code for creating controlled files as part of automated testing.

# Required Output

## Verdict

Return exactly:

```text
ACCEPT
```

or:

```text
CHANGES REQUIRED
```

or:

```text
REJECT
```

## Executive Assessment

State whether the remaining Milestone 3 blockers have been resolved.

Keep this concise.

## Final Acceptance Gates

Report each as:

```text
PASS
FAIL
```

for:

1. structured baseline comparison;
2. `qe exec --command-id` structured execution;
3. real evaluation scenarios;
4. Git-based regression scenarios;
5. deterministic evaluation harness;
6. six scenario outcomes;
7. provider retry accounting;
8. evidence integrity;
9. verdict integrity;
10. execution boundary;
11. baseline worktree hygiene;
12. process hygiene;
13. targeted correction suite;
14. full validation;
15. scope compliance.

Explain every FAIL.

## Baseline Demonstration

Report actual observed behavior for:

```text
baseline PASS + target FAIL
```

including:

```text
classification
target evidence ID present?
baseline evidence ID present?
final verdict
```

Then report:

```text
baseline FAIL + target FAIL
```

including the same information.

Explicitly state whether classification was obtained from structured result data rather than parsing prose.

## Evaluation Scenario Results

Use a compact table:

| Scenario | Repository Real? | Git History Where Needed? | Expected | Actual | Result |
|---|---|---|---|---|---|
| Low-risk passing | | | | | |
| Introduced regression | | | | | |
| Pre-existing failure | | | | | |
| Missing coverage | | | | | |
| Authorization change | | | | | |
| Insufficient environment | | | | | |

## Structured Command Results

Report:

```text
normal structured command
argument containing spaces
DISCOVERED_ONLY command
nonexistent command ID
```

and whether each behaved correctly.

State explicitly whether executable command reconstruction using whitespace splitting still exists.

## Retry/Budget Results

Report:

```text
retry then success
budget exhaustion
real-provider internal retry behavior
```

State whether every actual provider attempt is budget-accounted.

## Process Hygiene Results

Report:

```text
targeted run #1
targeted run #2
leftover Node/Vitest/npm processes
leftover baseline worktrees
```

State explicitly whether any manual process killing was required.

## Regression Assessment

State whether the final corrections introduced any regression in:

- evidence integrity;
- verdict guardrails;
- ExecutionController safety;
- lifecycle behavior;
- model-provider abstraction.

## Validation Results

Report exact results for:

```text
npm test -- tests/milestone-3-corrections.test.ts   # run 1
npm test -- tests/milestone-3-corrections.test.ts   # run 2
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

## Remaining Findings

Only report findings that materially matter before Milestone 4.

For each:

```text
Severity:
Location:
Description:
Why it matters:
Recommended correction:
```

Do not turn minor cleanup or future enhancements into blockers.

## Final Recommendation

Answer explicitly:

> Is Milestone 3 sufficiently trustworthy to close and use as the foundation for Milestone 4?

If all material acceptance gates pass:

```text
ACCEPT — Milestone 3 may be closed and Milestone 4 may begin.
```

If a material gate fails:

```text
CHANGES REQUIRED — Milestone 3 must remain open.
```

Do not modify the repository.

Do not begin Milestone 4.

Stop after producing the review.