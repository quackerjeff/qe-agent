# QE Agent User Guide

QE Agent is an autonomous quality engineering system that validates software repositories against requirements. It discovers your project's structure, executes existing tests and quality tools, maps evidence to requirements, identifies verification gaps, and produces an evidence-supported verdict.

QE Agent is designed to run against **any** software repository, not just the qe-agent repository itself. You build QE Agent from source once, then point it at whichever project you want to validate.

This guide uses three terms consistently:

- **qe-agent repository** — the repository containing QE Agent's source code
- **target repository** — the software project you want QE Agent to analyze and validate
- **requirements file** — a Markdown document listing the requirements *of your target repository*

## Prerequisites

- **Node.js >= 20.0.0** (specified in `package.json` `engines` field)
- **npm** (included with Node.js)
- **Git** (target repositories should be Git repositories for full functionality)
- **OpenAI API key** (required for `verify` and `review` commands, which use LLM reasoning)

The `analyze` command does not require an API key — it performs static discovery only.

## Build QE Agent from Source

```bash
git clone <qe-agent-repository-url>
cd qe-agent
npm install
npm run build
```

`npm run build` compiles TypeScript source into JavaScript in the `dist/` directory. The CLI entry point is `dist/cli/main.js`.

Confirm the build succeeded:

```bash
node dist/cli/main.js --help
node dist/cli/main.js --version
```

Expected output from `--help`:

```
Usage: qe [options] [command]

QE Agent — Autonomous Quality Engineering

Options:
  -V, --version      output the version number
  -h, --help         display help for command

Commands:
  init               Initialize QE configuration for the current repository
  analyze [options]  Analyze repository structure and QE capabilities
  exec [options]     Execute a command through the Execution Controller
  test               Execute repository quality validation
  verify [options]   Run QE reasoning against supplied requirements
  review [options]   Run QE reasoning against a Git baseline
  github             GitHub integration commands
  opencode           OpenCode harness integration commands
  help [command]     display help for command
```

## Development-Mode Execution

You can run QE Agent directly from source without building first using `npm run dev`:

```bash
npm run dev -- --help
npm run dev -- verify --help
```

The `--` separator is required. Without it, npm interprets flags like `--help` or `--profile` as npm's own options rather than passing them to QE Agent. Everything after `--` is passed to the `tsx src/cli/main.ts` script.

Development mode uses `tsx` to run TypeScript directly. It is equivalent to the built CLI but does not require `npm run build` first.

**Important:** Command-specific options belong after the command name, not before it:

```bash
# Correct — --profile is a verify option:
npm run dev -- verify --profile quick --requirements reqs.md

# Wrong — --profile is not a top-level option:
npm run dev -- --profile quick
```

## API Credential Configuration

QE Agent requires an OpenAI API key for commands that use LLM reasoning (`verify` and `review`). The `analyze` command does not require credentials.

Set the key as an environment variable:

```bash
export OPENAI_API_KEY="sk-..."
```

Or pass it inline for a single command:

```bash
OPENAI_API_KEY="sk-..." node dist/cli/main.js verify --requirements reqs.md --repo /path/to/project
```

**Security warnings:**

- Never commit API keys to version control
- Never place API keys in requirements documents
- Never paste API keys into `.qe/` configuration or data files
- Prefer environment variables over any other mechanism
- API keys are loaded from `process.env.OPENAI_API_KEY` in the gateway factory — they are never read from configuration files

## Target Project Setup

QE Agent can live in a separate directory from the project it validates. A typical layout:

```
~/Development/
  qe-agent/            # QE Agent source (built once)
  my-application/      # Target repository to validate
```

Use `--repo` to point QE Agent at the target repository:

```bash
node ~/Development/qe-agent/dist/cli/main.js analyze \
  --repo ~/Development/my-application
```

When `--repo` is omitted, QE Agent uses the current working directory as the target repository. You can also `cd` into your project and run QE from there:

```bash
cd ~/Development/my-application
node ~/Development/qe-agent/dist/cli/main.js analyze
```

Both approaches are equivalent. Use whichever is more convenient.

## Analyze a Project

The `analyze` command performs static discovery of your target repository without making any API calls.

```bash
node ~/Development/qe-agent/dist/cli/main.js analyze \
  --repo ~/Development/my-application
```

Options:

| Option | Description |
|--------|-------------|
| `--repo <path>` | Path to target repository (default: current directory) |
| `--json` | Output analysis as JSON |

Analysis discovers:

- Programming languages and ecosystems
- Package managers and build systems
- Test frameworks (Vitest, Jest, Playwright, etc.)
- CI systems
- Available commands (test, lint, typecheck, build, etc.)
- Browser testing capabilities
- Project documentation and instructions

Use this to verify that QE Agent correctly discovers your project before running a full verification.

Example output:

```
QE Repository Analysis

Repository
----------
/home/user/my-application

Git
---
Detected
Branch: main

Detected Ecosystems
-------------------
TypeScript              HIGH
JavaScript              HIGH

Tests
-----
Jest
  Source: package.json

Discovered Commands
-------------------
[TEST] npm run test
  Source: package.json
[LINT] npm run lint
  Source: package.json

Capabilities
------------
✓ node.npm
✓ node.jest
✓ generic.shell
✓ git.analysis

Analysis Confidence
-------------------
HIGH

AI Usage
--------
No model calls (static analysis only)
```

