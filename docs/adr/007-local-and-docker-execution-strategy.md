# ADR-007 — Local and Docker Execution Strategy

**Status:** Accepted

## Context

QE Agent needs to execute repository code while balancing usability and isolation.

Building proprietary sandbox infrastructure is outside MVP scope.

## Decision

MVP SHALL support local execution and Docker-based isolated execution.

GitHub Actions SHALL provide an additional CI execution environment.

Docker SHOULD be preferred for unfamiliar repository code where practical.

All execution SHALL flow through the Execution Controller abstraction.

## Alternatives Considered

- local execution only;
- dedicated ephemeral VMs;
- Kubernetes;
- proprietary hosted sandbox infrastructure.

## Consequences

MVP remains simple while preserving an abstraction through which stronger sandboxing can later be introduced.

Local execution of untrusted repositories remains a recognized security risk and must be clearly represented.
