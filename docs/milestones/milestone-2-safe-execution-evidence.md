# Implementation Assignment — Milestone 2: Safe Execution & Evidence

**Milestone:** 2  
**Status:** Accepted for Implementation  
**Depends On:** Milestone 1  
**Objective:** Introduce controlled command execution and immutable evidence capture without autonomous QE reasoning.

# Required Reading

Before making changes, read and follow:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. all accepted ADRs under `docs/adr/`
5. `docs/milestones/milestone-2-safe-execution-evidence.md`
6. Milestone 1 implementation/review records as needed

Milestone 1 is the accepted baseline.

Do not redesign prior milestones unless a genuine defect or architecture conflict requires it.

Do not begin Milestone 3.

# Objective

Build the deterministic execution and evidence layer that future QE reasoning will use.

At the end of Milestone 2, the QE Agent should be able to:

1. accept an explicitly selected discovered command;
2. evaluate that command against execution policy;
3. execute it through a controlled interface;
4. enforce timeout and process cleanup;
5. capture stdout, stderr, exit code, duration, and execution metadata;
6. redact known secrets from persisted/returned output;
7. convert execution results into structured immutable evidence;
8. support local execution;
9. support Docker execution where configured and available;
10. remain fully usable without any real LLM provider.

Milestone 2 does NOT decide which commands should be run autonomously.

# Core Principle

Milestone 1 answered:

> What appears to exist in this repository?

Milestone 2 answers:

> Can QE Agent execute an explicitly requested validation action safely enough to collect trustworthy evidence?

It does NOT yet answer:

> What should QE Agent choose to validate?

That belongs to Milestone 3.

# Required Implementation

## 1. Execution Controller

Implement the central `ExecutionController`.

All external project command execution SHALL flow through this component.

Conceptual interface:

```typescript
interface ExecutionController {
  execute(
    proposal: CommandProposal,
    context: ExecutionContext
  ): Promise<ExecutionResult>;
}
```

The exact implementation may differ if justified by existing domain models.

The Execution Controller SHALL own:

- policy validation;
- working-directory validation;
- timeout enforcement;
- environment filtering;
- executor selection;
- output capture;
- secret redaction;
- process cleanup;
- execution metadata;
- result normalization.

No project command may bypass this controller.

---

## 2. Structured Command Proposal

Commands SHALL be represented structurally rather than as opaque shell strings where practical.

A command proposal SHOULD include:

```typescript
interface CommandProposal {
  executable: string;
  args: string[];
  workingDirectory: string;
  environment?: Record<string, string>;
  timeoutMs: number;
  purpose: string;
  mutability:
    | "READ_ONLY"
    | "TEST_ARTIFACTS"
    | "REPOSITORY_WRITE";
  network:
    | "NONE"
    | "RESTRICTED"
    | "ALLOWED";
}
```

Review existing Milestone 0/1 schemas before adding duplicate types.

Prefer extending existing domain structures intentionally.

Avoid `shell: true` execution by default.

---

## 3. Execution Result

Create or refine a structured `ExecutionResult`.

At minimum include:

```text
execution ID
command identity
working directory
executor
start time
end time
duration
exit code
termination reason
stdout
stderr
timeout status
policy outcome
```

Termination reasons SHOULD distinguish at least:

```text
COMPLETED
TIMED_OUT
POLICY_DENIED
SPAWN_FAILED
TERMINATED
```

The result must not imply test success merely from successful process startup.

---

## 4. Local Executor

Implement a local execution adapter/provider.

The local executor SHALL:

- execute without shell interpolation by default;
- use explicit executable + argument arrays;
- capture stdout and stderr separately;
- enforce timeout;
- terminate the spawned process tree where practical;
- preserve exit code;
- report spawn failures clearly;
- avoid inheriting the entire parent environment blindly.

The local executor SHALL NOT contain QE reasoning.

---

## 5. Docker Executor

Implement Docker-backed execution as the initial isolated executor.

The Docker executor SHOULD support executing a repository command inside a container when:

- Docker is available;
- execution mode/configuration selects Docker;
- an appropriate image/runtime can be determined explicitly.

Milestone 2 does NOT require automatic environment synthesis for every ecosystem.

A minimal Docker implementation is acceptable if it can execute controlled fixture commands.

The Docker executor SHALL remain behind the execution abstraction.

Do not embed Docker logic into the core orchestrator.

---

## 6. Execution Mode Selection

Support the configured execution modes:

```text
local
docker
auto
```

For Milestone 2:

### local

Use the local executor.

### docker

Require Docker execution and fail clearly if unavailable.

### auto

Use simple deterministic selection.

Do not build complex environment reasoning.

A reasonable initial policy is:

1. honor explicit project configuration;
2. if Docker execution is explicitly supported/configured, prefer Docker;
3. otherwise use local execution.

Document the exact behavior.

---

## 7. Working Directory Confinement

Execution SHALL be confined to the repository/project root or approved subdirectories.

Prevent command proposals from using:

```text
../../outside-project
/
user home directories
arbitrary absolute paths
```

unless explicitly permitted by policy.

Resolve real paths before execution.

Protect against straightforward traversal.

Consider symlinks when validating containment.

Do not claim complete sandbox isolation from filesystem confinement alone.

---

## 8. Environment Filtering

Do not automatically expose the complete QE Agent process environment to executed repository code.

Implement an allowlist-based or explicitly constructed execution environment.

At minimum preserve variables required for normal process execution, such as platform-specific path/runtime essentials.

Project-specific environment variables should be passed explicitly.

The model layer is not involved in this milestone.

---

## 9. Secret Handling

Implement secret redaction for execution output and persisted evidence.

At minimum support redaction of explicitly provided secret values.

For example, if execution context identifies:

```text
API_TOKEN=<secret>
```

then occurrences of the value in stdout/stderr must be replaced before:

- logging;
- evidence creation;
- report return;
- persistence.

Use a stable replacement such as:

```text
[REDACTED]
```

Do not persist raw secret values.

Do not attempt to build a complete secret-detection platform.

---

## 10. Command Policy

Implement deterministic execution policy checks.

At minimum, policy SHALL evaluate:

- executable;
- arguments;
- working directory;
- requested mutability;
- network policy;
- timeout;
- executor mode.

Introduce a clear policy result:

```text
ALLOWED
DENIED
REQUIRES_APPROVAL
```

For MVP automation, `REQUIRES_APPROVAL` may initially be treated as denied unless explicit approval is available.

---

## 11. Dangerous Command Protection

Add protections against obviously destructive execution requests.

Examples worth blocking or requiring approval include commands intended to:

```text
delete broad filesystem trees
format disks
shutdown/reboot systems
modify users/system configuration
write outside repository boundaries
perform destructive Git operations
```

Do not attempt to create a perfect shell-security engine.

The strongest protection remains:

- no shell by default;
- structured executable/args;
- path confinement;
- executor isolation;
- explicit mutability;
- policy checks.

Document that arbitrary code executed through an allowed test command can still be dangerous in local mode.

---

## 12. Network Policy Representation

Preserve the network policy in execution context/results.

Milestone 2 SHOULD enforce `NONE` in Docker where reasonably practical.

Local-mode network enforcement MAY be limited by platform capabilities.

Do not falsely claim network isolation where it is not actually enforced.

If local network restriction cannot be technically enforced, record that limitation explicitly in execution metadata.

---

## 13. Timeout Enforcement

Every external command SHALL have a timeout.

No project command may execute indefinitely.

When timeout occurs:

1. mark the result as timed out;
2. terminate the process;
3. terminate child processes where practical;
4. preserve output collected before termination;
5. create evidence reflecting timeout rather than test failure.

Add tests using controlled fixture commands that intentionally sleep beyond the timeout.

---

## 14. Output Limits

Prevent unlimited stdout/stderr accumulation.

Implement configurable or internal output-size limits.

When output is truncated:

- preserve beginning/end as useful;
- mark output as truncated;
- retain metadata indicating the original stream exceeded the limit.

Do not silently discard the fact that truncation occurred.

---

## 15. Evidence Store

Implement the Milestone 2 Evidence Store abstraction.

Evidence SHALL be immutable after creation.

Conceptual interface:

```typescript
interface EvidenceStore {
  add(evidence: Evidence): Promise<void>;
  get(id: string): Promise<Evidence | undefined>;
  list(): Promise<Evidence[]>;
}
```

A simple in-memory implementation is acceptable for Milestone 2 if consistent with the system design.

Do NOT implement full persistent QE run history yet.

---

## 16. Execution Evidence

Every completed execution attempt SHALL produce evidence.

Evidence SHOULD distinguish:

```text
PASS
FAIL
OBSERVED
INCONCLUSIVE
```

Examples:

### Successful generic command

Exit code 0 does not necessarily mean software correctness.

Evidence may be:

```text
type: COMMAND_RESULT
status: OBSERVED
```

### Known build action

A build command exiting 0 may become:

```text
type: BUILD_RESULT
status: PASS
```

if the validation action explicitly identifies it as a build.

### Timed out command

```text
type: COMMAND_RESULT
status: INCONCLUSIVE
```

Do not collapse all exit code 0 results into QE PASS.

---

## 17. Evidence Provenance

Execution evidence SHALL include enough provenance to answer:

- what command ran;
- why it ran;
- which executor ran it;
- from which working directory;
- against which repository/revision if available;
- when it ran;
- for how long;
- what exit code occurred;
- whether output was truncated;
- whether secrets were redacted;
- whether timeout occurred.

Do not store only human prose.

---

## 18. Evidence Immutability

Evidence objects SHALL not be mutated after storage.

If interpretation changes later, create a finding or analysis object referring to the original evidence.

Do not rewrite historical execution evidence to match later reasoning.

---

## 19. CLI Execution Command

Introduce a minimal explicit command for exercising the execution layer.

Recommended:

```text
qe exec
```

or another clearly named internal/developer-facing command.

Example conceptual use:

```text
qe exec -- npm test
```

However, avoid accepting raw opaque shell pipelines.

A safer initial interface may be:

```text
qe exec --command npm --arg test
```

or execution by discovered command ID if Milestone 1 exposes stable IDs.

Prefer a design that reinforces structured execution.

This CLI exists primarily to demonstrate and test Milestone 2.

It is NOT autonomous QE behavior.

---

## 20. Discovered Command Execution

If practical, allow execution of a command discovered in Milestone 1 by command ID.

Example conceptual flow:

```text
qe analyze --json
→ command id: test:npm:test

qe exec --command-id test:npm:test
```

This is preferable to retyping raw commands if it fits cleanly with the current architecture.

Do not over-engineer persistent command catalogs.

---

## 21. Execution Profile Integration

Reuse the existing execution budget/profile configuration where appropriate.

Milestone 2 need not implement full Quick/Standard/Deep reasoning behavior.

It SHOULD honor:

```text
max execution duration
per-command timeout
retry limit if explicitly used
```

No autonomous retries are required yet.

---

## 22. No Automatic Command Selection

Milestone 2 SHALL NOT autonomously decide:

```text
which tests to run
which build command to run
whether a command is worth running
whether browser validation is needed
```

The command/action must be explicitly selected by:

- CLI input;
- test fixture;
- deterministic integration test;
- direct API call.

Autonomous selection belongs to Milestone 3.

---

## 23. No LLM Requirement

Milestone 2 SHALL work with no real LLM provider.

Do not add OpenAI, Anthropic, or other model SDKs.

Do not call the Model Gateway to approve or interpret execution.

---

## 24. Test Result Parsing

Implement only minimal result classification needed to normalize command/build/test execution evidence.

Do NOT build broad test-framework parsers yet unless needed for one clearly defined fixture.

Detailed framework result parsing can evolve later.

Milestone 2 is primarily about safe execution and evidence capture, not test semantics.

---

## 25. Fixture Expansion

Add controlled execution fixtures.

At minimum include safe fixtures for:

```text
successful command
non-zero exit
timeout
stdout/stderr capture
large output truncation
secret redaction
working-directory confinement
policy denial
```

Use tiny deterministic scripts.

Fixtures must not require network access.

If Docker tests are included, structure them so local test suites can skip them cleanly when Docker is unavailable.

---

## 26. Local Executor Tests

Add automated tests proving:

- success result;
- non-zero exit result;
- stdout capture;
- stderr capture;
- timeout;
- process cleanup where practical;
- working-directory enforcement;
- environment filtering;
- secret redaction;
- output truncation;
- spawn failure.

---

## 27. Docker Executor Tests

Add tests for:

- Docker availability detection;
- successful container execution where Docker exists;
- clear failure/skip behavior where Docker does not exist;
- mounted repository working directory;
- timeout behavior;
- environment handling;
- output capture.

Do not make the entire test suite require Docker.

---

## 28. Policy Tests

Add deterministic policy tests.

At minimum verify denial of:

- working directory outside repository;
- obviously destructive command proposals;
- excessive timeout requests;
- invalid executable representation;
- unauthorized repository writes where policy forbids them.

Avoid tests that depend on arbitrary string keyword matching alone.

---

## 29. Evidence Tests

Add tests proving:

- every execution creates evidence;
- evidence includes provenance;
- evidence is immutable;
- redacted output is what reaches the evidence object;
- timeout creates inconclusive evidence;
- exit code 0 generic commands do not automatically become QE PASS.

---

## 30. Observability

Integrate execution IDs with logging.

Execution logs SHOULD correlate:

```text
QE execution ID
command execution ID
executor
duration
result
```

Do not introduce external observability infrastructure.

Logs must not contain unredacted secrets.

---

## 31. Configuration

Extend `.qe/config.yml` only as necessary.

Relevant existing fields may include:

```yaml
execution:
  mode: auto
  maxMinutes: 20
```

If additional Milestone 2 config is required, keep it small.

Possible additions:

```yaml
execution:
  commandTimeoutSeconds: 300
  maxOutputBytes: 1048576
```

Do not add speculative enterprise policy configuration.