## Initialize a Target Project

The `init` command creates a `.qe/` directory with default configuration inside the target repository.

```bash
cd ~/Development/my-application
node ~/Development/qe-agent/dist/cli/main.js init
```

`init` must be run from inside the target repository (it uses the current working directory). It does not accept a `--repo` option.

Running `init` creates:

| Path | Purpose | Commit to Git? |
|------|---------|----------------|
| `.qe/config.yml` | QE configuration | Yes |
| `.qe/.gitignore` | Ignores ephemeral artifacts | Yes |

Running `init` again when `.qe/config.yml` already exists does nothing — it will not overwrite existing configuration.

The generated `.qe/.gitignore` excludes ephemeral artifacts:

```
# Ephemeral QE artifacts — not committed
runs/
cache/
artifacts/
traces/
```

`init` is optional. If no `.qe/config.yml` exists, QE Agent uses sensible defaults.

## Requirements

QE Agent validates a target repository against supplied requirements. Requirements can be provided as a Markdown file or as inline text.

### Requirements file (`--requirements`)

```bash
node dist/cli/main.js verify \
  --requirements ~/Development/my-application/docs/requirements.md \
  --repo ~/Development/my-application
```

The requirements file path is resolved relative to the current directory, not the target repository.

### Inline requirements (`--requirement`)

```bash
node dist/cli/main.js verify \
  --requirement "Users must authenticate before dashboard access" \
  --requirement "Admin panel requires admin role" \
  --repo ~/Development/my-application
```

Inline requirements receive auto-generated IDs (`req-1`, `req-2`, etc.).

### Requirements file format

QE Agent supports two Markdown formats.

**Structured format** (recommended) — uses `## FR-NNN` headings:

```markdown
# Requirements

## FR-001 User Authentication
Users must authenticate before accessing the dashboard.
- Unauthenticated requests return HTTP 401
- Authenticated users can access the dashboard
- Expired sessions are rejected with HTTP 401

## FR-002 Role-Based Access Control
Access to admin features requires the admin role.
- Non-admin users cannot access /admin routes
- Admin users can access all admin routes
- Role changes take effect on next login
```

The parser recognizes `## FR-NNN` or `## FR-NNNA` headings (e.g., `FR-001`, `FR-035A`). Bullet points under each heading become acceptance criteria.

**Simple format** — uses any Markdown headings:

```markdown
# User Authentication
- Unauthenticated requests return HTTP 401
- Authenticated users can access the dashboard

# Data Validation
- Empty required fields are rejected
- SQL injection attempts are blocked
```

Simple-format requirements receive auto-generated IDs (`req-1`, `req-2`, etc.).

Both formats support optional priority annotations on bullet items:

```markdown
- Critical feature must work [priority: critical]
- Nice to have behavior [priority: low]
```

**Important:** Supply requirements that describe *your target project*, not QE Agent's own requirements. If you are validating `my-application`, write requirements for `my-application`. Accidentally supplying QE Agent's product requirements (`docs/Automated QE Agent — Product & Functional Requirements.md`) when validating an unrelated project will produce meaningless results.

## Verify a Project

The `verify` command is the primary workflow. It runs the full QE pipeline against your target repository.

```bash
node ~/Development/qe-agent/dist/cli/main.js verify \
  --profile quick \
  --repo ~/Development/my-application \
  --requirements ~/Development/my-application/docs/requirements.md
```

Options:

| Option | Description |
|--------|-------------|
| `--requirements <file>` | Requirements file (Markdown) |
| `--requirement <text...>` | Inline requirement(s) |
| `--repo <path>` | Repository path (default: current directory) |
| `--profile <profile>` | Execution profile: `quick`, `standard`, `deep` |
| `--json` | Output result as JSON |
| `--output <path>` | Write QE result JSON to file |

At least one of `--requirements` or `--requirement` is required.

Development-mode equivalent:

```bash
npm run dev -- verify \
  --profile quick \
  --repo ~/Development/my-application \
  --requirements ~/Development/my-application/docs/requirements.md
```

### What verify does

1. **Discovers** the target repository's structure (languages, tests, tools)
2. **Assesses risk** based on the requirements and repository state
3. **Plans** validation by selecting appropriate commands to execute
4. **Executes** selected validation commands (tests, lint, typecheck) in the target repository
5. **Investigates** any command failures and classifies root causes
6. **Analyzes gaps** by mapping collected evidence to requirements
7. **Generates tests** if gaps are identified and the budget permits
8. **Forms a verdict** supported by evidence

### Execution profiles

Profiles control how much time and how many model calls QE Agent uses:

| Profile | Max Duration | Max Model Calls | Max Retries | Max Generated Tests |
|---------|-------------|-----------------|-------------|---------------------|
| `quick` | 2 minutes | 6 | 1 | 1 |
| `standard` | 10 minutes | 12 | 2 | 3 |
| `deep` | 20 minutes | 24 | 3 | 8 |

