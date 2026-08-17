# Milestone 4 Correction Assignment — Test Generation & Retesting

**Milestone:** 4
**Status:** Corrections Complete
**Purpose:** Resolve independent review findings before Milestone 5
**Next Milestone:** Do NOT begin Milestone 5

# Required Reading

Before modifying code, read:

1. `AGENTS.md`
2. `docs/milestones/milestone-4-test-generation.md`
3. `docs/milestones/milestone-4-review.md`
4. relevant PRD/System Design sections
5. all accepted ADRs
6. the Milestone 4 completion report
7. the independent Milestone 4 review findings

Inspect the actual implementation before making changes.

Preserve the existing write-safety architecture.

Do not redesign Milestone 4 unless required to correct the reviewed behavior.

# Objective

Correct Milestone 4 so that:

1. generated-test evidence proves the generated test actually executed;
2. failing generated tests are investigated before being treated as product defects;
3. generation is driven by a validated structured plan with requirement provenance;
4. required Milestone 4 scenarios are reproducible end to end.

Do NOT begin Milestone 5.

# 1. Generated Test Execution Must Target the Generated Test

This is the highest-priority defect.

Current behavior may execute a generic discovered test command without including the generated test file.

That means QE Agent can report PASS evidence for a generated test that never ran.

This MUST be corrected.

## Required Behavior

When a generated test is intended to support evidence, the system must know that the test runner actually exercised that generated test.

Preferred flow:

```text
generated test path
      ↓
determine runner/framework
      ↓
construct focused structured command
      ↓
ExecutionController
      ↓
test execution
      ↓
evidence tied to generated test
```

Use adapter/framework-aware structured command construction.

Examples conceptually:

```text
Vitest:
vitest <generated-file>

Jest:
jest <generated-file>

pytest:
pytest <generated-file>

dotnet:
dotnet test <test-project> --filter/target as safely supported
```

Exact syntax should come from deterministic adapter logic, not model-supplied shell strings.

## Fallback Behavior

If the runner cannot safely target the generated test file:

* do NOT claim per-generated-test execution evidence merely because a broad test command passed;
* either run a known suite that deterministically includes that test and record the weaker evidence correctly;
* or mark generated-test execution as unverified/inconclusive.

The system must never infer:

```text
generic suite command PASS
→ generated test definitely executed
```

unless inclusion is deterministically known.

## Required Regression Test

Create a generated test whose contents definitely fail if executed.

Configure a generic discovered command that exits 0 without loading the file.

Expected:

```text
generated test NOT considered executed
no PASS evidence attributed to generated test
```

Then use a proper focused runner command.

Expected:

```text
generated test actually executes
failure is observed
evidence references generated test
```

# 2. Add Adapter-Aware Focused Test Execution

Introduce the smallest appropriate abstraction for focused test execution.

For example:

```typescript
interface FocusedTestCommandResolver {
  resolve(
    generatedTestPath: string,
    repositoryProfile: RepositoryProfile,
    discoveredCommands: DiscoveredCommand[]
  ): FocusedTestResolution;
}
```

The exact design may differ.

The resolver should return something equivalent to:

```text
SUPPORTED
  executable
  args[]
  framework
  confidence/provenance

UNSUPPORTED
  reason
```

Do not introduce shell parsing.

Do not use:

```text
shell: true
sh -c
bash -c
```

to achieve targeting.

All execution still flows through `ExecutionController`.

# 3. Generated Test Evidence Provenance

Generated-test execution evidence must explicitly record:

* generated test ID;
* generated file path;
* framework/runner used;
* focused command or known inclusive suite;
* execution evidence ID;
* whether execution was:

  * TARGETED;
  * SUITE_INCLUDED;
  * UNVERIFIED.

A requirement or finding may only rely on generated-test evidence appropriate to the claim.

# 4. Add Generated-Test Failure Investigation

A generated test failure must NOT automatically become a product defect.

Introduce a dedicated bounded investigation step.

At minimum classify:

```text
TEST_DEFECT
PRODUCT_DEFECT
REGRESSION
ENVIRONMENT_ISSUE
UNKNOWN
```