---

## 32. Documentation

Update README and relevant docs to describe:

- local execution;
- Docker execution;
- execution safety limitations;
- `qe exec` or equivalent;
- secret redaction;
- timeout behavior;
- evidence generation;
- fact that Milestone 2 still does not autonomously select validation actions.

Be explicit that local execution of repository code is not equivalent to a secure sandbox.

# Architecture Constraints

Preserve all accepted architecture.

Especially:

- all project execution goes through Execution Controller;
- deterministic execution is separate from AI reasoning;
- execution evidence is first-class;
- evidence is immutable;
- GitHub is not part of the core execution architecture;
- local and Docker executors are adapters/providers;
- no direct LLM provider dependency;
- no multi-agent orchestration;
- no production-source modification behavior.

# Do Not Implement Yet

Do NOT implement:

- autonomous validation planning;
- risk reasoning;
- change-impact reasoning;
- automatic test selection;
- test generation;
- failure investigation loops;
- baseline comparison;
- browser execution through Playwright;
- application startup orchestration beyond what is strictly required for execution fixtures;
- verdict generation;
- project-memory updates;
- GitHub check publishing;
- GitHub issue creation;
- SaaS infrastructure;
- multi-agent orchestration.

# Acceptance Criteria

Milestone 2 is complete when all of the following are true:

1. All project command execution flows through `ExecutionController`.
2. Commands are represented structurally rather than primarily as opaque shell strings.
3. Local execution works.
4. Docker execution exists behind the execution abstraction.
5. Docker absence is handled gracefully.
6. Working-directory confinement is enforced.
7. External commands have timeouts.
8. Timed-out process trees are terminated where practical.
9. stdout and stderr are captured separately.
10. output-size limits are enforced and truncation is reported.
11. environment exposure is controlled rather than blindly inherited.
12. explicitly supplied secrets are redacted from logs/results/evidence.
13. deterministic command policy can allow or deny execution.
14. dangerous/out-of-bound proposals can be denied.
15. every execution attempt produces structured evidence.
16. evidence records provenance.
17. evidence is immutable after storage.
18. generic exit code 0 does not automatically become QE PASS.
19. no autonomous command selection exists.
20. no real LLM provider is required.
21. tests do not require network access.
22. Docker-specific tests can skip cleanly if Docker is unavailable.
23. build passes.
24. tests pass.
25. lint passes.
26. formatting checks pass.
27. type checking passes.
28. no Milestone 3 functionality is unnecessarily implemented.

# Required Demonstrations

## Successful Local Execution

Demonstrate a safe fixture command that:

- executes locally;
- exits 0;
- captures stdout;
- produces evidence.

## Failing Local Execution

Demonstrate a safe fixture command that:

- exits non-zero;
- captures stderr;
- produces evidence reflecting failure.

## Timeout

Demonstrate a fixture command exceeding the configured timeout.

Verify:

- termination;
- timeout metadata;
- inconclusive evidence.

## Secret Redaction

Execute a fixture command that prints an explicitly supplied secret.

Verify the secret does not appear in:

- terminal/log output;
- returned execution result;
- evidence.

## Working Directory Denial

Demonstrate a proposal attempting execution outside the repository boundary.

Verify it is denied before execution.

## Docker

Where Docker is available, demonstrate a safe containerized fixture command.

Where Docker is unavailable, demonstrate clear graceful handling.

# Completion Report

When finished, provide:

## Implemented

Summarize execution and evidence capabilities.

## Execution Architecture

Describe:

- Execution Controller;
- local executor;
- Docker executor;
- policy layer;
- environment handling;
- timeout/process cleanup;
- output limits.

## Evidence Architecture

Describe:

- evidence creation;
- provenance;
- immutability;
- Evidence Store.

## Security Boundaries

Describe what Milestone 2 does and does not protect against.

Be explicit about local execution limitations.

## Demonstrations

Provide results for all required demonstrations.

## Tests

Summarize meaningful behavioral tests.

Do not report only total test count.

## Validation

Run and report:

```text
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

## Repository Changes

List important files/directories added or modified.

## Schema Changes

Describe domain/config schema changes and why they were necessary.

## Dependencies Added

List dependencies introduced during Milestone 2 and justify each one.

## Deviations

Identify any deviation from:

- PRD;
- Technical Product Specification;
- `AGENTS.md`;
- accepted ADRs.

If none, explicitly state none.

## Deferred

List functionality intentionally deferred to Milestone 3 or later.

## Concerns

Identify architectural or safety concerns that should be reviewed before Milestone 3.

## Scope Confirmation

Explicitly confirm that Milestone 3 reasoning behavior was not implemented.

Stop after completing Milestone 2.

Do not begin Milestone 3.