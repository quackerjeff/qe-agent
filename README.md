# QE Agent

Autonomous Quality Engineering Agent.

The QE Agent is an autonomous software quality engineering system that evaluates source-code repositories and proposed code changes. It determines an appropriate validation strategy, executes available quality checks, generates additional tests when justified, investigates failures, and produces an evidence-supported QE verdict.

## Status

**MVP — Milestone 3 (QE Reasoning)**

The QE Agent can analyze repositories, execute validation commands through a controlled interface, and now perform bounded QE reasoning: change analysis, risk assessment, validation planning, evidence-based gap analysis, and verdict generation.

An LLM provider is required for reasoning capabilities. Configure access via environment variables or a git-ignored `.env` file (see `.env.example`) — keys, addresses, and model names are never committed.

## Prerequisites

- Node.js >= 20.0.0
- npm
- `OPENAI_API_KEY` environment variable (for QE reasoning)

## Installation

```bash
npm install
```

## Development Commands

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Lint

```bash
npm run lint
```

### Format Check

```bash
npm run format:check
```

### Format (auto-fix)

```bash
npm run format
```

### Type Check

```bash
npm run typecheck
```

### Full Validation

```bash
npm run check
```

## CLI Usage

### Help

```bash
npx tsx src/cli/main.ts --help
```

### Version

```bash
npx tsx src/cli/main.ts --version
```

### Initialize QE Configuration

```bash
cd your-repository
npx tsx /path/to/qe-agent/src/cli/main.ts init
```

This creates `.qe/config.yml` with default configuration. Running `init` again will not overwrite existing configuration.

### Analyze Repository

```bash
npx tsx src/cli/main.ts analyze --repo /path/to/repo
npx tsx src/cli/main.ts analyze --json
```

### Execute Commands

All project command execution flows through the Execution Controller, which enforces safety policies, timeouts, secret redaction, and evidence capture.

```bash
# Execute a command directly
npx tsx src/cli/main.ts exec --command npm --arg test

# Execute by discovered command ID
npx tsx src/cli/main.ts exec --command-id test:npm:test

# With secret redaction
npx tsx src/cli/main.ts exec --command ./run.sh --env API_KEY=secret123 --secret secret123

# Docker execution (requires Docker)
npx tsx src/cli/main.ts exec --command npm --arg test --mode docker

# JSON output
npx tsx src/cli/main.ts exec --command npm --arg test --json
```

#### Execution Safety

- Commands are structured (executable + args), not opaque shell strings (`shell: false`)
- Working directory is confined to the repository root
- Dangerous executables (rm, mkfs, dd, shutdown) are blocked
- Destructive git operations (push, reset, clean) are blocked
- Timeouts are enforced on all commands (default 300s, max 30min)
- Timed-out process trees are killed via process group signals
- Environment variables are allowlist-filtered, not blindly inherited
- Known secret values are replaced with `[REDACTED]` in all output, logs, and evidence
- Output is truncated at configurable limits with head+tail preservation

**Local execution is not a secure sandbox.** Repository code executed locally runs with the QE Agent's OS privileges. Docker execution with `--network none` provides stronger isolation. Do not execute untrusted repositories without Docker isolation.

### Verify Requirements

Run QE reasoning against supplied requirements:

```bash
# From a requirements file
npx tsx src/cli/main.ts verify --requirements requirements.md

# With inline requirements
npx tsx src/cli/main.ts verify --requirement "Users must log in" --requirement "Admin panel is protected"

# With a specific profile
npx tsx src/cli/main.ts verify --requirements requirements.md --profile deep

# JSON output
npx tsx src/cli/main.ts verify --requirements requirements.md --json
```

Requirements are supplied as Markdown files with headings as requirement titles and bullet points as acceptance criteria. The agent:

1. Discovers the repository structure
2. Assesses risk based on requirements and repository state
3. Plans validation using discovered commands
4. Executes selected validations through the Execution Controller
5. Investigates failures and classifies causes
6. Maps evidence to requirements
7. Identifies verification gaps
8. Produces an evidence-supported verdict

### Review Changes

Run QE reasoning against a Git baseline:

```bash
# Review changes since a baseline
npx tsx src/cli/main.ts review --base main

# With a specific target
npx tsx src/cli/main.ts review --base main --target feature-branch

# With requirements
npx tsx src/cli/main.ts review --base main --requirements requirements.md

# JSON output
npx tsx src/cli/main.ts review --base main --json
```

Change review additionally performs deterministic Git diff collection and semantic change analysis. Failures are classified as INTRODUCED, PRE_EXISTING, or UNKNOWN through optional baseline comparison.

### OpenCode Harness Integration

