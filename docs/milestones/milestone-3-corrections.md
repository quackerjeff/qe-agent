# Milestone 3 Correction Assignment — QE Reasoning

**Milestone:** 3  
**Status:** Corrections Required  
**Purpose:** Resolve findings from the independent Milestone 3 review  
**Next Milestone:** Do NOT begin Milestone 4

# Required Reading

Before modifying code, read:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. all accepted ADRs under `docs/adr/`
5. `docs/milestones/milestone-3-qe-reasoning.md`
6. `docs/milestones/milestone-3-review.md`
7. the independent Milestone 3 review findings

Inspect the actual implementation before making changes.

Preserve the existing Milestone 3 architecture unless a correction genuinely requires changing it.

Do NOT begin Milestone 4.

# Objective

Correct the Milestone 3 reasoning, evidence, evaluation, and observability defects while preserving the architectural boundary:

> The model may reason about what should be validated, but deterministic systems control execution, evidence, budgets, and the final defensibility of the result.

# Required Corrections

## 1. Implement Real Baseline Execution

The current baseline comparison incorrectly re-executes validation against target repository contents.

This MUST be corrected.

For change-mode baseline comparison, validation intended to represent the baseline must execute against actual baseline source content.

A reasonable MVP approach is:

```text
target repository
      ↓
material failure
      ↓
create temporary Git worktree at baseline revision
      ↓
perform repository discovery against baseline worktree
      ↓
resolve equivalent validation action
      ↓
execute through ExecutionController
      ↓
collect independent baseline evidence
      ↓
compare target vs baseline
```

Other safe deterministic approaches are acceptable if they genuinely execute baseline content.

Do NOT:

- modify the developer's primary working tree;
- use `git checkout` destructively against the active repository;
- reuse target execution evidence as baseline evidence;
- classify a baseline result that was never actually executed.

Temporary worktrees/directories must be cleaned up.

Baseline execution SHALL continue to use:

- ExecutionController;
- command policy;
- timeout;
- secret redaction;
- output limits;
- evidence creation.

### Required Classification

At minimum support:

```text
target fails + baseline passes
    → INTRODUCED

target fails + baseline fails equivalently
    → PRE_EXISTING

baseline cannot execute reliably
    → UNKNOWN or environment-appropriate classification
```

Do not infer `PRE_EXISTING` merely because both revisions contain similar files.

### Evidence

Target and baseline executions must receive separate evidence IDs.

The comparison result must reference those evidence IDs.

The canonical result must preserve the comparison outcome somewhere appropriate and machine-readable.

### Required Regression Test

Create a deterministic Git fixture where:

```text
baseline revision → test passes
target revision   → same test fails
```

Verify classification is:

```text
INTRODUCED
```

Create another fixture where both baseline and target fail equivalently.

Verify:

```text
PRE_EXISTING
```

---

## 2. Eliminate Whitespace Command Reconstruction

Do not reconstruct structured command proposals using:

```typescript
command.split(/\s+/)
```

or equivalent generic whitespace splitting.

This violates the structured command boundary established in Milestone 2.

Preferred correction:

Extend repository command discovery so a discovered command contains a structured executable and argument representation whenever it can be determined safely.

Conceptually:

```typescript
interface DiscoveredCommand {
  id: string;
  category: CommandCategory;

  display: string;

  executable?: string;
  args?: string[];

  source: string;
  confidence: number;

  executionSupport:
    | "STRUCTURED"
    | "DISCOVERED_ONLY";
}
```

The exact schema may differ.

Commands that cannot be represented safely and deterministically should remain discoverable but not automatically executable.

For example:

```text
complex shell pipeline
quoted shell substitution
conditional shell expression
```

may be reported as:

```text
DISCOVERED_ONLY
```

rather than parsed with an unsafe homegrown shell parser.

Do NOT introduce:

```text
shell: true
sh -c
bash -c
```

to solve quoting.

Add regression tests for:

- quoted arguments;
- spaces inside arguments;
- multiple package managers;
- unsupported shell-like commands;
- structured package-manager commands.

---

## 3. Add Real Milestone 3 Evaluation Fixtures

The current evaluation content is insufficient.

Create deterministic fixture repositories/scenarios for the required Milestone 3 evaluations.

At minimum:

```text
fixtures/evaluation/
├── low-risk-change/
├── introduced-regression/
├── pre-existing-failure/
├── missing-coverage/
├── authorization-change/
└── insufficient-environment/
```

Exact organization may vary.

Each fixture/scenario must include:

- repository content;
- requirements;
- Git history where change/baseline behavior matters;
- known expected risk or risk range;
- expected validation behavior;
- expected important finding/gap;
- expected verdict or allowed verdict set.

Fixtures should remain small.

