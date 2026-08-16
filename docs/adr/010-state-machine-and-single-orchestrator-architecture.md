# ADR-010 — State-Machine and Single-Orchestrator Architecture

**Status:** Accepted

## Context

A largely unconstrained autonomous agent loop could produce a rapid prototype but would make execution difficult to understand, reproduce, test, govern, and evaluate.

The MVP also does not yet have evidence that a hierarchy of cooperating autonomous agents improves QE effectiveness enough to justify its complexity.

## Decision

The MVP SHALL use a single QE Orchestrator operating through an explicit lifecycle/state machine.

Logical reasoning roles MAY include:

- repository analyst;
- risk analyst;
- test strategist;
- failure investigator;
- gap analyst;
- verdict reviewer.

These roles MAY execute as separate bounded model calls through the Model Gateway.

They SHALL NOT operate as autonomous peer-to-peer agents or as a hierarchical multi-agent system during MVP.

State transitions SHALL be observable and recorded.

Specialized autonomous agents MAY be introduced after MVP only when evaluation demonstrates a material improvement in QE effectiveness sufficient to justify the additional complexity.

## Alternatives Considered

- unrestricted ReAct-style autonomous agent;
- multiple cooperating QE agents;
- agent hierarchy with a QE Lead supervising specialist agents;
- entirely deterministic orchestration without model reasoning.

## Consequences

QE execution will be easier to test, audit, reproduce, and reason about.

Some agent flexibility is intentionally sacrificed during MVP.

The architecture preserves the ability to introduce specialized agents later if empirical evaluation supports doing so.
