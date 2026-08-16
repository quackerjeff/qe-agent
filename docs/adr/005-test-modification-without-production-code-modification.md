# ADR-005 — Test Modification Without Production-Code Modification

**Status:** Accepted

## Context

QE Agent must remain an independent evaluator rather than becoming the implementation agent responsible for making its own findings disappear.

## Decision

During QE operation, QE Agent MAY create and modify test code.

QE Agent SHALL NOT modify application or production source code.

It MAY propose application changes when defects are discovered.

The restriction SHALL ultimately be enforced by software rather than prompt instructions alone.

## Alternatives Considered

- allowing QE Agent to fix application defects;
- completely read-only QE;
- requiring approval for every generated test.

## Consequences

Permanent regression tests can be created automatically while preserving separation between implementation and independent evaluation.

Defect remediation remains the responsibility of a developer or implementation agent.
