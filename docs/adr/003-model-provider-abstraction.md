# ADR-003 — Model Provider Abstraction

**Status:** Accepted

## Context

QE reasoning requires LLM capabilities, but the product should not depend permanently on one model vendor.

## Decision

All model access SHALL occur through a Model Gateway abstraction.

Provider-specific integrations SHALL remain outside core QE business logic.

## Alternatives Considered

- direct provider SDK usage throughout the application;
- standardizing permanently on one provider.

## Consequences

Model providers and models can be evaluated and replaced without redesigning the QE core.

The abstraction must remain small enough that useful provider capabilities are not unnecessarily hidden.
