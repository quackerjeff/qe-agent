# ADR-009 — Canonical QE Result Contract

**Status:** Accepted

## Context

QE Agent will be invoked through multiple interfaces including CLI, GitHub Actions, and future programmatic integrations.

These interfaces must not develop independent interpretations of QE results.

## Decision

QE Agent SHALL produce a canonical structured `QEResult`.

CLI reports, Markdown reports, GitHub checks, and future integrations SHALL derive their output from this canonical result.

## Alternatives Considered

- integration-specific output models;
- prose-only output;
- GitHub as the canonical representation.

## Consequences

QE results become portable, testable, and suitable for both human and machine consumption.

Changes to the canonical contract must be managed carefully as the product evolves.
