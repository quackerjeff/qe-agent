# Independent Review Assignment — Milestone 2: Safe Execution & Evidence

**Milestone:** 2  
**Review Type:** Independent implementation review  
**Target:** Safe Execution & Evidence  
**Implementation Specification:** `docs/milestones/milestone-2-safe-execution-evidence.md`

# Objective

Perform an independent review of the completed Milestone 2 implementation.

You are a reviewer, not the implementation agent.

Do not assume the implementation agent's completion report is correct.

Inspect the actual repository, implementation, tests, fixtures, configuration, and Git diff.

Do NOT modify code during this review.

# Required Reading

Before reviewing the implementation, read:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. all accepted ADRs under `docs/adr/`
5. `docs/milestones/milestone-2-safe-execution-evidence.md`
6. the Milestone 2 implementation report, if present
7. Milestone 1 review/correction records where useful for context

Treat the implementation report only as a claim.

Verify implementation behavior independently.

# Primary Review Question

Determine whether Milestone 2 reliably provides:

> **A controlled deterministic execution layer that can execute explicitly selected repository commands and produce trustworthy structured evidence without autonomous QE reasoning.**

# Critical Review Priorities

Pay particular attention to:

1. whether all project execution truly flows through the Execution Controller;
2. whether commands are structured rather than shell-interpolated;
3. whether working-directory confinement is real;
4. whether timeout/process cleanup is trustworthy;
5. whether secrets can leak;
6. whether evidence accurately represents what occurred;
7. whether Docker remains behind an execution abstraction;
8. whether Milestone 3 reasoning behavior has been introduced prematurely.

# Review Areas

## 1. Scope Compliance

Verify Milestone 2 does NOT implement:

- autonomous validation planning;
- autonomous command selection;
- risk reasoning;
- change-impact reasoning;
- test generation;
- failure-investigation loops;
- baseline comparison;
- verdict reasoning;
- Playwright/browser execution;
- project-memory updates;
- GitHub check publishing;
- GitHub issue creation;
- LLM-based execution decisions;
- multi-agent orchestration;
- SaaS infrastructure.

Explicitly identify any scope creep.

## 2. Execution Controller

Inspect the central `ExecutionController`.

Verify:

- every project-defined external command flows through it;
- policy checks occur before execution;
- executor selection occurs through the abstraction;
- working-directory validation occurs before execution;
- timeout is enforced;
- environment filtering occurs;
- output capture is normalized;
- secret redaction occurs before unsafe persistence/logging;
- execution results are converted to structured evidence.

Search the repository for all process execution mechanisms.

Examples include:

```text
spawn
exec
execFile
execSync
spawnSync
Bun.spawn
Deno.Command
shelljs
execa
```

Determine whether any project execution bypasses the controller.

Safe internal Git metadata execution may be treated separately if consistent with Milestone 1.

## 3. Structured Command Representation

Review command modeling.

Verify the primary execution path uses:

- executable;
- argument array;
- explicit working directory;
- explicit environment;
- explicit timeout;
- mutability classification;
- network policy.

Flag use of opaque shell command strings as the normal execution mechanism.

If shell execution exists at all, determine exactly where and why.

## 4. Shell Safety

Verify the executor does not enable shell interpolation by default.

Test command arguments containing shell metacharacters such as:

```text
;
&&
||
$()
`
>
<
*
```

They should be treated as literal arguments unless an explicitly approved shell execution mode exists.

Do not accept "we sanitize strings" as equivalent to structured process execution.

## 5. Working Directory Confinement

This is a critical area.

Verify commands cannot escape the approved repository/project boundary by using:

- `../`;
- absolute paths;
- symlink traversal;
- path normalization tricks.

Test at least:

```text
repository/subdir/../../outside
```

and a symlink inside the repository pointing outside it.

Determine whether real-path containment is checked.

If symlink protection is incomplete, classify the severity according to actual exploitability and documented guarantees.

## 6. Local Executor

Verify the local executor:

- captures stdout and stderr separately;
- preserves exit code;
- handles spawn errors;
- enforces timeouts;
- terminates child processes where practical;
- avoids unsafe shell behavior;
- limits output size;
- records executor metadata;
- controls environment inheritance.

Exercise both success and failure cases.

## 7. Timeout and Process Cleanup

This is another critical area.

Verify timeout behavior independently.

Use a controlled process that spawns a child process if fixtures support it.

Check whether:

- parent is terminated;
- child is terminated where practical;
- timeout status is recorded;
- partial output is preserved;
- evidence is `INCONCLUSIVE` rather than incorrectly treated as a test failure.

Flag implementations that kill only the immediate parent while obviously leaking child processes.

## 8. Output Limits

Verify stdout/stderr accumulation is bounded.

Test output exceeding the configured limit.

Verify:

- output truncates;
- truncation is explicitly recorded;
- the implementation does not accumulate unlimited output in memory before truncation;
- useful output is preserved.

If truncation happens only after buffering the entire stream, flag that.

## 9. Environment Filtering

Inspect environment construction.

Verify the child process does NOT automatically inherit the entire QE Agent environment.

Determine which variables are allowed through.

Look for accidental exposure of variables such as:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
AWS_SECRET_ACCESS_KEY
GITHUB_TOKEN
DATABASE_URL
```