When no `--profile` is specified, the value from `.qe/config.yml` is used (default: `standard`).

The `quick` profile is suitable for initial exploration and CI pipelines where speed matters. The `standard` profile provides balanced coverage. The `deep` profile is for thorough validation of critical changes.

## Review Changes Against a Git Baseline

The `review` command validates changes between two Git refs:

```bash
node ~/Development/qe-agent/dist/cli/main.js review \
  --base main \
  --target HEAD \
  --repo ~/Development/my-application \
  --requirements ~/Development/my-application/docs/requirements.md
```

Options:

| Option | Description |
|--------|-------------|
| `--base <ref>` | Baseline Git ref (**required**) |
| `--target <ref>` | Target Git ref (default: `HEAD`) |
| `--requirements <file>` | Requirements file (Markdown) |
| `--requirement <text...>` | Inline requirement(s) |
| `--repo <path>` | Repository path (default: current directory) |
| `--profile <profile>` | Execution profile: `quick`, `standard`, `deep` |
| `--json` | Output result as JSON |
| `--output <path>` | Write QE result JSON to file |
| `--ci` | CI mode: persist result and use configured exit codes |

`review` differs from `verify` in that it:

- Collects a deterministic Git diff between `--base` and `--target`
- Performs semantic change analysis focused on what changed
- Classifies failures as INTRODUCED, PRE_EXISTING, or UNKNOWN through baseline comparison
- In `--ci` mode, persists `result.json` to `.qe/runs/<executionId>/` and uses exit codes from `.qe/config.yml` (`ci.failOn`)

Requirements are optional for `review` — the change diff itself provides context.

If the baseline ref is not available locally (shallow clone), QE Agent immediately produces a BLOCKED verdict with instructions to fetch the required history.

## Other CLI Commands

### `init`

