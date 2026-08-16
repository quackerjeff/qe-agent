# ADR-002 — Adapter-Based Capability Architecture

**Status:** Accepted

## Context

QE Agent must operate across many languages, frameworks, test systems, and execution environments without coupling the core engine to individual technologies.

## Decision

Technology-specific behavior SHALL be exposed through adapters and a Capability Registry.

The core QE engine SHALL reason about available capabilities rather than hard-coded ecosystem identities.

## Alternatives Considered

- framework-specific QE implementations;
- hard-coded conditional logic in the orchestrator;
- separate agents for each ecosystem.

## Consequences

Adapters become explicit extension points. Unknown ecosystems can degrade gracefully through generic capabilities.