unless explicitly supplied.

Check whether `PATH` and other runtime essentials are handled reasonably.

## 10. Secret Redaction

Test secret redaction directly.

Supply an explicit secret and make a fixture print it to:

- stdout;
- stderr.

Verify the raw value does not appear in:

- console/log output;
- `ExecutionResult`;
- evidence;
- persisted artifacts if any.

Also test repeated occurrence and partial surrounding text.

Determine whether redaction happens before or after logging.

Raw secrets must not be logged first and redacted later.

## 11. Policy Layer

Review deterministic execution policy.

Verify policy can represent:

```text
ALLOWED
DENIED
REQUIRES_APPROVAL
```

Check denial behavior for:

- outside-repository working directories;
- destructive commands;
- unauthorized write intent;
- invalid timeout;
- malformed executable;
- unsupported executor requests.

Avoid rewarding simplistic keyword blocking if architectural protections are weak.

Assess the policy in combination with structured execution, confinement, and isolation.

## 12. Dangerous Command Handling

Test representative obviously dangerous proposals.

Do not actually perform destructive actions.

Use policy-level tests or safe mocks where needed.

Review behavior around commands such as:

```text
rm -rf /
git reset --hard
git clean -fdx
shutdown
reboot
```

The goal is not perfect command classification.

The goal is that obvious dangerous proposals are not casually executed.

## 13. Mutability Classification

Review how:

```text
READ_ONLY
TEST_ARTIFACTS
REPOSITORY_WRITE
```

is represented and enforced.

Determine whether the policy actually uses mutability information or whether it is metadata only.

If enforcement is intentionally partial in Milestone 2, verify limitations are documented honestly.

## 14. Network Policy

Review:

```text
NONE
RESTRICTED
ALLOWED
```

Determine which modes are actually enforced.

Specifically:

- Does Docker `NONE` disable network access?
- Does local execution falsely claim network isolation when none exists?

Evidence/result metadata must distinguish requested policy from actually enforced isolation.

Flag misleading security claims.

## 15. Docker Executor Architecture

Verify Docker logic remains behind the executor abstraction.

Look for Docker-specific conditionals leaking into:

- orchestration;
- evidence logic;
- domain logic;
- CLI business logic.

Review:

- Docker availability detection;
- container invocation;
- mount behavior;
- working directory;
- environment handling;
- timeout;
- network behavior;
- cleanup;
- output capture.

Milestone 2 need not automatically build arbitrary application images.

## 16. Docker Absence

Verify Docker being unavailable does not break the entire QE Agent test suite.

Docker-dependent tests should:

- skip appropriately; or
- use deterministic test doubles.

`execution.mode=docker` should fail clearly when Docker is unavailable.

`auto` behavior should be documented and deterministic.

## 17. Evidence Model

This is a critical architectural area.

Verify every execution attempt produces evidence, including:

- allowed execution success;
- non-zero exit;
- timeout;
- spawn failure;
- policy denial, if the design models denied attempts as evidence.

Evidence should retain provenance including:

- command;
- arguments;
- purpose;
- working directory;
- executor;
- timestamps;
- duration;
- exit code;
- timeout;
- output truncation;
- secret redaction indicator where appropriate.

## 18. Evidence Meaning

Verify the system does NOT equate:

```text
exit code 0
```

with:

```text
QE PASS
```

A generic successful command should normally produce observational command evidence.

Build/test-specific actions may produce PASS only when action semantics justify that interpretation.

Test this explicitly.

## 19. Evidence Immutability

Inspect the Evidence Store and evidence object handling.

Verify stored evidence cannot be silently mutated afterward.

Test whether modifying an original object reference after `add()` changes stored evidence.

Also test whether retrieved references can mutate stored evidence.

The implementation may use:

- defensive copying;
- freezing;
- immutable structures.

The exact mechanism is less important than behavior.

## 20. Evidence Store Scope

Verify Milestone 2 has not prematurely implemented a large persistence system.

An in-memory store is acceptable.

If filesystem persistence was introduced, determine whether it was required or speculative.

Flag unnecessary historical-run infrastructure.

## 21. CLI Execution Surface

Review `qe exec` or equivalent.

Verify:

- it reinforces structured execution;
- it does not accidentally become `sh -c <anything>`;
- it clearly distinguishes explicit user-selected execution from autonomous QE;
- invalid proposals fail safely;
- exit behavior is sensible.

If discovered command IDs are executable, verify stable lookup and provenance.

## 22. Command ID Integration

If Milestone 1 discovered command IDs are used:

- verify IDs resolve to the intended command;
- verify repository context matches;
- verify stale or invalid IDs fail clearly;
- verify command execution still flows through policy.

Do not require persistent command catalogs unless implemented.

## 23. Logging

Verify execution logging includes useful correlation:

- QE execution ID;
- command execution ID;
- executor;
- duration;
- result.