Do not install external dependencies merely to make fixture behavior work.

Prefer deterministic scripts or tiny projects.

---

## 4. Implement an Evaluation Harness

Create a deterministic QE reasoning evaluation harness.

The harness should execute Milestone 3 behavior using `FakeModelGateway` or scripted structured model responses.

It must not require live model credentials.

The harness SHALL evaluate behavior rather than prose.

At minimum capture:

```text
expected risk
actual risk

expected validation action IDs
actual validation action IDs

expected failure classification
actual failure classification

expected gaps
actual gaps

expected verdict
actual verdict
```

A scenario should fail evaluation when required behavior differs materially from expectation.

The evaluation harness may support an allowed set where multiple defensible verdicts exist.

Example:

```text
missing coverage
allowed verdicts:
  PASS_WITH_CONCERNS
  NEEDS_REVIEW
```

Do not reduce evaluation to keyword matching against generated summaries.

---

## 5. Validate Model-Supplied Evidence References

Model output must not be allowed to introduce references to nonexistent evidence.

Before model-produced:

- requirement assessments;
- findings;
- gap explanations where evidence-linked;
- verdict supporting references;

enter the canonical result, validate their evidence IDs against the current run's Evidence Store.

For every supplied evidence ID:

```text
evidence ID exists?
    yes → retain
    no  → reject / downgrade / fail structured reasoning stage
```

Do not silently retain dangling references.

### Requirement Verification Guardrail

A requirement SHALL NOT become:

```text
VERIFIED
```

if:

- referenced evidence does not exist;
- no appropriate executed evidence supports verification.

Source-code inspection or model confidence alone is insufficient.

Add adversarial tests where the fake model returns:

```text
evidenceIds:
  - made-up-evidence-123
```

Verify the invalid reference cannot produce a valid VERIFIED requirement.

---

## 6. Record Lifecycle Transition History

The state-machine lifecycle must be observable beyond transient logs.

Record actual transition history for every run.

At minimum include:

```text
from
to
timestamp
```

Optionally include:

```text
reason
duration
```

Keep the representation lightweight.

Include the transition history in:

- canonical execution metrics;
- run metadata;
- or another appropriate canonical result field.

Do not store only:

```text
transitionCount: 9
```

without the transitions themselves.

Add tests proving:

- normal transition ordering;
- BLOCKED transitions;
- invalid transitions remain rejected;
- completed QEResult contains observable lifecycle history.

---

## 7. Add Provider-Independent Model Call Metadata

Model-call observability must not depend on inspecting `OpenAIModelGateway.callLog`.

Introduce a provider-independent model-call record.

Conceptually:

```typescript
interface ModelCallRecord {
  role: ReasoningRole;

  provider: string;
  model: string;

  promptVersion: string;

  startedAt: string;
  durationMs: number;

  success: boolean;

  retryCount: number;

  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
```

Exact structure may vary.

The QE run should collect model-call records regardless of provider.

Include them in execution metrics or run metadata.

Do not include:

- API keys;
- secrets;
- full raw prompts by default;
- full provider responses by default.

Prompt version must correspond to the version-controlled prompt used for the call.

Add tests using FakeModelGateway proving metadata is captured without provider-specific assumptions.

---

## 8. Count Provider Retries Against Budget

Model retries consume resources and must count against the reasoning budget.

The current Budget Manager SHALL be corrected so provider retry attempts affect the appropriate:

```text
model calls
retry count
remaining budget
```

A stage must not effectively receive unlimited retries hidden inside the provider implementation.

Preferred behavior:

```text
reasoning stage requests model call
        ↓
attempt 1 → invalid/error
        ↓
Budget Manager records attempt/retry
        ↓
budget remaining?
        ↓
attempt 2 if permitted
```

Provider-specific retries that occur underneath the gateway must still be observable to budget accounting.

Add tests for:

- successful first attempt;
- one retry;
- retry exhaustion;
- model-call budget exhaustion;
- resulting BLOCKED/lower-confidence behavior.

---

## 9. Correct `milestone-3-review.md`

Replace the incorrect Milestone 1 review assignment currently stored as:

```text
docs/milestones/milestone-3-review.md
```

with the actual Milestone 3 review assignment used for independent review.

This is documentation/history correction only.

Do not alter product architecture for this item.

---

# Required Evaluation Scenarios

The completed corrections must demonstrate all six Milestone 3 scenarios.

## Scenario A — Low-Risk Passing Change

Expected:

```text
LOW or MEDIUM risk
focused validation
no material defect
PASS or PASS_WITH_CONCERNS
```

A PASS requires sufficient requirement evidence.

## Scenario B — Introduced Regression

Baseline passes.

Target fails.

Expected:

```text
INTRODUCED
material defect/regression finding
FAIL
```

## Scenario C — Pre-Existing Failure

Baseline fails equivalently.

Target fails.

Expected:

```text
PRE_EXISTING
target change not automatically blamed
```

The final verdict may still reflect repository health, but the change must not be falsely identified as introducing the defect.

## Scenario D — Missing Coverage

Important requirement cannot be fully validated.

Expected:

```text
TEST_GAP
lower confidence
PASS_WITH_CONCERNS or NEEDS_REVIEW
```

A casual PASS is invalid.

## Scenario E — Authorization Change

Change impacts authorization/security-sensitive behavior.

Expected:

```text
HIGH or CRITICAL risk
appropriate negative validation requested if available
meaningful gap if unavailable
no casual PASS
```

## Scenario F — Insufficient Environment

A critical validation capability cannot execute.

Expected:

```text
material gap
BLOCKED or defensible NEEDS_REVIEW
```

The system must not treat unavailable validation as successful validation.

---

# Required Adversarial Tests

Add tests for:

## Invented Evidence

Fake model supplies nonexistent evidence IDs.

Expected:

```text
reference rejected
requirement cannot become VERIFIED using fake evidence
```

## Optimistic Verdict

Fake model recommends:

```text
PASS
```

while evidence demonstrates an introduced material regression.

Expected final verdict:

```text
FAIL
```

## Optimistic Requirement Verification

Fake model marks a requirement VERIFIED based only on source inspection.

Expected:

```text
not VERIFIED
```

unless appropriate execution evidence exists.

## Invented Command

Fake model recommends a nonexistent command/capability ID.

Expected:

```text
no execution
```

## Complex Command

Repository discovery identifies a command requiring unsafe shell parsing.

Expected:

```text
discovered but not automatically executable
```

unless represented safely as structured executable + args.

## Budget Retry Exhaustion

Repeated invalid model outputs consume the configured reasoning budget.

Expected:

```text
reasoning stops
truthful BLOCKED or reduced-confidence result
```

---

# Live Model Credentials

Do NOT require `OPENAI_API_KEY` for:

```text
npm test
evaluation harness
default CI validation
```

The real provider integration must remain available for actual use.

Live-model testing may be opt-in.

The lack of a live API key during independent review is not itself a defect.

However, all Milestone 3 reasoning behavior must be demonstrable deterministically using the fake/scripted Model Gateway.

---

# Safety Constraints

Preserve all Milestone 2 guarantees:

- structured commands;
- `shell: false`;
- ExecutionController;
- directory confinement;
- secret redaction;
- immutable evidence;
- bounded output;
- timeout/process cleanup;
- environment filtering.

The corrections must not introduce alternate execution paths.

---

# Architecture Constraints

Preserve:

- one QE Orchestrator;
- explicit state machine;
- ModelGateway abstraction;
- bounded reasoning stages;
- no autonomous peer agents;
- deterministic execution authorization;
- evidence-first reasoning;
- provider-independent core;
- canonical QEResult.

---

# Do Not Implement

Do NOT implement:

- generated tests;
- test file modification;
- production-source modification;
- dedicated Playwright/browser reasoning;
- project memory;
- GitHub check publishing;
- GitHub issue creation;
- organizational policy engine;
- multi-agent orchestration;
- SaaS infrastructure.

---

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

Also run the deterministic Milestone 3 evaluation harness.

---

# Completion Report

Provide:

## Corrections Made

Map every independent-review finding to the implemented correction.

## Baseline Comparison

Explain:

- baseline workspace strategy;
- baseline command resolution;
- target/baseline evidence;
- cleanup behavior;
- comparison classification.

## Structured Commands

Explain how command discovery and execution remain structured without generic whitespace parsing.

## Evaluation Harness

Describe the six scenarios, expected outcomes, and evaluation mechanism.

## Evidence Reference Integrity

Explain how model-supplied evidence references are validated.

## Lifecycle Observability

Describe transition-history recording.

## Model Observability

Describe provider-independent call metadata and prompt-version recording.

## Budget Corrections

Describe how retries affect budgets.

## Tests

Summarize meaningful regression/adversarial tests.

## Evaluation Results

Report results for all six scenarios.

## Validation Results

Report exact command results.

## Schema Changes

Describe any changes to canonical domain schemas and why.

## Architecture Impact

Identify any architectural changes.

If none, explicitly state none.

## Remaining Concerns

Identify anything intentionally deferred.

## Scope Confirmation

Explicitly confirm:

- no test generation was implemented;
- no production-source modification was implemented;
- no project memory was implemented;
- no multi-agent orchestration was implemented.

Stop after completing the Milestone 3 corrections.

Do not begin Milestone 4.