QE Agent runs inside the [OpenCode](https://opencode.ai) AI coding harness. The repository ships a committed `.opencode/` directory with:

- a read-only **QE operator subagent** (`@qe`) that runs the CLI and reports evidence-backed verdicts;
- slash commands `/qe-analyze`, `/qe-verify <requirements-file>`, `/qe-review <base>`;
- custom tools (`qe_analyze`, `qe_verify`, `qe_review`, `qe_opencode_publish`) exposed via `.opencode/plugins/qe-agent.ts`.

To deliver a completed QE result into a running OpenCode session:

```bash
npx tsx src/cli/main.ts opencode publish --result .qe/runs/<executionId>/result.json --session <session-id>
```

OpenCode is an invocation mechanism, not part of the QE core — see [ADR-011](docs/adr/011-opencode-as-invocation-integration.md).

### Kiro Harness Integration

QE Agent also integrates with [Amazon Kiro](https://kiro.dev). Delivery runs the real `kiro-cli` in headless mode — no server API, no test doubles:

```bash
npx tsx src/cli/main.ts kiro publish --result .qe/runs/<executionId>/result.json --trust-all-tools
```

The repository ships a committed `.kiro/` directory with a **QE operator agent**, always-included steering, boundary-enforcing hooks, and a `/qe-verify` skill. See [ADR-013](docs/adr/013-kiro-as-invocation-integration.md).

### Verdicts

QE verdicts reflect the strength of evidence:

| Verdict | Meaning |
|---------|---------|
| **PASS** | No material defect identified; evidence strongly supports expected behavior |
| **PASS_WITH_CONCERNS** | No blocking defect but meaningful residual risk remains |
| **NEEDS_REVIEW** | Evidence conflicts or material uncertainty requires human judgment |
| **FAIL** | Demonstrated material defect, regression, or violated requirement |
| **BLOCKED** | Critical validation could not be performed; insufficient evidence |

Passing one test command alone cannot produce PASS. The Verdict Engine applies deterministic guardrails that may override the model's recommendation.

### Execution Profiles

| Profile | Model Calls | Duration | Validation Breadth |
|---------|-------------|----------|-------------------|
| `quick` | Up to 6 | 2 min | Minimal high-value |
| `standard` | Up to 12 | 10 min | Balanced |
| `deep` | Up to 24 | 20 min | Thorough |

### Model Configuration

Configure the model provider in `.qe/config.yml`:

```yaml
version: 1
model:
  provider: openai
  model: gpt-4o
reasoning:
  maxModelCalls: 12
```

API keys come from the environment (`OPENAI_API_KEY`), never from config files.

After building (`npm run build`), the CLI is also available as:

```bash
node dist/cli/main.js --help
node dist/cli/main.js init
```

## Using QE Agent on Another Project

QE Agent can validate any software repository, not just itself. Build once, then point it at your project:

```bash
# Build QE Agent
npm install && npm run build

# Set your API key
export OPENAI_API_KEY="sk-..."

# Analyze your project (no API key needed)
node dist/cli/main.js analyze --repo /path/to/your-project

# Verify against requirements
node dist/cli/main.js verify \
  --profile quick \
  --repo /path/to/your-project \
  --requirements /path/to/your-project/docs/requirements.md
```

See the **[User Guide](docs/USER_GUIDE.md)** for complete documentation including requirements format, configuration, diagnostics, troubleshooting, and cross-project acceptance evaluation prompts.

## Documentation

- **[User Guide](docs/USER_GUIDE.md)** — how to build, configure, and use QE Agent
- [Product & Functional Requirements](docs/Automated%20QE%20Agent%20—%20Product%20&%20Functional%20Requirements.md)
- [Technical Product Specification & System Design](docs/QE%20Agent%20—%20MVP%20Technical%20Product%20Specification%20&%20System%20Design.md)
- [Architecture Decision Records](docs/adr/)
- [Repository Instructions for AI Agents](AGENTS.md)
- [Evaluation Fixtures](fixtures/README.md)

## Architecture

The QE Agent is built around these foundational principles:

- **Single QE Orchestrator** with explicit lifecycle/state-machine design
- **Provider-independent model access** through a Model Gateway abstraction
- **Adapter-based capabilities** for ecosystem-specific behavior
- **Deterministic execution** separated from AI reasoning
- **Evidence-first** domain model
- **Repository-local** QE memory under `.qe/`
- **GitHub independence** — GitHub Actions is one invocation mechanism, not the architecture

See the [Technical Product Specification](docs/QE%20Agent%20—%20MVP%20Technical%20Product%20Specification%20&%20System%20Design.md) for the full system design.