Verify logs do not include raw secrets.

JSON/machine-readable CLI output should not be contaminated by logs where applicable.

## 24. Configuration

Review Milestone 2 config changes.

Verify:

- defaults are sensible;
- limits are bounded;
- invalid values fail clearly;
- unsupported claims are not implied;
- configuration remains small.

Flag speculative enterprise policy configuration.

## 25. Dependency Review

Review new dependencies.

Each should have a current Milestone 2 purpose.

Flag:

- process libraries introduced unnecessarily;
- Docker SDKs when simple CLI abstraction would suffice without benefit;
- agent frameworks;
- LLM SDKs;
- security frameworks far beyond current need;
- dependencies added only for later milestones.

## 26. Tests

Assess behavioral coverage, not just test count.

Look for tests covering:

- successful execution;
- non-zero exit;
- spawn failure;
- timeout;
- child cleanup;
- output truncation;
- stdout/stderr separation;
- environment filtering;
- secret redaction;
- directory traversal;
- symlink escape;
- policy denial;
- Docker available/unavailable;
- evidence creation;
- evidence immutability;
- generic exit-0 semantics;
- structured argument safety.

Flag important safety behavior covered only by mocks where a deterministic local integration test would be more meaningful.

## 27. Repository Hygiene

Check for:

- generated execution artifacts;
- Docker leftovers committed accidentally;
- secret-containing fixtures;
- ignored build output;
- `.qe/` handling;
- local agent state;
- temporary files.

## 28. Documentation Accuracy

Review README/docs claims about execution safety.

Flag language that implies:

- local execution is sandboxed;
- local network blocking is guaranteed when it is not;
- Docker provides complete security;
- destructive repository code cannot escape merely because commands are structured.

Documentation should state actual guarantees and limitations.

# Required Demonstrations

Independently exercise the following.

## Successful Local Execution

Execute a controlled fixture command.

Verify:

- exit 0;
- stdout captured;
- evidence generated.

## Non-Zero Execution

Execute a controlled failing fixture.

Verify:

- non-zero exit;
- stderr captured;
- evidence generated.

## Timeout

Execute a controlled long-running fixture.

Verify:

- timeout;
- process termination;
- correct evidence status.

## Secret Redaction

Pass an explicit secret to a fixture that prints it.

Verify the raw secret is absent everywhere user-visible or persisted.

## Output Truncation

Run a fixture producing output over the configured limit.

Verify truncation is bounded and recorded.

## Directory Escape

Attempt execution outside the allowed repository root.

Verify denial occurs before execution.

## Symlink Escape

Where platform support permits, create/use a safe test symlink pointing outside the repository and verify confinement behavior.

## Shell Metacharacters

Pass metacharacters as arguments and verify they are treated literally.

## Docker

If Docker is available:

- execute a controlled fixture;
- verify working-directory mount;
- verify output;
- verify cleanup;
- verify network policy behavior where implemented.

If Docker is unavailable:

- verify graceful handling.

# Required Validation

Run independently:

```text
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

Exercise the built CLI.

Do not rely only on the implementation report.

# Output Format

## Verdict

Choose exactly one:

- ACCEPT
- ACCEPT WITH MINOR CHANGES
- CHANGES REQUIRED
- REJECT

## Executive Assessment

Briefly explain the verdict.

## Acceptance Criteria

Evaluate every acceptance criterion in:

`docs/milestones/milestone-2-safe-execution-evidence.md`

Mark each:

- PASS
- PARTIAL
- FAIL

Explain every PARTIAL or FAIL.

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

Connect the issue to:

- safety;
- evidence integrity;
- architecture;
- correctness;
- milestone scope;
- maintainability.

**Recommended Correction**

Give a bounded recommendation.

Do not implement it.

## Architecture Assessment

Explicitly assess:

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

Also assess relevant rules in `AGENTS.md`.

## Execution Safety Assessment

State clearly:

- whether project execution can bypass the controller;
- whether shell interpolation is used;
- whether directory confinement is effective;
- whether child processes are cleaned up;
- whether environment exposure is controlled;
- whether secrets can leak;
- what network isolation is actually enforced.

## Evidence Integrity Assessment

Evaluate:

- evidence provenance;
- evidence semantics;
- immutability;
- correlation with actual execution;
- whether inference is being confused with execution.

## Docker Assessment

Evaluate Docker isolation behavior and abstraction quality separately from local execution.

## Scope Assessment

Identify any Milestone 3+ functionality introduced.

If none, explicitly state none.

## Test Assessment

Summarize meaningful safety/correctness coverage and important missing cases.

## Validation Results

Report commands actually executed and results.

## Recommended Actions Before Milestone 3

Separate into:

### Must Fix

Issues that should block Milestone 3.

### Should Fix

Important cleanup that does not necessarily block progression.

### Defer

Valid concerns that belong to later milestones.

## Final Recommendation

State whether Milestone 2 should be:

- accepted as-is;
- corrected and re-reviewed;
- substantially reworked.

Do not modify the repository.

Stop after producing the review.