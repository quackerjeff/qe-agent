# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the QE Agent.

ADRs document significant technical decisions that affect the architecture, extensibility, security, or long-term maintainability of the product.

## Status Values

An ADR may be:

- **Proposed** — under consideration.
- **Accepted** — current architectural direction.
- **Superseded** — replaced by a later ADR.
- **Deprecated** — retained for historical context but no longer recommended.

## ADR Structure

Each ADR should contain:

1. **Status**
2. **Context**
3. **Decision**
4. **Alternatives Considered**
5. **Consequences**

## Modification Policy

Accepted ADRs represent historical decisions.

If an accepted architectural decision materially changes, prefer creating a new ADR that supersedes the previous decision rather than rewriting history.

Minor clarifications that do not alter the decision may be made directly.

## Current ADRs

- [ADR-001 — TypeScript Reference Implementation](001-typescript-reference-implementation.md)
- [ADR-002 — Adapter-Based Capability Architecture](002-adapter-based-capability-architecture.md)
- [ADR-003 — Model Provider Abstraction](003-model-provider-abstraction.md)
- [ADR-004 — Evidence-First QE Model](004-evidence-first-qe-model.md)
- [ADR-005 — Test Modification Without Production-Code Modification](005-test-modification-without-production-code-modification.md)
- [ADR-006 — Repository-Local Persistent QE Knowledge](006-repository-local-persistent-qe-knowledge.md)
- [ADR-007 — Local and Docker Execution Strategy](007-local-and-docker-execution-strategy.md)
- [ADR-008 — Playwright as Initial Browser Adapter](008-playwright-as-initial-browser-adapter.md)
- [ADR-009 — Canonical QE Result Contract](009-canonical-qe-result-contract.md)
- [ADR-010 — State-Machine and Single-Orchestrator Architecture](010-state-machine-and-single-orchestrator-architecture.md)
- [ADR-011 — OpenCode Harness as an Invocation Integration](011-opencode-as-invocation-integration.md)
- [ADR-012 — Playwright MCP as Browser Fallback Adapter](012-playwright-mcp-browser-fallback.md)
- [ADR-013 — Kiro Harness as an Invocation Integration](013-kiro-as-invocation-integration.md)
