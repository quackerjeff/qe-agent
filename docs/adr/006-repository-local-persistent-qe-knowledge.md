# ADR-006 — Repository-Local Persistent QE Knowledge

**Status:** Accepted

## Context

QE effectiveness should improve as the system learns durable facts about a project, but MVP should not require centralized infrastructure or cross-project memory.

## Decision

Persistent QE knowledge SHALL be project-local and stored under `.qe/`.

Durable knowledge SHOULD be human-readable and suitable for source control.

Raw model conversations SHALL NOT serve as persistent QE memory.

## Alternatives Considered

- centralized database;
- vector database;
- global cross-project agent memory;
- no persistent memory.

## Consequences

QE knowledge travels with the repository and can be shared among developers and CI executions.

Future commercial versions may add other persistence mechanisms without changing the conceptual project-memory model.