Initialize QE configuration for the target repository. Creates `.qe/config.yml` with defaults. See [Initialize a Target Project](#initialize-a-target-project).

```bash
node dist/cli/main.js init
```

### `analyze`

Discover repository structure without API calls. See [Analyze a Project](#analyze-a-project).

```bash
node dist/cli/main.js analyze --repo /path/to/project
node dist/cli/main.js analyze --repo /path/to/project --json
```

### `exec`

Execute a single command through QE Agent's Execution Controller, which enforces timeouts, secret redaction, and evidence capture.

```bash
# Run a command directly
node dist/cli/main.js exec --command npm --arg test --repo /path/to/project

# Run a discovered command by its ID
node dist/cli/main.js exec --command-id test:npm:test --repo /path/to/project

# With secret redaction
node dist/cli/main.js exec --command ./deploy.sh \
  --env API_KEY=sk-secret --secret sk-secret \
  --repo /path/to/project

# With timeout
node dist/cli/main.js exec --command npm --arg test --timeout 60

# JSON output
node dist/cli/main.js exec --command npm --arg test --json
```

Options:

| Option | Description |
|--------|-------------|
| `--command <executable>` | Executable to run |
| `--arg <arg...>` | Arguments to pass |
| `--command-id <id>` | Run a discovered command by ID |
| `--secret <value...>` | Secret values to redact from output |
| `--env <KEY=VALUE...>` | Environment variables for the command |
| `--repo <path>` | Repository path (default: current directory) |
| `--timeout <seconds>` | Command timeout in seconds |
| `--mode <mode>` | Execution mode: `local`, `docker`, `auto` |
| `--json` | Output result as JSON |

Use `exec` when you want to test a single command through QE Agent's safety controls before running a full verification. Execution safety features include: structured command execution (no shell injection), working directory confinement, dangerous executable blocking, timeout enforcement, process group cleanup on timeout, environment allowlist filtering, and secret redaction in all output and evidence.

### `test`

Execute repository quality validation. This command is not yet implemented and will exit with an error.

### `github publish`

Publish a QE result to GitHub as a check run.

```bash
node dist/cli/main.js github publish \
  --result .qe/runs/<executionId>/result.json \
  --repo /path/to/project
```

Options:

| Option | Description |
|--------|-------------|
| `--result <path>` | Path to QE result JSON file (**required**) |
| `--repo <path>` | Repository path (default: current directory) |
| `--dry-run` | Preview publishing without remote writes |
| `--json` | Output publishing result as JSON |

### `opencode publish`

Deliver a QE result into an OpenCode session (see [ADR-011](adr/011-opencode-as-invocation-integration.md)). OpenCode is an invocation mechanism — the QE core remains harness-independent.

```bash
node dist/cli/main.js opencode publish \
  --result .qe/runs/<executionId>/result.json \
  --session <opencode-session-id>
```

Options:

| Option | Description |
|--------|-------------|
| `--result <path>` | Path to QE result JSON file (**required**) |
| `--repo <path>` | Repository path (default: current directory) |
| `--session <id>` | OpenCode session ID to deliver into |
| `--dry-run` | Preview delivery without sending |
| `--json` | Output publishing result as JSON |

The session target is resolved from `--session`, the `QE_OPENCODE_SESSION_ID` environment variable, or dry-run. The OpenCode server URL defaults to `http://127.0.0.1:4096` and can be overridden with `OPENCODE_SERVER_URL`. If the server is protected with `OPENCODE_SERVER_PASSWORD`, it is used for basic auth and redacted from all output.

The delivered message is a markdown verdict summary rendered from the QE result with known secrets redacted. Delivery uses the `prompt_async` server endpoint and is additionally persisted under `.qe/runs/<executionId>/opencode-message.md`.

### OpenCode harness files

The repository ships a committed `.opencode/` directory for teams using the OpenCode harness:

- `.opencode/agents/qe.md` — a read-only "QE operator" subagent that runs the QE CLI and reports evidence-backed verdicts;
- `.opencode/commands/qe-analyze.md`, `qe-verify.md`, `qe-review.md` — slash commands (`/qe-analyze`, `/qe-verify <file>`, `/qe-review <base>`);
- `.opencode/plugins/qe-agent.ts` — custom tools (`qe_analyze`, `qe_verify`, `qe_review`, `qe_opencode_publish`) wrapping the deterministic QE CLI;
- `.opencode/opencode.json` — project config registering the instructions and a `/qe` command.

These files invoke the same CLI documented in this guide; they add no new QE behavior.

## Understanding QE Output

### Verdicts

| Verdict | Meaning |
|---------|---------|
| `PASS` | No material defect identified; evidence strongly supports expected behavior |
| `PASS_WITH_CONCERNS` | No blocking defect but meaningful residual risk remains |
| `NEEDS_REVIEW` | Evidence conflicts or material uncertainty requires human judgment |
| `FAIL` | Demonstrated material defect, regression, or violated requirement |
| `BLOCKED` | Critical validation could not be performed; insufficient evidence for a conclusion |

A successful QE execution does not require a `PASS` verdict. `FAIL` means QE found a demonstrated defect — that is useful information, not a malfunction.

The verdict is produced by the Verdict Engine, which applies deterministic guardrails that may override the model's recommendation. For example, if all test failures are classified as flaky, a model-recommended `FAIL` may be overridden to `PASS_WITH_CONCERNS`.

### Confidence

Each verdict includes a confidence level: `HIGH`, `MEDIUM`, or `LOW`. This reflects the strength of the evidence supporting the verdict, not a probability of correctness.

### Risk assessment

QE Agent assesses the risk level of the target repository as `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`. Risk factors may include change scope, business criticality, security sensitivity, and data sensitivity. Risk assessment is model-generated and informational — it influences the validation plan but does not determine the verdict.

### Requirement assessments

Each requirement receives one of these statuses:

| Status | Meaning |
|--------|---------|
| `VERIFIED` | Evidence supports that the requirement is met |
| `PARTIALLY_VERIFIED` | Some acceptance criteria are supported by evidence, others are not |
| `NOT_VERIFIED` | Insufficient evidence to determine whether the requirement is met |
| `BLOCKED` | Validation could not be performed for this requirement |
| `NOT_APPLICABLE` | Requirement was determined not to apply |

**`NOT_VERIFIED` does not mean the requirement is violated.** It means QE Agent did not find sufficient evidence to verify it. This can happen because:

- The relevant capability was not exercised during validation
- QE Agent did not discover the right test or command
- The evidence exists but the model did not map it to the requirement
- The requirement describes functionality that the target project does not yet implement

### Remaining gaps

Gaps identify areas where verification is incomplete. Each gap includes an area, description, reason, and risk level. Gaps are informational — they help you understand what QE Agent could not verify and why.

### Recommended next actions

Model-generated suggestions for improving verification coverage.

### Execution metrics

The output includes:

- **Duration** — total wall-clock time
- **Model calls** — number of LLM reasoning calls made
- **Commands executed** — number of commands run in the target repository
- **State transitions** — internal lifecycle state transitions

### AI usage

Token consumption metrics for transparency:

- **Model calls** — total reasoning calls
- **Input tokens** — tokens sent to the model
- **Output tokens** — tokens received from the model
- **Throughput limit** — configured tokens-per-minute limit

## Model-Assessed vs Fallback Results

When QE Agent analyzes a large number of requirements, it splits them into chunks for gap analysis. Each chunk is sent to the model for assessment.

If a chunk fails (due to output truncation, timeout, or other model/provider error) and cannot be recovered via retry, the requirements in that chunk receive **deterministic fallback** assessments: each is marked `NOT_VERIFIED` with no evidence citations.

This distinction matters because:

- **Model-assessed** results reflect the model's actual analysis of evidence against requirements
- **Fallback** results indicate that the model never analyzed those requirements — the `NOT_VERIFIED` status is a safe default, not an analytical conclusion

To determine whether all requirements were model-assessed, inspect the diagnostics file (see next section). Look at the `gapChunks` array: each chunk shows `success: true/false` and the list of `requestedRequirementIds`. A failed chunk means those requirements received fallback assessments.

## Run Artifacts and Diagnostics

QE Agent persists run artifacts to the target repository under `.qe/runs/<executionId>/`.

### `diagnostics.json`

Always written after a `verify` or `review` run. Contains:

- **`providerAttempts`** — every model call made during the run:
  - `role` — the reasoning role (e.g., `risk_analyst`, `gap_analyst`, `verdict_reviewer`)
  - `attemptIndex` — attempt number (0 = initial, 1+ = retry)
  - `timeoutMs` — timeout applied to this call
  - `remainingMs` — wall-clock time remaining when the call started
  - `callDeadlineReserveMs` — time reserved for subsequent mandatory calls
  - `startedAt` — ISO timestamp
  - `durationMs` — actual call duration
  - `success` — whether the call succeeded
  - `errorClass` — error type if failed (e.g., `OutputTruncationError`, `SchemaValidationError`, `RetryBudgetExhausted`)
  - `errorMessage` — error details if failed
  - `finishReason` — model finish reason (`stop` = complete, `length` = truncated)
  - `inputTokens`, `outputTokens`, `cachedTokens` — token usage
  - `retryAttempted` — whether a retry was attempted
  - `retryAdmitted` — whether the retry was admitted by the budget
- **`gapChunks`** — gap analysis chunk results:
  - `chunkIndex` — chunk number
  - `requestedRequirementIds` — which requirements were in this chunk
  - `success` — whether the chunk completed successfully
  - `rawAssessments` — per-requirement assessment details (if successful)
  - `rawGaps` — identified gaps (if successful)
  - `errorClass`, `errorMessage` — failure details (if failed)

### `result.json`

Written when using `review --ci` mode, or when `--output` is used with either `verify` or `review`. Contains the full QE result including verdict, evidence, findings, assessments, and metrics.

### Secret redaction

Diagnostics are written after secret redaction. Any secret values registered via `--secret` or discovered during execution are replaced with `***` in persisted files.

## Git / .gitignore Guidance

The `.qe/` directory contains both configuration (should be committed) and ephemeral artifacts (should not be committed).

### Recommended `.gitignore` entries for `.qe/`

If you ran `qe init`, a `.qe/.gitignore` was created automatically with:

```
# Ephemeral QE artifacts — not committed
runs/
cache/
artifacts/
traces/
```

If you are configuring `.gitignore` manually in your project root, add:

```gitignore
# QE Agent ephemeral artifacts
.qe/runs/
.qe/cache/
.qe/artifacts/
.qe/traces/
```

### What to commit

| Path | Commit? | Reason |
|------|---------|--------|
| `.qe/config.yml` | Yes | Project-specific QE configuration |
| `.qe/.gitignore` | Yes | Ensures ephemeral artifacts are ignored |
| `.qe/runs/` | No | Ephemeral per-run diagnostics and results |
| `.qe/cache/` | No | Ephemeral runtime cache |
| `.qe/artifacts/` | No | Ephemeral execution artifacts |
| `.qe/traces/` | No | Ephemeral execution traces |
| `.qe/knowledge/` | Optional | QE project memory (model-generated observations about the repository) |
| `.qe/history/` | Optional | QE run history summaries |
| `.qe/RISKS.md` | Optional | Model-generated risk observations |
| `.qe/TESTING.md` | Optional | Model-generated testing observations |

The `knowledge/`, `history/`, `RISKS.md`, and `TESTING.md` files are generated by QE Agent's memory system. They contain model-generated observations about your repository that persist across runs. Whether to commit these depends on whether your team finds them useful as shared context.

## Configuration

QE Agent reads configuration from `.qe/config.yml` in the target repository. If no configuration exists, defaults are used.

### Default configuration

```yaml
version: 1
profile: standard
execution:
  mode: auto
  maxMinutes: 20
  commandTimeoutSeconds: 300
  maxOutputBytes: 1048576
tests:
  generation: true
  commitPermanentTests: true
browser:
  enabled: auto
  headless: true
ci:
  failOn:
    - FAIL
    - BLOCKED
github:
  checks:
    enabled: true
  issues:
    enabled: false
    minimumSeverity: HIGH
    minimumConfidence: 0.8
  dryRun: false
memory:
  enabled: true
  historySummaries: true
model:
  provider: openai
  model: gpt-4o
reasoning:
  maxModelCalls: 12
```

### Key configuration options

| Section | Key | Description |
|---------|-----|-------------|
| `profile` | — | Default execution profile: `quick`, `standard`, `deep` |
| `execution.mode` | — | Command execution mode: `auto`, `local`, `docker` |
| `execution.commandTimeoutSeconds` | — | Per-command timeout |
| `execution.maxOutputBytes` | — | Maximum captured output per command |
| `tests.generation` | — | Whether QE Agent may generate tests |
| `browser.enabled` | — | Browser testing: `auto`, `true`, `false` |
| `ci.failOn` | — | Verdicts that cause non-zero exit in `--ci` mode |
| `model.provider` | — | Model provider (currently: `openai`) |
| `model.model` | — | Model name (e.g., `gpt-4o`, `gpt-4o-mini`) |
| `model.tpmLimit` | — | Tokens-per-minute throughput limit |
| `reasoning.maxModelCalls` | — | Maximum model calls per run |
| `memory.enabled` | — | Whether project memory persists across runs |

## Recommended First Run

The following sequence is recommended when running QE Agent against a new target repository for the first time.

```bash
# 1. Analyze — verify QE discovers your project correctly (no API key needed)
node /path/to/qe-agent/dist/cli/main.js analyze \
  --repo /path/to/my-project

# 2. Review the output — confirm languages, test frameworks, and commands
#    look correct. If discovery is wrong, the verification will be too.

# 3. Verify using the quick profile for a fast initial run
OPENAI_API_KEY="sk-..." node /path/to/qe-agent/dist/cli/main.js verify \
  --profile quick \
  --repo /path/to/my-project \
  --requirements /path/to/my-project/docs/requirements.md

# 4. Read the verdict — understand what was verified and what was not

# 5. Inspect diagnostics
cat /path/to/my-project/.qe/runs/*/diagnostics.json | python3 -m json.tool | head -80

# 6. Check target repository state — QE Agent executes commands in your
#    repository and may generate temporary test files. Verify nothing
#    unexpected was left behind.
cd /path/to/my-project
git status --short
```

**Why check `git status` after the first run:** QE Agent executes commands (tests, lint, typecheck) in the target repository and may generate temporary investigative tests. These temporary tests are normally cleaned up automatically, but verifying repository cleanliness after the first run builds confidence in the cleanup behavior.

## Cross-Project Dogfood Acceptance

This section provides a reusable acceptance prompt for teams evaluating QE Agent before broader adoption. Copy the prompt below and provide it to an AI coding assistant or human evaluator alongside a target repository.

````markdown
# QE Agent Cross-Project Acceptance Evaluation

You are evaluating QE Agent's behavior against this target repository.
Your job is to REPORT findings, not to fix QE Agent.

## Setup

1. Record the target repository's current Git state:
   ```
   cd <target-repository>
   git status --short
   git log --oneline -5
   ```

2. Establish ground truth independently:
   - What languages and frameworks does the project use?
   - What test commands exist? What do they test?
   - What lint/typecheck commands exist?
   - What is the project's actual quality state?

3. Record the qe-agent commit:
   ```
   cd <qe-agent-repository>
   git log --oneline -1
   ```

## Execution

4. Run QE Agent analyze and record the output:
   ```
   node <qe-agent>/dist/cli/main.js analyze --repo <target-repository>
   ```

5. Run QE Agent verify:
   ```
   OPENAI_API_KEY="..." node <qe-agent>/dist/cli/main.js verify \
     --profile quick \
     --repo <target-repository> \
     --requirements <target-requirements-file>
   ```

6. Record the full output.

## Inspection

7. Compare QE discovery with actual repository capabilities.
   Does QE correctly identify languages, test frameworks, and commands?

8. Inspect requirement completeness:
   - How many requirements were in the file?
   - How many appear in the output?
   - Are any missing?

9. Distinguish model-assessed from fallback results:
   - Read `.qe/runs/<executionId>/diagnostics.json`
   - Check each gap chunk's `success` field
   - Count: model-assessed requirements vs fallback requirements

10. Inspect representative evidence mappings:
    - For requirements marked VERIFIED, is the cited evidence actually relevant?
    - For requirements marked NOT_VERIFIED, does relevant evidence exist
      that QE failed to map?

11. Inspect provider failures and retries:
    - Were any model calls unsuccessful?
    - Were retries attempted? Admitted? Successful?
    - Did any calls hit OutputTruncationError or SchemaValidationError?

12. Inspect repository cleanliness:
    ```
    cd <target-repository>
    git status --short
    ```
    Were any files created, modified, or deleted?

13. Independently sanity-check the verdict:
    Given what you know about the repository's actual quality state,
    is the verdict reasonable? Consider that NOT_VERIFIED requirements
    are expected when QE lacks evidence — they are not defects.

## Classification

Classify each finding as one of:

- **PRODUCT_DEFECT** — QE Agent has a bug (e.g., fabricated evidence, crashes)
- **MODEL_VARIANCE** — Model made a judgment call differently than a human would
- **CAPABILITY_NOT_IMPLEMENTED** — QE Agent does not yet support this (documented)
- **TARGET_REPOSITORY_GAP** — The target project lacks something QE expects
- **CONFIGURATION_ISSUE** — Fixable by adjusting `.qe/config.yml` or environment
- **ACCEPTANCE_INFRASTRUCTURE_ISSUE** — Problem with the evaluation setup itself

## Stop-the-Line Conditions

If you observe ANY of the following, stop evaluation and report immediately:

- Fabricated evidence (evidence IDs that reference nothing, invented test results)
- False execution claims (commands reported as executed that were not)
- Destructive target repository modification (deleted files, force-pushed branches)
- Secret persistence (API keys, tokens appearing in `.qe/` files)
- Requirement loss (fewer assessments returned than requirements supplied)
- Assessment corruption (requirement IDs in output that do not match input)
- Budget invariant violation (more model calls than the profile permits)
- Verdict reserve violation (verdict call made with insufficient time remaining)
- Uncontrolled retries (more retries than the profile permits)
- Uncleaned generated test artifacts (test files left in the target repository)
- Provenance corruption (executed evidence labeled as observed, or vice versa)

## Report Format

Report findings as a numbered list. For each:
1. Classification
2. Description
3. Evidence (diagnostics excerpt, command output, file path)
4. Severity (stop-the-line / high / medium / low / informational)

Do NOT implement fixes to QE Agent during this evaluation.
````

## Root Cause Analysis Prompt

When a cross-project acceptance evaluation discovers a reproducible QE defect, use this prompt to diagnose the root cause before implementing any correction.

````markdown
# QE Agent Root Cause Analysis

A reproducible defect was discovered during cross-project acceptance.

## Defect Description

<describe the defect, including the finding classification and evidence>

## Required Investigation

1. **Exact reproduction:**
   Reproduce the defect with the same target repository, requirements file,
   and profile. Record the execution ID and full output.

2. **First bad state:**
   Identify the earliest point in the QE pipeline where behavior diverges
   from expected. Use diagnostics.json provider attempts and gap chunks.

3. **Expected vs observed behavior:**
   State precisely what should have happened and what actually happened.
   Include specific field values, token counts, or timing as applicable.

4. **Diagnostics evidence:**
   Extract relevant sections of diagnostics.json. Include provider attempts,
   gap chunk details, error classes, and token usage.

5. **Provider attempt timeline:**
   If the defect involves model behavior, reconstruct the timeline:
   which calls succeeded, which failed, what errors occurred, whether
   retries were attempted and admitted.

6. **Deterministic pipeline analysis:**
   Trace the code path through the deterministic pipeline components
   (evidence factory, candidate mapping, completeness validator,
   guardrails). Identify whether the defect is in deterministic code
   or model output.

7. **Model-output analysis:**
   If the defect involves model output, determine whether it is:
   - Schema-level (missing field, wrong type, truncated output)
   - Semantic-level (wrong judgment, missed evidence mapping)
   - Constraint-level (violated a prompt constraint)

8. **Root-cause classification:**
   Classify as one of:
   - Token budget insufficient
   - Schema constraint too strict or too permissive
   - Evidence pipeline bug
   - Prompt constraint missing or ambiguous
   - Retry/budget accounting error
   - Deterministic guardrail logic error
   - Model variance (not a code defect)

9. **Smallest generic correction:**
   Propose the smallest change that would fix the defect for all
   repositories, not just the target repository where it was discovered.
   The correction must not introduce repository-specific behavior.

10. **Regression risk analysis:**
    Identify which existing behaviors could be affected by the correction.

11. **DF-002 regression-preservation analysis:**
    Verify that the proposed correction does not violate any DF-002
    locked behaviors, including but not limited to:
    - Profile defaults and execution budgets
    - Verdict time reserve (20s)
    - Retry accounting and admission semantics
    - Evidence schemas, provenance, and projection
    - Gap chunk sizing and parallel dispatch
    - Verdict guardrails
    - Generated-test cleanup
    - Telemetry semantics

## DO NOT IMPLEMENT A FIX YET.

The purpose of this analysis is diagnosis. Report findings and proposed
correction. Implementation requires a separate, scoped correction task
with its own regression-preservation contract.
````

## Surgical Fix Prompt

After an RCA has established a root cause, use this prompt to implement the correction.

````markdown
# QE Agent Surgical Correction

## Root Cause

<paste the RCA findings and proposed correction>

## Correction Requirements

1. **Smallest generic correction:**
   Implement only the minimum change that fixes the diagnosed root cause.
   The fix must work for all repositories, not just the one where the
   defect was discovered.

2. **No repository-specific behavior:**
   Do not introduce requirement-ID-specific logic (e.g., FR-*-specific
   mappings or special cases).

3. **No opportunistic refactoring:**
   Do not clean up, rename, reorganize, or improve code beyond what is
   necessary for the fix.

4. **DF-002 regression-preservation contract:**
   The following are LOCKED and must not change:
   - Profile defaults or execution budgets
   - 20s verdict-time reserve or verdict-safe admission semantics
   - Model-call accounting, retry accounting, or retry admission semantics
   - Throughput/TPM admission behavior
   - Evidence schemas, provenance, sanitization, projection,
     or authoritative-evidence rules
   - Fabricated-evidence rejection or VERIFIED-without-authoritative-evidence
     downgrading
   - Gap chunk sizing or parallel dispatch
   - Verdict guardrails, generated-test cleanup, telemetry semantics,
     or historical-memory isolation

5. **Focused regression tests:**
   Write tests that verify the fix and that the specific regression
   surface is not violated.

6. **Validation sequence:**
   After the code change:
   ```
   npm run typecheck
   npm run lint
   npm run format:check
   npm test                    # full suite
   npm test                    # second run
   npm test                    # third run (confirm determinism)
   npm run build
   ```

7. **Live reproduction (when credentials/environment permit):**
   Re-run the exact scenario that triggered the defect and verify
   the fix resolves it. Record the new diagnostics.

8. **Exact before/after evidence:**
   Report:
   - Files changed (path, line, old value, new value)
   - Diagnostic comparison (old run vs new run)
   - Test results (count, pass/fail)
   - Any behavioral differences beyond the fix

## Prohibited

- Do not increase timeouts, model-call limits, or token budgets unless
  the RCA specifically identified one of these as the root cause
- Do not serialize parallel operations
- Do not suppress errors or weaken validation
- Do not add feature flags or backwards-compatibility shims
- Do not modify locked regression tests (they are specifications)
````

## Troubleshooting

### `npm error Missing script: "qe"`

QE Agent does not have an `npm run qe` script. Use one of:

```bash
# Development mode (from qe-agent directory):
npm run dev -- <command> [options]

# Built CLI:
node dist/cli/main.js <command> [options]
```

### `error: unknown option '--profile'`

`--profile` is an option of the `verify` and `review` commands, not a top-level option.

```bash
# Wrong:
npm run dev -- --profile quick

# Correct:
npm run dev -- verify --profile quick --requirements reqs.md
```

### Missing credentials

If you see errors about API keys or authentication when running `verify` or `review`:

```bash
export OPENAI_API_KEY="sk-..."
```

The `analyze` command does not require credentials.

### OutputTruncationError

This means the model's response exceeded the allocated output token limit and was cut off mid-generation. QE Agent attempts to recover by doubling the token allocation and retrying.

To investigate, read the diagnostics:

```bash
cat /path/to/project/.qe/runs/<executionId>/diagnostics.json | python3 -m json.tool
```

Look for `providerAttempts` entries with `errorClass: "OutputTruncationError"` and `finishReason: "length"`. Check whether a retry was attempted and whether it succeeded.

This is a transient model-interaction issue, not a target repository problem. If it persists across runs, it may indicate that the requirements set is generating responses near the token ceiling.

### SchemaValidationError

The model returned output that did not conform to the expected schema (e.g., missing a required field, wrong enum value). QE Agent attempts schema repair by providing the error to the model in a follow-up call.

Inspect diagnostics for entries with `errorClass: "SchemaValidationError"`. Check whether the repair retry succeeded.

### RetryBudgetExhausted

A recoverable model failure occurred, but the retry budget for the current profile was already consumed by a previous retry. Under the `quick` profile, only 1 retry is allowed across the entire run.

This typically means two model calls failed in the same run, and the first one consumed the single available retry. The second failure could not be retried.

To investigate, look at the diagnostics timeline: identify which call consumed the retry (`retryAdmitted: true`) and which was denied (`retryAdmitted: false`).

### NOT_VERIFIED results

A requirement assessed as `NOT_VERIFIED` can mean different things:

1. **Evidence was absent:** QE Agent did not execute a command or test that produces relevant evidence. Check whether the `analyze` output discovers the right commands.

2. **Capability was not exercised:** The profile's budget was exhausted before the relevant command could be executed. Try a larger profile (`standard` or `deep`).

3. **Evidence exists but was not mapped:** The model did not associate collected evidence with the requirement. Check the diagnostics gap chunks to see what evidence was available and how requirements were assessed.

4. **Fallback result:** The gap analysis chunk for this requirement failed entirely. Check `diagnostics.json` for gap chunks with `success: false`.

To differentiate, compare the requirement against the evidence list in the output and the gap chunk diagnostics.

## Example End-to-End Session

This example validates a fictional API project using QE Agent.

```bash
# --- Setup ---

# Build QE Agent (one-time)
cd ~/Development/qe-agent
npm install
npm run build
node dist/cli/main.js --version
# Output: 0.1.0

# Set API credentials (for verify/review)
export OPENAI_API_KEY="sk-proj-your-key-here"

# --- Analyze the target project ---

node ~/Development/qe-agent/dist/cli/main.js analyze \
  --repo ~/Development/acme-api

# Review the output to confirm QE discovers:
# - Languages (e.g., TypeScript)
# - Test frameworks (e.g., Jest)
# - Commands (e.g., npm run test, npm run lint)

# --- Prepare requirements ---

# Ensure acme-api has a requirements file.
# Example: ~/Development/acme-api/docs/requirements.md
#
#   ## FR-001 User Authentication
#   - Unauthenticated requests return HTTP 401
#   - Valid credentials return a JWT token
#
#   ## FR-002 Rate Limiting
#   - Requests exceeding 100/min receive HTTP 429
#   - Rate limit headers are included in responses

# --- Run verification ---

node ~/Development/qe-agent/dist/cli/main.js verify \
  --profile quick \
  --repo ~/Development/acme-api \
  --requirements ~/Development/acme-api/docs/requirements.md

# --- Read the verdict ---
# The output shows: verdict, confidence, risk assessment,
# requirement assessments, gaps, and recommended actions.

# --- Locate diagnostics ---

ls ~/Development/acme-api/.qe/runs/
# Output: a directory named with the execution ID

cat ~/Development/acme-api/.qe/runs/*/diagnostics.json | python3 -m json.tool | head -40

# --- Check target repository state ---

cd ~/Development/acme-api
git status --short
# Expect: clean working tree (no untracked or modified files)

# --- Evaluate the run ---
# - Were all requirements model-assessed? (Check gap chunks in diagnostics)
# - Is the verdict reasonable given the project's actual state?
# - Were any commands executed that should not have been?
# - Is the repository clean?
```
