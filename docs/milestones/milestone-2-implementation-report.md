  Milestone 2 Completion Report: Safe Execution & Evidence

  Implemented

  The QE Agent now has a complete deterministic execution and evidence layer. It can:

  1. Accept explicitly selected commands (via CLI --command or --command-id)
  2. Evaluate commands against deterministic execution policy
  3. Execute through a controlled interface (local or Docker)
  4. Enforce timeouts and terminate process trees
  5. Capture stdout, stderr, exit code, duration, and execution metadata separately
  6. Redact known secrets from all output, logs, and evidence
  7. Convert execution results into structured immutable evidence
  8. Support local execution (child_process.spawn, no shell)
  9. Support Docker execution behind the same abstraction
  10. Operate without any LLM provider

  No autonomous command selection was implemented.

  Execution Architecture

  Execution Controller (src/execution/controller.ts)

  Central component through which ALL project command execution flows. Owns: policy validation, executor selection, execution dispatch, evidence creation and storage. Returns {result, evidence} tuple.
  Policy-denied proposals produce a synthetic POLICY_DENIED result without spawning any process.

  Local Executor (src/execution/local-executor.ts)

  Implements the Executor interface. Uses child_process.spawn with shell: false and detached: true. Environment is allowlist-filtered (PATH, HOME, USER, LANG, TERM, TMPDIR, and ~20 platform essentials).
  Proposal-specified environment variables are merged on top. Timeouts kill the entire process group via process.kill(-child.pid, 'SIGKILL'). Output is captured separately (stdout/stderr), secrets are redacted,
  then truncation is applied preserving head+tail with a truncation marker.

  Docker Executor (src/execution/docker-executor.ts)

  Implements the Executor interface. Checks Docker availability via docker info. Mounts repository read-only at /workspace. Applies --network none when network policy is NONE (actually enforced by Docker).
  Environment variables passed via -e. Same timeout/truncation/redaction pipeline as local. Reports networkPolicyEnforced: true when Docker enforces network isolation.

  Policy Layer (src/execution/policy.ts)

  Deterministic policy evaluation. Checks: empty executable, dangerous executables (rm, mkfs, dd, shutdown, reboot, halt, poweroff, passwd, chown, chmod, mount, umount, fdisk, mkswap, wipefs), destructive git
  subcommands (push, reset, clean, checkout), working-directory confinement (realpath-based, prevents traversal and symlink bypass), excessive timeout (>30min), REPOSITORY_WRITE+ALLOWED network →
  REQUIRES_APPROVAL.

  Environment Handling

  Allowlist-based: only ~25 platform-essential variables are inherited from the parent process. Project-specific variables must be passed explicitly via proposal.environment. This prevents accidental leakage of
  QE Agent credentials, API keys, or CI tokens.

  Timeout / Process Cleanup

  Every command has a mandatory timeout. When timeout fires, the entire process group is killed with SIGKILL (via process.kill(-child.pid, 'SIGKILL') using detached process groups). Output captured before
  termination is preserved. The result is marked timedOut: true with terminationReason: "TIMED_OUT".

  Output Limits

  Configurable maxOutputBytes (default 1MB). When exceeded, output is truncated preserving head and tail with marker: --- OUTPUT TRUNCATED (N bytes, limit M) ---. The truncated.stdout / truncated.stderr flags
  record whether truncation occurred.

  Evidence Architecture

  Evidence Creation (src/execution/evidence-factory.ts)

  createExecutionEvidence(result, commandCategory?) converts an ExecutionResult into an Evidence object. Type mapping: TEST→TEST_RESULT, BUILD→BUILD_RESULT, LINT/TYPECHECK follow similarly,
  default→COMMAND_RESULT. Status: TIMED_OUT/SPAWN_FAILED/POLICY_DENIED→INCONCLUSIVE; TEST/BUILD/LINT/TYPECHECK with exit 0→PASS, else→FAIL; generic commands→OBSERVED. Evidence includes full execution metadata as
  details.

  Provenance

  Every evidence object records: what command ran (executable, args), which executor ran it (local/docker), working directory, start/end time, duration, exit code, termination reason, whether output was
  truncated, whether secrets were redacted, whether timeout occurred, policy outcome, network policy enforcement status.

  Immutability (src/execution/evidence-store.ts)

  InMemoryEvidenceStore uses Object.freeze() on stored evidence. Rejects duplicate evidence IDs with an error. Evidence objects cannot be mutated after storage.

  Evidence Store

  Simple in-memory implementation with add(evidence), get(id), list() interface. Consistent with the system design's requirement for Milestone 2.

  Security Boundaries

  What Milestone 2 protects against:

  - Accidental execution outside the repository directory (working-directory confinement via realpath)
  - Obviously destructive commands (rm, mkfs, dd, shutdown, destructive git ops)
  - Blind environment inheritance (allowlist filtering)
  - Secret leakage in output/logs/evidence (value-based redaction)
  - Unbounded execution time (mandatory timeouts with process group termination)
  - Unbounded output accumulation (configurable truncation with metadata)
  - Shell injection via interpolation (shell: false by default)
  - Docker network leakage when network: NONE (Docker enforces this)

  What Milestone 2 does NOT protect against:

  - Arbitrary code executed through an allowed command can still be dangerous in local mode. Repository code runs with the QE Agent's OS privileges. A test suite could read/write files outside the repo, make
  network calls, or perform any operation the user can.
  - Symlink races or TOCTOU attacks on working-directory validation
  - Docker container escapes
  - Side-channel information leakage
  - Commands that embed secrets in filenames or process titles (only stdout/stderr/log redaction)
  - Secret values that appear in different encodings or partial forms

  Local execution of repository code is not equivalent to a secure sandbox. Docker with --network none provides stronger but not complete isolation.

  Demonstrations

  Demo 1: Successful Local Execution

  Command: /bin/sh fixtures/exec-scripts/success.sh
  Exit code: 0
  stdout: "hello from success"
  Termination: COMPLETED
  Evidence: OBSERVED (type: COMMAND_RESULT)

  Demo 2: Failing Local Execution

  Command: /bin/sh fixtures/exec-scripts/fail.sh
  Exit code: 1
  stderr: "this is an error"
  Termination: COMPLETED
  9. Support Docker execution behind the same abstraction
  10. Operate without any LLM provider

  No autonomous command selection was implemented.

  Execution Architecture

  Execution Controller (src/execution/controller.ts)

  Central component through which ALL project command execution flows. Owns: policy validation, executor selection, execution dispatch, evidence creation and storage. Returns {result, evidence} tuple.
  Policy-denied proposals produce a synthetic POLICY_DENIED result without spawning any process.

  Local Executor (src/execution/local-executor.ts)

  Implements the Executor interface. Uses child_process.spawn with shell: false and detached: true. Environment is allowlist-filtered (PATH, HOME, USER, LANG, TERM, TMPDIR, and ~20 platform essentials).
  Proposal-specified environment variables are merged on top. Timeouts kill the entire process group via process.kill(-child.pid, 'SIGKILL'). Output is captured separately (stdout/stderr), secrets are redacted,
  then truncation is applied preserving head+tail with a truncation marker.

  Docker Executor (src/execution/docker-executor.ts)

  Implements the Executor interface. Checks Docker availability via docker info. Mounts repository read-only at /workspace. Applies --network none when network policy is NONE (actually enforced by Docker).
  Environment variables passed via -e. Same timeout/truncation/redaction pipeline as local. Reports networkPolicyEnforced: true when Docker enforces network isolation.

  Policy Layer (src/execution/policy.ts)

  Deterministic policy evaluation. Checks: empty executable, dangerous executables (rm, mkfs, dd, shutdown, reboot, halt, poweroff, passwd, chown, chmod, mount, umount, fdisk, mkswap, wipefs), destructive git
  subcommands (push, reset, clean, checkout), working-directory confinement (realpath-based, prevents traversal and symlink bypass), excessive timeout (>30min), REPOSITORY_WRITE+ALLOWED network →
  REQUIRES_APPROVAL.

  Environment Handling

  Allowlist-based: only ~25 platform-essential variables are inherited from the parent process. Project-specific variables must be passed explicitly via proposal.environment. This prevents accidental leakage of
  QE Agent credentials, API keys, or CI tokens.

  Timeout / Process Cleanup

  Every command has a mandatory timeout. When timeout fires, the entire process group is killed with SIGKILL (via process.kill(-child.pid, 'SIGKILL') using detached process groups). Output captured before
  termination is preserved. The result is marked timedOut: true with terminationReason: "TIMED_OUT".

  Output Limits

  Configurable maxOutputBytes (default 1MB). When exceeded, output is truncated preserving head and tail with marker: --- OUTPUT TRUNCATED (N bytes, limit M) ---. The truncated.stdout / truncated.stderr flags
  record whether truncation occurred.

  Evidence Architecture

  Evidence Creation (src/execution/evidence-factory.ts)

  createExecutionEvidence(result, commandCategory?) converts an ExecutionResult into an Evidence object. Type mapping: TEST→TEST_RESULT, BUILD→BUILD_RESULT, LINT/TYPECHECK follow similarly,
  default→COMMAND_RESULT. Status: TIMED_OUT/SPAWN_FAILED/POLICY_DENIED→INCONCLUSIVE; TEST/BUILD/LINT/TYPECHECK with exit 0→PASS, else→FAIL; generic commands→OBSERVED. Evidence includes full execution metadata as
  details.

  Provenance

  Docker Executor (2 tests):
  - Availability detection (boolean result)
  - Graceful unavailability handling in controller (throws clear error)

  Command Policy (7 tests):
  - Normal commands within repository → ALLOWED
  - Working directory outside repository → DENIED
  - Dangerous executables → DENIED
  - Excessive timeout → DENIED
  - Empty executable → DENIED
  - Destructive git operations → DENIED
  - Write + network → REQUIRES_APPROVAL

  Secret Redactor (4 tests):
  - Redacts known secret values
  - Redacts multiple occurrences
  - Handles multiple different secrets
  - Ignores empty secrets

  Evidence (9 tests):
  - Every execution creates evidence
  - Evidence includes provenance (command, executor, duration, timing)
  - Evidence is immutable (duplicate ID rejection)
  - Redacted output reaches evidence (no raw secrets)
  - Timeout creates inconclusive evidence
  - Exit code 0 generic command → OBSERVED (not PASS)
  - Exit code 0 TEST command → PASS
  - Exit code 1 TEST command → FAIL
  - Policy denial creates evidence with INCONCLUSIVE status

  Validation

  ┌──────────────────────┬───────────────────────────┐
  │        Check         │          Result           │
  ├──────────────────────┼───────────────────────────┤
  │ npm run build        │ Pass                      │
  ├──────────────────────┼───────────────────────────┤
  │ npm test             │ 174 tests pass (10 files) │
  ├──────────────────────┼───────────────────────────┤
  │ npm run lint         │ Pass                      │
  ├──────────────────────┼───────────────────────────┤
  │ npm run forma[118;1:3ut:check │ Pass                      │
  ├──────────────────────┼───────────────────────────┤
  │ npm run typecheck    │ Pass                      │
  └──────────────────────┴───────────────────────────┘

  Repository Changes

  New Files

  ┌───────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │                 File                  │                                             Purpose                                              │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/types.ts                │ Core domain types: CommandProposal, ExecutionResult, ExecutionContext, enums, Executor interface │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/policy.ts               │ Deterministic command policy evaluation                                                          │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/secret-redactor.ts      │ Secret value redaction                                                                           │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/local-executor.ts       │ Local process execution with spawn, env filtering, output handling                               │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/docker-executor.ts      │ Docker container execution adapter                                                               │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/evidence-store.ts       │ InMemoryEvidenceStore with immutability                                                          │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/evidence-factory.ts     │ ExecutionResult → Evidence conversion                                                            │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/controller.ts           │ ExecutionController — central execution orchestrator                                             │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/index.ts                │ Module re-exports                                                                                │
  9. Support Docker execution behind the same abstraction
  10. Operate without any LLM provider

  No autonomous command selection was implemented.

  Execution Architecture

  Execution Controller (src/execution/controller.ts)

  Central component through which ALL project command execution flows. Owns: policy validation, executor selection, execution dispatch, evidence creation and storage. Returns {result, evidence} tuple.
  Policy-denied proposals produce a synthetic POLICY_DENIED result without spawning any process.

  Local Executor (src/execution/local-executor.ts)

  Implements the Executor interface. Uses child_process.spawn with shell: false and detached: true. Environment is allowlist-filtered (PATH, HOME, USER, LANG, TERM, TMPDIR, and ~20 platform essentials).
  Proposal-specified environment variables are merged on top. Timeouts kill the entire process group via process.kill(-child.pid, 'SIGKILL'). Output is captured separately (stdout/stderr), secrets are redacted,
  then truncation is applied preserving head+tail with a truncation marker.

  Docker Executor (src/execution/docker-executor.ts)

  Implements the Executor interface. Checks Docker availability via docker info. Mounts repository read-only at /workspace. Applies --network none when network policy is NONE (actually enforced by Docker).
  Environment variables passed via -e. Same timeout/truncation/redaction pipeline as local. Reports networkPolicyEnforced: true when Docker enforces network isolation.

  Policy Layer (src/execution/policy.ts)

  Deterministic policy evaluation. Checks: empty executable, dangerous executables (rm, mkfs, dd, shutdown, reboot, halt, poweroff, passwd, chown, chmod, mount, umount, fdisk, mkswap, wipefs), destructive git
  subcommands (push, reset, clean, checkout), working-directory confinement (realpath-based, prevents traversal and symlink bypass), excessive timeout (>30min), REPOSITORY_WRITE+ALLOWED network →
  REQUIRES_APPROVAL.

  Environment Handling

  Allowlist-based: only ~25 platform-essential variables are inherited from the parent process. Project-specific variables must be passed explicitly via proposal.environment. This prevents accidental leakage of
  QE Agent credentials, API keys, or CI tokens.

  Timeout / Process Cleanup

  Every command has a mandatory timeout. When timeout fires, the entire process group is killed with SIGKILL (via process.kill(-child.pid, 'SIGKILL') using detached process groups). Output captured before
  termination is preserved. The result is marked timedOut: true with terminationReason: "TIMED_OUT".

  Output Limits

  Configurable maxOutputBytes (default 1MB). When exceeded, output is truncated preserving head and tail with marker: --- OUTPUT TRUNCATED (N bytes, limit M) ---. The truncated.stdout / truncated.stderr flags
  record whether truncation occurred.

  Evidence Architecture

  Evidence Creation (src/execution/evidence-factory.ts)

  createExecutionEvidence(result, commandCategory?) converts an ExecutionResult into an Evidence object. Type mapping: TEST→TEST_RESULT, BUILD→BUILD_RESULT, LINT/TYPECHECK follow similarly,
  default→COMMAND_RESULT. Status: TIMED_OUT/SPAWN_FAILED/POLICY_DENIED→INCONCLUSIVE; TEST/BUILD/LINT/TYPECHECK with exit 0→PASS, else→FAIL; generic commands→OBSERVED. Evidence includes full execution metadata as
  details.

  Provenance

  Every evidence object records: what command ran (executable, args), which executor ran it (local/docker), working directory, start/end time, duration, exit code, termination reason, whether output was
  truncated, whether secrets were redacted, whether timeout occurred, policy outcome, network policy enforcement status.

  Immutability (src/execution/evidence-store.ts)

  InMemoryEvidenceStore uses Object.freeze() on stored evidence. Rejects duplicate evidence IDs with an error. Evidence objects cannot be mutated after storage.

  Evidence Store

  Simple in-memory implementation with add(evidence), get(id), list() interface. Consistent with the system design's requirement for Milestone 2.

  Security Boundaries

  What Milestone 2 protects against:

  - Accidental execution outside the repository directory (working-directory confinement via realpath)
  - Obviously destructive commands (rm, mkfs, dd, shutdown, destructive git ops)
  - Blind environment inheritance (allowlist filtering)
  - Secret leakage in output/logs/evidence (value-based redaction)
  - Unbounded execution time (mandatory timeouts with process group termination)
  - Unbounded output accumulation (configurable truncation with metadata)
  - Shell injection via interpolation (shell: false by default)
  - Docker network leakage when network: NONE (Docker enforces this)

  What Milestone 2 does NOT protect against:

  - Arbitrary code executed through an allowed command can still be dangerous in local mode. Repository code runs with the QE Agent's OS privileges. A test suite could read/write files outside the repo, make
  network calls, or perform any operation the user can.
  - Symlink races or TOCTOU attacks on working-directory validation
  - Docker container escapes
  - Side-channel information leakage
  - Commands that embed secrets in filenames or process titles (only stdout/stderr/log redaction)
  - Secret values that appear in different encodings or partial forms

  Local execution of repository code is not equivalent to a secure sandbox. Docker with --network none provides stronger but not complete isolation.

  Demonstrations

  Demo 1: Successful Local Execution

  Command: /bin/sh fixtures/exec-scripts/success.sh
  Exit code: 0
  stdout: "hello from success"
  Termination: COMPLETED
  Evidence: OBSERVED (type: COMMAND_RESULT)

  Demo 2: Failing Local Execution

  Command: /bin/sh fixtures/exec-scripts/fail.sh
  Exit code: 1
  stderr: "this is an error"
  Termination: COMPLETED
  Evidence: OBSERVED (type: COMMAND_RESULT)

  Demo 3: Timeout

  Command: /bin/sh fixtures/exec-scripts/slow.sh (timeout: 2s)
  Exit code: null
  Termination: TIMED_OUT
  timedOut: true
  Evidence: INCONCLUSIVE

  Demo 4: Secret Redaction

  Command: /bin/sh fixtures/exec-scripts/echo-secret.sh
  Secret: "my-secret-api-key-12345"
  stdout: "token=[REDACTED]"
  stderr: "also stderr token=[REDACTED]"
  secretsRedacted: true
  Secret in full JSON output? false
  Secret in evidence? false

  Demo 5: Working Directory Denial

  Requested workingDirectory: /tmp
  Repository root: /Users/jeffrey/Development/qe-agent
  terminationReason: POLICY_DENIED
  policyOutcome: DENIED
  stderr: "Policy denied: Working directory '/tmp' is outside repository root"
  Evidence: INCONCLUSIVE
  Process spawned? NO (blocked by policy)

  Demo 6: Docker Execution

  Docker available: true
  Executor: docker
  Command: /bin/echo "hello from docker"
  stdout: "hello from docker"
  exitCode: 0
  networkPolicyEnforced: true
  Evidence: OBSERVED

  Tests

  174 tests pass across 10 test files.

  Execution Tests (tests/execution.test.ts) — 33 tests

  Local Executor (11 tests):
  - Successful command execution (exit 0, stdout captured)
  - Non-zero exit code capture
  - Stdout captured separately from stderr
  - Stderr captured separately from stdout
  - Timeout enforcement (1s timeout on 60s sleep fixture)
  - Working-directory confinement via policy before execution
  - Environment variable filtering (no npm_ vars leak)
  - Secret redaction in stdout and stderr
  - Output truncation with head+tail preservation
  - Spawn failure for nonexistent executable

  Docker Executor (2 tests):
  - Availability detection (boolean result)
  - Graceful unavailability handling in controller (throws clear error)

  Command Policy (7 tests):
  - Normal commands within repository → ALLOWED
  - Working directory outside repository → DENIED
  - Dangerous executables → DENIED
  - Excessive timeout → DENIED
  - Empty executable → DENIED
  - Destructive git operations → DENIED
  - Write + network → REQUIRES_APPROVAL

  Secret Redactor (4 tests):
  - Redacts known secret values
  - Redacts multiple occurrences
  - Handles multiple different secrets
  - Ignores empty secrets

  Evidence (9 tests):
  - Every execution creates evidence
  - Evidence includes provenance (command, executor, duration, timing)
  - Evidence is immutable (duplicate ID rejection)
  - Redacted output reaches evidence (no raw secrets)
  - Timeout creates inconclusive evidence
  - Exit code 0 generic command → OBSERVED (not PASS)
  - Exit code 0 TEST command → PASS
  - Exit code 1 TEST command → FAIL
  - Policy denial creates evidence with INCONCLUSIVE status

  Validation

  ┌──────────────────────┬───────────────────────────┐
  │        Check         │          Result           │
  ├──────────────────────┼───────────────────────────┤
  │ npm run build        │ Pass                      │
  ├──────────────────────┼───────────────────────────┤
  │ npm test             │ 174 tests pass (10 files) │
  ├──────────────────────┼───────────────────────────┤
  │ npm run lint         │ Pass                      │
  ├──────────────────────┼───────────────────────────┤
  │ npm run format:check │ Pass                      │
  ├──────────────────────┼───────────────────────────┤
  │ npm run typecheck    │ Pass                      │
  └──────────────────────┴───────────────────────────┘

  Repository Changes

  New Files

  ┌───────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │                 File                  │                                             Purpose                                              │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/types.ts                │ Core domain types: CommandProposal, ExecutionResult, ExecutionContext, enums, Executor interface │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/policy.ts               │ Deterministic command policy evaluation                                                          │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/secret-redactor.ts      │ Secret value redaction                                                                           │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/local-executor.ts       │ Local process execution with spawn, env filtering, output handling                               │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/docker-executor.ts      │ Docker container execution adapter                                                               │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/evidence-store.ts       │ InMemoryEvidenceStore with immutability                                                          │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/evidence-factory.ts     │ ExecutionResult → Evidence conversion                                                            │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/controller.ts           │ ExecutionController — central execution orchestrator                                             │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/execution/index.ts                │ Module re-exports                                                                                │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/cli/exec.ts                       │ CLI handler for qe exec command                                                                  │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ fixtures/exec-scripts/success.sh      │ Exit 0 fixture                                                                                   │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ fixtures/exec-scripts/fail.sh         │ Exit 1 fixture                                                                                   │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ fixtures/exec-scripts/slow.sh         │ 60s sleep fixture for timeout tests                                                              │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ fixtures/exec-scripts/echo-secret.sh  │ Prints SECRET_TOKEN to stdout+stderr                                                             │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ fixtures/exec-scripts/big-output.sh   │ ~200KB output for truncation tests                                                               │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ fixtures/exec-scripts/both-streams.sh │ Writes to both stdout and stderr                                                                 │
  ├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ tests/execution.test.ts               │ 33 execution/evidence tests                                                                      │
  └───────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────┘

  Modified Files

  ┌───────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │         File          │                                                       Change                                                       │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/cli/main.ts       │ Added exec command with --command, --arg, --command-id, --secret, --env, --repo, --timeout, --mode, --json options │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/config/schema.ts  │ Added commandTimeoutSeconds and maxOutputBytes to execution config                                                 │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/logging/logger.ts │ Added StderrLogSink for JSON-mode log output                                                                       │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/logging/index.ts  │ Re-exported StderrLogSink                                                                                          │
  ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ README.md             │ Updated status to Milestone 2, documented exec command and safety boundaries                                       │
  └───────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Schema Changes

  - ExecutionConfig in src/config/schema.ts: Added commandTimeoutSeconds: z.number().positive().default(300) and maxOutputBytes: z.number().positive().default(1_048_576). These are needed for the execution
  layer's configurable timeout and output limits.
  - New domain types in src/execution/types.ts: CommandProposal, ExecutionResult, ExecutionContext Zod schemas with associated enums (Mutability, NetworkPolicy, TerminationReason, PolicyOutcome, ExecutorType,
  ExecutionMode). These implement the execution domain model specified in the system design and ADR-007.

  Dependencies Added

  None. Milestone 2 uses only existing dependencies (Node.js child_process, Zod for schemas). No new npm packages were added.

  Deviations

  None. The implementation follows:
  - PRD: Controlled execution with safety policies, evidence capture
  - Technical Product Specification: ExecutionController as central component, local+Docker executors, evidence-first model
  - AGENTS.md: TypeScript ESM, Zod validation, Vitest tests, Commander.js CLI
  - ADR-004 (Evidence-first): Every execution produces immutable evidence
  - ADR-007 (Local and Docker execution): Both executors implemented behind common abstraction
  - ADR-009 (Canonical QE result contract): Evidence status distinguishes PASS/FAIL/OBSERVED/INCONCLUSIVE

  Deferred

  The following are intentionally deferred to Milestone 3 or later:
  - Autonomous validation planning and command selection
  - Risk reasoning and change-impact analysis
  - Automatic test selection
  - Test generation
  - Failure investigation loops
  - Baseline comparison
  - Browser execution through Playwright
  - Application startup orchestration
  - Verdict generation
  - Project-memory updates
  - GitHub check publishing / issue creation
  - Detailed test-framework result parsing (JUnit XML, TAP, etc.)
  - Persistent evidence storage (filesystem/database)
  - Full Docker environment synthesis per ecosystem
  - Retry logic

  Concerns

  1. Local execution security: Local mode runs repository code with the QE Agent's OS privileges. This is documented but remains the primary security boundary concern. Docker with --network none is the
  recommended isolation for untrusted repositories.
  2. TOCTOU on working-directory validation: The realpath check happens before execution. A symlink created between validation and spawn could theoretically bypass confinement. This is a known limitation of
  filesystem-based containment.
  3. Process group cleanup on macOS: The detached: true + process.kill(-pid, 'SIGKILL') approach works for direct child processes but may not catch all descendants in complex process trees (e.g., commands that
  spawn daemons or detach from their session).
  4. Secret redaction scope: Only stdout/stderr text content is redacted. Secrets that appear in filenames, process titles, network requests, or other side channels are not caught.

  Scope Confirmation

  Milestone 3 reasoning behavior was not implemented. No autonomous command selection, no LLM provider calls, no validation planning, no risk reasoning, no test generation, no failure investigation. All command
  execution requires explicit selection via CLI input or direct API call.
