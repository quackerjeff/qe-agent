# QE Agent

Autonomous Quality Engineering Agent.

The QE Agent is an autonomous software quality engineering system that evaluates source-code repositories and proposed code changes. It determines an appropriate validation strategy, executes available quality checks, generates additional tests when justified, investigates failures, and produces an evidence-supported QE verdict.

## Status

**MVP — Milestone 2 (Safe Execution & Evidence)**

The QE Agent can analyze repository structure (Milestone 1) and execute explicitly selected commands through a controlled interface with safety policies, secret redaction, and immutable evidence capture (Milestone 2).

The agent does not yet autonomously select which commands to run. No LLM provider is required.

## Prerequisites

- Node.js >= 20.0.0
- npm

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

After building (`npm run build`), the CLI is also available as:

```bash
node dist/cli/main.js --help
node dist/cli/main.js init
```

## Documentation

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
