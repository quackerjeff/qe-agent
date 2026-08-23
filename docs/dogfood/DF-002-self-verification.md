# DF-002 — Self Verification

## Objective

Run QE Agent against its own Product & Functional Requirements using the
`quick` profile.


### How to use this document going forward

The key distinction is **DF-002 is the scenario; DF-F001 etc. are bugs discovered by running that scenario.** That's the piece that was getting muddled.

So on the **next run**, don't rewrite DF-002 and don't renumber anything. If the run proves DF-F004 fixed, add its `Correction` and `Verification` and change it to `RESOLVED`. If the run exposes something genuinely new, add `DF-F006`. Then update **Latest Dogfood Verification**, the status table, and the final **Assessment**.

And importantly, a run returning `PASS_WITH_CONCERNS` does **not** mean every DF finding is resolved. Likewise, DF-F005 being resolved doesn't mean DF-002 itself is “done.” The scenario stays around as a regression/dogfood exercise; findings have their own lifecycles.

That gives you a document that can survive another 20 dogfood runs without turning into a chronological pile of contradictory reports.

## Command

```bash
node dist/cli/main.js verify \
  --profile quick \
  --requirements "docs/Automated QE Agent — Product & Functional Requirements.md"
```

## Current Status

**PASS_WITH_CONCERNS**

Self-verification now completes through verdict formation.

The latest live dogfood run returned:

- Verdict: `PASS_WITH_CONCERNS`
- Confidence: `MEDIUM`
- Duration: approximately 109 seconds
- Logical model calls: 6
- Validation commands completed successfully:
  - `npm run test`
  - `npm run lint`
  - `npm run typecheck`

The run also exercised generated-test handling. A generated test referenced
nonexistent repository modules. Static validation detected the invalid imports
before execution, classified the resulting evidence as `INCONCLUSIVE`, prevented
the defective generated test from driving a product `FAIL` verdict, and removed
the generated test from the working tree.

The dogfood scenario is therefore operational, but significant
requirement-verification gaps remain.

---

## Initial Dogfood Result

**BLOCKED**

The initial DF-002 run successfully:

- discovered the repository;
- loaded project memory;
- entered risk assessment;
- made one model call.

The run then failed because the model response did not satisfy the expected
`RiskAssessment` schema.

Validation errors included:

- missing `level`;
- `factors` returned as an object instead of an array;
- missing `confidence`;
- missing `summary`.

No validation commands were executed.

This initial run produced the findings below.

---

## Findings

### DF-F001 — Invalid model output blocks risk assessment

**Category:** PRODUCT QUALITY / ROBUSTNESS  
**Status:** RESOLVED

#### Observation

The real model returned a response that did not match the runtime
`RiskAssessment` schema.

QE Agent correctly rejected the malformed structured output rather than
accepting invalid reasoning.

However, the run immediately became `BLOCKED` instead of recovering through a
bounded structured-output repair or retry mechanism.

#### Correction

Structured-output handling was strengthened so malformed model output can enter
the bounded schema-repair/retry path rather than immediately terminating the
run.

Provider structured-output handling was also improved so runtime schema
validation remains authoritative.

#### Verification

Subsequent live dogfood runs progressed beyond risk assessment and completed
later reasoning and execution stages.

The original malformed-output failure no longer blocks DF-002 at risk
assessment.

---

### DF-F002 — Failed/schema-invalid model calls are missing from AI usage telemetry

**Category:** BUG / TELEMETRY  
**Status:** RESOLVED

#### Observation

The initial `qe verify` run made one real model call, as confirmed by Execution
Metrics, but AI Usage reported zero calls and zero tokens after the returned
model response failed schema validation.

Telemetry should distinguish attempted, successful, and failed model calls and
preserve provider usage when available, even when the response is subsequently
rejected by runtime schema validation.

#### Correction

Model-call telemetry was changed so provider attempts are recorded independently
of whether their returned content passes runtime schema validation.

AI usage telemetry now preserves failed attempts and distinguishes failed calls
from successful calls.

#### Verification

Subsequent dogfood runs report failed provider attempts in AI Usage rather than
silently dropping them.

For example, runs containing a failed/retried model attempt reported both total
provider calls and failed-call counts.

---

### DF-F003 — TPM-aware preflight did not prevent avoidable rate-limit failure

**Category:** BUG / TOKEN-BUDGET CONTROL  
**Status:** RESOLVED

#### Observation

A subsequent dogfood run successfully completed structured risk assessment but
later became `BLOCKED` by an OpenAI TPM rate limit.