Where evidence is insufficient, prefer:

```text
UNKNOWN
```

or:

```text
TEST_DEFECT
```

over unsupported product blame.

## Investigation Inputs

May include:

* generated test source;
* generation plan;
* requirement;
* execution evidence;
* relevant existing tests;
* target source context;
* baseline comparison where applicable.

## Guardrail

A generated-test failure must not produce:

```text
PRODUCT_DEFECT
```

or:

```text
REGRESSION
```

unless there is supporting evidence beyond merely:

```text
new test failed
```

# 5. Bad Generated Test Scenario

Create a deterministic scenario where the generated test is intentionally wrong.

Example:

```text
actual required behavior is correct
generated test expects wrong value
```

Expected:

```text
generated test FAIL
investigation → TEST_DEFECT or UNKNOWN
no unsupported product-defect finding
no automatic FAIL caused solely by the bad generated test
```

# 6. Confirmed Regression Scenario

Create a deterministic seeded product defect where:

```text
baseline code → generated regression test passes
target code   → generated regression test fails
```

Expected:

```text
target evidence FAIL
baseline evidence PASS
structured comparison INTRODUCED
finding REGRESSION/DEFECT
verdict FAIL
permanent regression test retained
```

The baseline comparison must use the accepted Milestone 3 mechanism.

# 7. Structured Generation Plan Must Be Used

`TestGenerationPlanSchema` currently exists but is not part of the runtime flow.

Make generation use a validated structured plan before file proposals are applied.

At minimum the plan should carry:

```text
objective
targetBehavior
requirementIds
targetFramework
targetLocation
classification
expectedEvidence
```

The exact field names may differ.

The plan must be runtime validated.

Generated proposals must be traceable back to the plan.

# 8. Preserve Requirement Provenance

Do not create generated changes with:

```text
requirementIds: []
```

when the generation decision originated from specific requirement gaps.

Carry relevant requirement IDs into:

* generation plan;
* generated proposal;
* GeneratedTestChange;
* generated-test evidence;
* reassessment.

If generation is risk-driven rather than requirement-driven, empty requirement IDs may be valid, but that must be intentional rather than lost provenance.

# 9. Generation/Evidence Relationship

A generated test must not affect requirement status merely because it was created.

Required sequence:

```text
generation plan
→ test proposal
→ write
→ execute
→ evidence
→ requirement reassessment
```

Only executed evidence may support `VERIFIED`.

# 10. Add Real Milestone 4 Evaluation Scenarios

Create deterministic end-to-end Milestone 4 scenarios.

At minimum:

## A. Missing Coverage Resolved

Repository contains an uncovered requirement.

Expected:

```text
gap detected
generation justified
test generated
test actually executed
evidence produced
requirement/gap reassessed
```

## B. Confirmed Regression

Expected:

```text
permanent test generated
target FAIL
baseline PASS
INTRODUCED
material finding
FAIL
test retained
```

## C. Negative Case

Repository lacks meaningful negative behavior coverage.

Expected:

```text
negative test generated
actually executed
appropriate evidence
```

## D. Boundary Bug

Seed a simple boundary defect.

Expected:

```text
boundary test generated
target failure observed
finding produced
```

## E. Bad Generated Test

Expected:

```text
bad test FAIL
TEST_DEFECT or UNKNOWN
no unsupported product defect
```

## F. Production Write Attempt

Expected:

```text
WRITE_DENIED
production hash unchanged
```

## G. Investigative Cleanup

Expected:

```text
investigative test generated
executed
removed
evidence retained
```

## H. Permanent Retention

Expected:

```text
permanent test generated
executed
retained
reported
```

# 11. Evaluation Harness

Add or extend a deterministic Milestone 4 evaluation harness.

