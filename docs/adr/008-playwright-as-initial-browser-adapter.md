# ADR-008 — Playwright as Initial Browser Adapter

**Status:** Accepted

## Context

Browser-based applications require validation beyond unit and API testing, but browser automation should not be mandatory for non-browser projects.

## Decision

Browser testing SHALL be an optional MVP capability.

Playwright SHALL be the initial browser automation adapter.

## Alternatives Considered

- Selenium;
- Cypress;
- postponing browser testing until after MVP.

## Consequences

Browser-capable projects can receive workflow-level QE validation during MVP.

The core engine SHALL remain independent of Playwright through the adapter architecture.