The provider reported:

- TPM limit: 30,000
- tokens already used: 17,053
- requested tokens: 14,560
- estimated remaining capacity: 12,947

QE Agent still dispatched the request even though requested token demand
exceeded estimated remaining TPM capacity.

The intended behavior is to detect temporarily infeasible requests before
dispatch where possible and reduce demand, defer, or block rather than issue a
known-infeasible request.

#### Correction

Throughput admission control was added so QE Agent can:

- learn the provider throughput limit;
- track estimated throughput consumption;
- classify temporary throughput exhaustion;
- reduce output reservation where appropriate;
- recalculate request demand;
- defer according to provider rate-limit timing; and
- refuse to dispatch a retry that remains infeasible.

#### Verification

Live dogfood rerun after the correction confirmed:

- provider throughput limit learned: 30,000 TPM;
- initial rate-limit condition classified as
  `THROUGHPUT_TEMPORARILY_EXHAUSTED`;
- QE deferred based on provider rate-limit timing;
- output reservation was reduced from 2,048 to 512 tokens;
- recalculated request demand was 10,564 tokens;
- available throughput was 829 tokens;
- QE blocked the request rather than dispatching an infeasible retry.

Result: DF-F003 throughput-admission correction verified.

---

### DF-F004 — Model-call counters use different semantics

**Category:** UX / TELEMETRY SEMANTICS  
**Status:** OPEN

#### Observation

One dogfood run reported:

Execution Metrics:

- Model calls: 2

AI Usage:

- Model calls: 3
- Failed calls: 2

The two metrics represent different concepts:

- Execution Metrics count logical orchestrator reasoning stages.
- AI Usage counts actual provider attempts, including failed attempts and
  retries.

The distinction is meaningful internally, but the human-readable report does
not make it sufficiently clear.

#### Expected Behavior

The report should use labels that make the two semantics explicit.

For example:

- `Logical reasoning calls: 2`
- `Provider attempts: 3`
- `Failed provider attempts: 2`

Users should not have to infer why two fields both named "Model calls" contain
different values.

#### Verification

Not yet verified by live dogfood.

---

### DF-F005 — Invalid generated tests can produce false product-failure verdicts

**Category:** BUG / TEST-GENERATION EVIDENCE INTEGRITY  
**Status:** RESOLVED

#### Observation

QE generated a test containing repository imports and symbols that did not
exist.

The generated test failed during module loading before any assertions executed.

Although the generated-test failure investigator classified the failure as
`TEST_DEFECT`, the resulting `FAIL` evidence was passed to verdict reasoning
without that classification.

QE consequently interpreted its own defective generated test as evidence of a
product defect and returned `FAIL` with `HIGH` confidence.

The defective generated test was also retained in the working tree because
retention was controlled by the model-provided test classification rather than
the deterministic execution/failure classification.

#### Root Cause

Generated-test failure classification was stored on the generated-test change
but was not propagated into canonical evidence consumed by verdict reasoning.

As a result:

- `TEST_DEFECT` information was lost before verdict formation;
- generated-test `FAIL` evidence was indistinguishable from genuine product
  failure evidence;
- no deterministic guardrail prevented a defective generated test from driving
  a product `FAIL`;
- test retention trusted model classification over deterministic execution
  results; and
- generated relative imports were not validated before execution.

#### Correction

The correction:

- added structured generated-test provenance to evidence;
- propagated generated-test failure classification;
- prevented `TEST_DEFECT` evidence from supporting a product `FAIL`;
- added a deterministic verdict guardrail;
- added static validation of generated relative imports;
- made deterministic `TEST_DEFECT` classification override model retention;
- automatically removes defective generated tests; and
- supplied bounded real source paths to test-generation reasoning.

#### Verification

Live dogfood rerun confirmed:

- hallucinated generated imports were detected before execution;
- generated-test evidence was marked `INCONCLUSIVE`;
- the invalid generated test did not drive a product `FAIL` verdict;
- the final verdict was `PASS_WITH_CONCERNS`;
- no generated-test residue remained in the working tree.

Result: DF-F005 generated-test evidence-integrity correction verified.

---

## Additional Corrections Discovered During DF-002

The following defects were discovered while resolving DF-002. They were
corrected as part of the dogfood stabilization work but are recorded here as
supporting corrections rather than separate DF-F findings.

### Requirement-count over-parsing

The requirements parser originally treated every `#`, `##`, and `###` heading
as an independent requirement.