It mu[118;1:3ust use real controlled repository/test behavior where relevant.

It may use `FakeModelGateway` for deterministic generation outputs.

It must not require live model credentials.

Evaluate structured expected vs actual values, including:

```text
generation justified
test framework
test path
execution targeting mode
execution result
generated-test failure classification
baseline classification where applicable
requirement status
gap status
finding
verdict
retained/removed
```

Do not evaluate only prose.

# 12. Reassessment Ordering

Verify requirement/gap/verdict reassessment occurs only after generated-test execution and failure investigation.

Preferred order:

```text
generate
→ write
→ execute
→ investigate failure if any
→ baseline compare if appropriate
→ create findings
→ reassess requirements
→ reassess gaps
→ recompute verdict
```

Do not allow weak unrelated generated evidence to improve the verdict.

# 13. Candidate Metrics

Correct the metric that counts `CANDIDATE` tests as permanent retained tests.

Use distinct metrics such as:

```text
permanentTestsRetained
candidateTestsRetained
```

or rename to a neutral retained-test metric with classification-specific counts.

This is not architectural, but fix it in this correction pass because it is small and affects reporting accuracy.

# 14. Preserve Write Safety

Do not regress already-passing write-boundary behavior.

Explicitly preserve:

* production source denial;
* config/infrastructure denial;
* traversal denial;
* symlink denial;
* ambiguous-path denial;
* dirty-file protection;
* deletion denial;
* assertion-weakening protection;
* skip-test protection;
* prompt-injection resistance;
* production file hash preservation.

# 15. Preserve Milestone 3 Contracts

Do not regress:

* structured baseline comparison;
* real baseline worktrees;
* structured command execution;
* evidence-reference integrity;
* lifecycle history;
* model-call observability;
* retry budget enforcement;
* process hygiene.

# 16. Process Hygiene

Run targeted Milestone 4 tests twice.

After each run verify no QE-created:

```text
node
npm
vitest
test-runner processes
temporary generated tests
baseline worktrees
```

remain.

No manual `pkill` may be required.

# 17. Do Not Implement

Do NOT implement:

* dedicated browser QE;
* Playwright-specific autonomous browser reasoning;
* project memory;
* GitHub integration;
* automatic commit/push;
* production-code repair;
* multi-agent orchestration;
* SaaS infrastructure.

# Required Regression Tests

At minimum add tests proving:

1. generated test file is actually targeted;
2. generic unrelated command PASS cannot masquerade as generated-test PASS;
3. unsupported focused execution is marked honestly;
4. bad generated test becomes TEST_DEFECT/UNKNOWN rather than unsupported product defect;
5. confirmed generated regression produces INTRODUCED;
6. structured generation plan is required;
7. requirement IDs propagate correctly;
8. generated test evidence references the actual generated file;
9. requirement reassessment requires executed evidence;
10. candidate/permanent retention metrics remain distinct;
11. all eight evaluation scenarios produce expected structured outcomes.

# Required Validation

Run:

```text
npm test -- tests/milestone-4-test-generation.test.ts
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

Run the Milestone 4 deterministic evaluation harness.

Run the targeted Milestone 4 test suite twice and verify process cleanup after each run.

# Completion Report

Provide:

## Corrections Made

Map every independent-review finding to the correction.

## Generated Test Execution

Explain:

* focused-test command resolution;
* TARGETED vs SUITE_INCLUDED vs UNVERIFIED evidence;
* how the system proves a generated test actually ran.

## Failure Investigation

Explain generated-test failure classification and guardrails.

## Generation Plan

Explain how structured plans now drive proposals and preserve requirement provenance.

## Evaluation Scenarios

Report expected vs actual results for all eight scenarios.

## Evidence / Reassessment

Explain how generated-test evidence affects requirements, gaps, findings, and verdict.

## Metrics

Explain candidate/permanent retention metric changes.

## Process Hygiene

Report two consecutive targeted-suite runs and leftover process/worktree state.

## Validation Results

Report exact command results.

## Architecture Impact

State whether any accepted architecture changed.

If none, state none.

## Scope Confirmation

Explicitly confirm:

* no production-source modification;
* no automatic Git commit/push;
* no project memory;
* no dedicated browser QE;
* no multi-agent orchestration.

Stop after completing these corrections.

Do not begin Milestone 5.

