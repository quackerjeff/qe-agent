# ADR-004 — Evidence-First QE Model

**Status:** Accepted

## Context

An autonomous QE system must be trustworthy. LLM reasoning alone cannot establish that software behavior has actually been validated.

## Decision

Evidence SHALL be a first-class immutable domain concept.

QE conclusions SHALL distinguish deterministic execution evidence from AI inference and unverified assumptions.

A successful test result may only be claimed when corresponding execution evidence exists.

## Alternatives Considered

- prose-only agent reports;
- treating model reasoning as sufficient validation;
- relying exclusively on existing test-suite status.

## Consequences

Execution, evidence capture, findings, and verdicts require explicit relationships.

This adds structure but significantly improves auditability and trust.
