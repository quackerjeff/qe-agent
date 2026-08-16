# Milestone 2 Correction Assignment — Safe Execution & Evidence

**Milestone:** 2  
**Status:** Corrections Required  
**Purpose:** Resolve findings from the independent Milestone 2 review  
**Next Milestone:** Do NOT begin Milestone 3

# Required Reading

Before modifying code, read:

1. `AGENTS.md`
2. `docs/milestones/milestone-2-safe-execution-evidence.md`
3. `docs/milestones/milestone-2-review.md`
4. relevant PRD/System Design sections
5. all accepted ADRs

Inspect the actual implementation before making changes.

Preserve the existing Milestone 2 architecture unless a correction genuinely requires changing it.

# Objective

Correct the identified execution-safety and evidence-integrity defects while preserving the Milestone 2 boundary:

> Explicitly selected deterministic actions may execute and produce trustworthy evidence.

Milestone 2 must NOT introduce autonomous QE reasoning or Milestone 3 behavior.

# Required Corrections

## 1. Secret Redaction Across the Entire Execution Boundary

Explicitly supplied secret values must never appear in user-visible, logged, returned, or stored execution data.

Current stdout/stderr redaction is insufficient.

Redact secrets from at least:

- stdout;
- stderr;
- command arguments;
- command representations;
- ExecutionResult;
- evidence summaries;
- evidence details;
- logs;
- CLI JSON output;
- error messages derived from execution data.

Prefer creating a sanitized/redacted representation before logging, returning, or constructing evidence.

Do not mutate the actual command arguments required for process execution before spawning the process.

The raw command may exist transiently where necessary to execute it, but it must not cross the trusted execution boundary into logs/results/evidence.

Add regression tests proving an explicitly supplied secret used as:

- environment value;
- command argument;
- stdout content;
- stderr content;

does not appear in any returned/logged/stored representation.

Test repeated occurrences.

## 2. Evidence Immutability

Evidence stored in the Evidence Store must be immutable from the caller's perspective.

The current shallow freeze is insufficient.

Implement behavior equivalent to:

- defensive deep copy on insertion;
- deep immutability of the stored representation;
- defensive copies or otherwise immutable values from `get()`;
- defensive copies or otherwise immutable values from `list()`.

A caller modifying:

```text
originalEvidence.details
```

after `add()` must not alter stored evidence.

A caller modifying:

```text
store.get(id).details
```

must not alter stored evidence.

Likewise, values returned from `list()` must not expose mutable references into storage.

Do not add a large immutable-data dependency unless genuinely necessary.

Use a small, understandable implementation appropriate to the evidence schema.

Add regression tests for nested objects and arrays.

## 3. Bounded Streaming Output

stdout and stderr must be bounded while the process is running.

Do not:

1. buffer unlimited output;
2. wait for process completion;
3. truncate afterward.

Implement bounded accumulation during stream consumption.

Preserve useful output while remaining memory bounded.

A simple strategy such as a bounded head/tail representation is acceptable.

Evidence/result metadata must indicate truncation.

Ensure redaction still works correctly with bounded output.

Add a controlled fixture capable of producing substantially more output than the configured limit.

Verify retained memory/output remains bounded independent of total process output.

Apply equivalent behavior to LocalExecutor and DockerExecutor.

## 4. Docker Working Directory Mapping

Docker execution must honor the requested working directory when it is an approved subdirectory of the repository.

For example, if:

```text
repositoryRoot = /repo
workingDirectory = /repo/packages/api
```

and the repository is mounted at:

```text
/workspace
```

the container should execute from:

```text
/workspace/packages/api
```

not always:

```text
/workspace
```

Use the already validated/constrained repository-relative path.

Evidence must accurately represent where execution occurred.

Add tests for:

- repository-root execution;
- nested-directory execution;
- invalid/outside working directories.

Do not weaken existing realpath confinement.

## 5. Honor Execution Configuration in `qe exec`

`qe exec` must load applicable `.qe/config.yml` execution configuration.

At minimum honor applicable settings for:

- execution mode;
- command timeout;
- maximum output size.

CLI flags, where supplied, should override project configuration.

Establish and test a clear precedence:

```text
CLI override
    ↓
project .qe/config.yml
    ↓
schema/default value
```

Invalid project configuration should fail clearly.

Do not introduce speculative configuration.

## 6. Structured Discovered Command Execution

Do not use generic whitespace splitting as a substitute for structured command representation.

Preferred correction:

Preserve or produce structured executable + argument data when commands are discovered in repository intelligence.

If that requires disproportionate redesign for Milestone 2, constrain `--command-id` execution to command forms that can be represented safely and unambiguously.

Fail clearly for unsupported/ambiguous command forms.

Do NOT implement a general shell parser.

Do NOT execute discovered commands through:

```text
sh -c
bash -c
shell: true
```

merely to preserve quoting semantics.

Structured execution remains the architectural default.

## 7. Executor-Unavailable Evidence

Review the execution-attempt behavior when a requested executor cannot run.

For example:

```text
execution.mode = docker
Docker unavailable
```

Where consistent with the current domain model, produce a structured unsuccessful `ExecutionResult` and corresponding evidence rather than throwing before evidence generation.

The evidence should communicate that:

- execution was requested;
- execution did not occur;
- why it could not occur;
- no test/build conclusion can be drawn.

Use an appropriate status such as:

```text
INCONCLUSIVE
```

Do not misrepresent executor unavailability as product/test failure.

If there is a strong architectural reason not to model pre-execution failures as evidence, document that decision explicitly and reconcile it with Milestone 2 acceptance criterion 15.

# Required Regression Tests

At minimum add tests proving:

1. environment secrets are redacted;
2. command-argument secrets are redacted;
3. secrets never appear in logs;
4. secrets never appear in ExecutionResult;
5. secrets never appear in evidence;
6. nested evidence cannot be mutated through the original object;
7. nested evidence cannot be mutated through `get()`;
8. nested evidence cannot be mutated through `list()`;
9. stdout is bounded during execution;
10. stderr is bounded during execution;
11. truncation metadata is correct;
12. Docker nested working directories map correctly;
13. `qe exec` honors `.qe/config.yml`;
14. CLI execution settings override project configuration;
15. discovered commands with quoting/whitespace are not incorrectly executed by naïve splitting;
16. executor-unavailable behavior produces the intended structured outcome.

# Required Demonstrations

## Secret Argument

Execute a controlled fixture with a secret passed as an argument.

Verify the raw secret does not appear in:

- logs;
- stdout/stderr result representation;
- command representation;
- JSON output;
- evidence.

## Evidence Mutation

Store evidence containing nested objects/arrays.

Attempt mutation through:

- original input;
- `get()`;
- `list()`.

Verify stored evidence remains unchanged.

## Large Output

Execute a fixture producing output substantially larger than `maxOutputBytes`.

Verify:

- process completes;
- retained output remains bounded;
- truncation is reported;
- memory behavior does not depend on buffering the complete stream.

## Docker Nested Directory

Where Docker is available, execute from a nested project directory and verify the container working directory maps correctly.

Where Docker is unavailable, validate the mapping construction through deterministic tests.

## Configuration

Set execution configuration in `.qe/config.yml`.

Verify `qe exec` uses it.

Then supply a CLI override and verify the override wins.

# Safety Constraints

Preserve:

- `shell: false`;
- structured executable + arguments;
- realpath repository confinement;
- symlink escape protection;
- environment allowlisting;
- timeout/process cleanup;
- Docker network isolation where implemented.

Do not weaken existing safety behavior while making these corrections.

# Do Not Implement

Do not implement:

- autonomous command selection;
- validation-plan reasoning;
- risk reasoning;
- LLM execution decisions;
- test generation;
- failure investigation loops;
- verdict generation;
- Playwright execution;
- project memory;
- GitHub integration;
- multi-agent orchestration.

# Validation

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

## Corrections Made

Map every independent-review finding to the correction made.

## Security Corrections

Describe secret-handling changes and execution-boundary guarantees.

## Evidence Corrections

Describe evidence immutability and executor-unavailable evidence behavior.

## Bounded Output

Explain how stdout/stderr are bounded while streaming.

## Docker Corrections

Explain working-directory mapping changes.

## Configuration Corrections

Explain config precedence.

## Structured Command Corrections

Explain how `--command-id` avoids naïve whitespace parsing.

## Regression Tests

List meaningful behavioral tests added.

## Demonstration Results

Report the required demonstrations.

## Validation Results

Report exact commands and results.

## Architecture Impact

Identify changes to execution/domain architecture.

If none, state none.

## Remaining Concerns

Identify anything intentionally deferred.

## Scope Confirmation

Explicitly confirm no Milestone 3 functionality was implemented.

Stop after completing Milestone 2 corrections.

Do not begin Milestone 3.