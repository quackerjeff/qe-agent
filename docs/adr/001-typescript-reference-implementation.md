# ADR-001 — TypeScript Reference Implementation

**Status:** Accepted

## Context

QE Agent requires a portable implementation suitable for CLI tooling, asynchronous orchestration, structured data, GitHub integration, browser automation, and eventual service deployment.

## Decision

The reference implementation SHALL use TypeScript running on Node.js.

This decision applies to QE Agent itself and does not restrict the languages or frameworks QE Agent may evaluate.

## Alternatives Considered

- Python
- Go
- .NET

## Consequences

TypeScript becomes the primary implementation language for MVP. Language-specific QE capabilities remain isolated behind adapters.
