# QE Agent

Autonomous Quality Engineering Agent.

The QE Agent is an autonomous software quality engineering system that evaluates source-code repositories and proposed code changes. It determines an appropriate validation strategy, executes available quality checks, generates additional tests when justified, investigates failures, and produces an evidence-supported QE verdict.

## Status

**MVP — Milestone 0 (Foundation)**

The project foundation is established: TypeScript project, CLI entry point, core domain types, configuration loading, structured logging, execution IDs, model-provider abstraction, and automated testing infrastructure.

No autonomous QE behavior is implemented yet.

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