For the QE Agent PRD this produced 166 requirements, although only 38 headings
represented functional requirements.

The parser now enters structured mode when `FR-NNN` headings are present:

- only FR-prefixed headings become requirements;
- FR identifiers are preserved;
- bullets remain acceptance criteria;
- nested headings beneath an FR become supporting acceptance criteria;
- unrelated document headings are ignored; and
- simple Markdown requirement documents retain the previous parsing behavior.

QE Agent PRD requirement count:

`166 → 38`

### Gap-analysis output truncation

Gap analysis originally used a hardcoded 2,048-token output ceiling.

For 38 requirement assessments this could truncate JSON output and surface as a
generic invalid-JSON error.

Gap-analysis output reservation is now sized according to requirement count:

`maxTokens = min(512 + 80 × requirementCount, 16384)`

For 38 requirements:

`512 + (80 × 38) = 3,552 tokens`

The OpenAI adapter also detects `finish_reason: "length"` and reports output
truncation explicitly.

### Retry and logical-call accounting

Provider retries were originally counted against both:

- the retry budget; and
- the logical model-call budget.

Retries are now tracked separately.

`maxModelCalls` represents orchestrator reasoning stages, while `maxRetries`
controls provider recovery attempts.

### Verdict budget reservation

Optional reasoning and execution stages could consume all remaining wall-clock
budget before mandatory verdict formation.

QE Agent now reserves capacity for verdict formation.

Optional model calls and optional command executions are skipped when they
would consume the verdict reserve.

### RETESTING lifecycle transition

When optional re-gap-analysis was skipped after `RETESTING`, the orchestrator
attempted the invalid transition:

`RETESTING → FORMING_VERDICT`

The lifecycle now explicitly permits this transition when re-analysis is
skipped because of budget constraints.

### Wall-clock budget enforcement

The quick profile has a 120-second wall-clock budget, but provider calls were
previously unbounded by that budget.

A model call could begin near the deadline and continue well beyond 120
seconds.

Provider-neutral request timeouts are now propagated through the model gateway.
Pre-verdict model calls preserve the verdict time reserve, and the verdict call
uses the remaining budget.

---

## Latest Dogfood Verification

The latest live DF-002 run completed with:

**Verdict:** `PASS_WITH_CONCERNS`  
**Confidence:** `MEDIUM`

Successful validation included:

- `npm run test`
- `npm run lint`
- `npm run typecheck`

Generated-test validation produced an `INCONCLUSIVE` result because the
generated test attempted to import nonexistent modules.

This was handled as a generated-test defect rather than a product defect.

No generated-test residue remained after the run.

The run completed through verdict formation rather than becoming `BLOCKED`.

---

## Remaining Concerns

DF-002 is now capable of completing a self-verification run, but the resulting
requirement coverage remains weak.

Most functional requirements are still reported as `NOT_VERIFIED`, primarily
because repository-level validation evidence is not yet mapped strongly enough
to individual product requirements.

The latest run also demonstrates that test generation can still hallucinate
repository APIs even though those hallucinations are now safely contained.

The next quality problem is therefore no longer basic execution robustness.
It is the quality and completeness of evidence acquisition and
requirement-to-evidence traceability.

DF-F004 also remains open because human-readable model-call metrics still use
ambiguous terminology.

---

## Finding Status

| Finding | Description | Status |
|---|---|---|
| DF-F001 | Invalid model output blocks risk assessment | RESOLVED |
| DF-F002 | Failed/schema-invalid calls missing from telemetry | RESOLVED |
| DF-F003 | TPM-aware admission control | RESOLVED |
| DF-F004 | Model-call counter semantics are ambiguous | OPEN |
| DF-F005 | Generated-test defect can cause false product FAIL | RESOLVED |

---

## Assessment

**PASS_WITH_CONCERNS**

DF-002 has progressed from an early schema-validation `BLOCKED` run to a
complete self-verification lifecycle that produces a verdict within its
execution budget.

The dogfood process exposed and drove corrections for structured-output
recovery, telemetry, throughput admission, requirement parsing, output
truncation, budget accounting, lifecycle transitions, wall-clock enforcement,
and generated-test evidence integrity.

The infrastructure is now substantially more robust.

However, self-verification still provides weak evidence for most functional
requirements. The primary remaining challenge is improving deterministic
evidence acquisition and requirement-to-evidence traceability rather than
continuing to harden the basic orchestration lifecycle.

DF-002 should therefore remain an active dogfood scenario, while its individual
findings are tracked independently according to the status table above.
