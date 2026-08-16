# QE Agent — Repository Instructions for AI Coding Agents

## Purpose

This repository contains the QE Agent, an autonomous Quality Engineering system.

AI coding agents working in this repository MUST follow these instructions in addition to the project's Product Requirements and Technical Product Specification.

These instructions govern **development of the QE Agent itself**. They are distinct from the operating rules that the completed QE Agent will use when evaluating other repositories.

---

# Authoritative Documentation

Before implementing significant functionality, read:

1. `docs/Automated QE Agent — Product & Functional Requirements.md`
2. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
3. Relevant ADRs under `docs/adr/`

The documents have the following authority:

**Product & Functional Requirements**

Defines what the product must accomplish and the intended product behavior.

**Technical Product Specification & System Design**

Defines the approved MVP architecture and implementation direction.

**Architecture Decision Records**

Document significant architectural decisions and the rationale behind them.

**AGENTS.md**

Defines rules that AI coding agents must follow while modifying this repository.

If requirements appear contradictory, do not silently choose one interpretation. Identify the conflict before implementing the affected behavior.

---

# Development Philosophy

Build the smallest correct implementation of the current milestone.

Do not attempt to implement the entire product at once.

The MVP is intentionally incremental.

Prefer:

- simple implementations;
- explicit interfaces;
- deterministic behavior;
- strong tests;
- observable execution;
- small modules;
- evidence-backed decisions.

Avoid:

- speculative abstractions;
- premature distributed architecture;
- unnecessary services;
- large agent frameworks;
- hidden behavior;
- unnecessary dependencies.

---

# Milestone Discipline

Implement ONLY the milestone or task explicitly requested.

The full Technical Product Specification provides architectural context. It is not authorization to implement future milestones.

When completing a milestone:

1. satisfy its acceptance criteria;
2. add appropriate automated tests;
3. update relevant documentation;
4. record architectural changes when required;
5. run the project's validation suite;
6. report what was completed;
7. report anything intentionally deferred;
8. stop.

Do not automatically begin the next milestone.

---

# Core Architectural Rules

The following constraints are foundational.

## Single QE Orchestrator

The MVP SHALL use one QE Orchestrator.

Logical reasoning responsibilities may include:

- repository analysis;
- risk analysis;
- test strategy;
- failure investigation;
- gap analysis;
- verdict review.

These responsibilities MAY use separate bounded model calls.

They SHALL NOT be implemented as autonomous peer-to-peer agents or a hierarchical multi-agent system during MVP.

Multi-agent orchestration may be introduced after MVP only if evaluation demonstrates a material QE benefit sufficient to justify the additional complexity.

---

## State-Machine Orchestration

QE execution SHALL follow an explicit lifecycle/state machine.

Do not replace the state-machine architecture with an unconstrained autonomous agent loop.

State transitions must be observable.

The architecture must make it possible to determine:

- what state the QE Agent entered;
- what actions were performed;
- what evidence was collected;
- why execution proceeded to the next state.

---

## LLM Provider Independence

Core QE logic SHALL NOT depend directly on a particular model provider.

All model interaction must occur through the Model Gateway abstraction.

Provider-specific behavior belongs in provider adapters.

Do not scatter OpenAI, Anthropic, or other provider SDK calls throughout the application.

---

## Deterministic Execution

LLMs reason.

Software executes.

LLM output SHALL NOT be considered proof that an action occurred.

Commands, tests, Git operations, filesystem operations, configuration loading, evidence persistence, and policy enforcement must use deterministic components.

---

## Evidence First

Evidence is a first-class domain object.

A QE conclusion must distinguish between:

- executed evidence;
- observed evidence;
- inferred conclusions;
- unverified assumptions.

Never report a test as passing unless it was actually executed successfully.

Never convert missing evidence into a positive result.

---

## Adapter-Based Capabilities

Ecosystem-specific behavior belongs behind adapters.

The QE Orchestrator SHALL NOT contain hard-coded behavior for:

- Node.js;
- Python;
- .NET;
- Playwright;
- Docker;
- GitHub;
- specific test frameworks.

The core should reason in terms of available capabilities.

---

## Safe Execution Boundary

LLM-generated commands SHALL NOT execute directly.

All external command execution must eventually flow through the Execution Controller defined by the Technical Product Specification.

The Execution Controller is responsible for enforcing execution policy.

---

## Production Source Boundary

During QE operation, the QE Agent MAY create or modify:

- test code;
- QE metadata;
- temporary investigative artifacts.

It SHALL NOT modify application/production source code.

This restriction must ultimately be enforced by software, not only by prompting.

If the system cannot confidently determine whether a file is application source or permitted test/QE content, it must deny the write or require explicit approval.

---

## GitHub Is an Integration

GitHub Actions is an invocation mechanism.

GitHub is NOT the QE Agent architecture.

The core QE engine must remain independently usable through the local CLI and programmatic interfaces.

GitHub-specific behavior belongs in the GitHub integration layer.

---

## Project-Local Memory

Persistent QE knowledge belongs within the project being evaluated.

The QE Agent SHALL NOT require global cross-project memory.

Durable project knowledge should be human-readable and suitable for source control under `.qe/`.

Do not store raw model conversations as project knowledge.

---

# Evaluation Is Part of the Product

Do not evaluate QE Agent quality based solely on whether generated reports sound reasonable.

The repository must contain controlled fixture repositories with known behaviors and intentionally seeded defects.

The evaluation harness should eventually measure whether QE Agent:

- detects known defects;
- avoids false positives;
- selects useful validation;
- generates useful tests;
- correctly identifies risk;
- correctly determines verdicts;
- identifies important gaps;
- stays within its execution budget.

When implementing a QE capability, add or update evaluation fixtures when appropriate.

---

# Testing Requirements

Deterministic components should have deterministic automated tests.

Particularly important areas include:

- configuration;
- repository detection;
- Git analysis;
- capability registration;
- adapter detection;
- execution policy;
- write boundaries;
- evidence handling;
- budget enforcement;
- verdict rules.

Model-dependent behavior should be testable using mocked or recorded structured model responses where practical.

Tests must not require unnecessary external services.

---

# Structured LLM Output

LLM responses used for orchestration SHOULD be structured and schema validated.

Do not depend on parsing arbitrary prose when structured output can reasonably be used.

Invalid structured output must not silently enter the domain model.

---

# Context Discipline

Do not assume the entire repository should be sent to an LLM.

The Context Builder should select information relevant to the current reasoning task.

Repository context should remain bounded and explainable.

---

# Dependency Discipline

Before introducing a dependency, determine whether the platform or existing dependencies already provide the required functionality.

Avoid large frameworks for small abstractions.

Every major dependency should have a clear purpose.

Do not introduce an agent framework merely to implement model calls or workflow state.

---

# Security

Treat repositories evaluated by QE Agent as potentially untrusted.

Do not expose privileged secrets to repository code unnecessarily.

Do not persist secrets in:

- logs;
- reports;
- QE memory;
- model prompts;
- committed artifacts.

Execution safety must not depend solely on LLM judgment.

---

# Architectural Changes

Significant architectural decisions require an ADR.

An ADR should explain:

- context;
- decision;
- alternatives considered;
- consequences.

Do not rewrite historical ADRs merely because the implementation later evolves.

If an architectural decision changes, create a superseding ADR.

---

# Definition of Done for Implementation Work

An implementation task is complete only when:

- requested behavior is implemented;
- acceptance criteria are satisfied;
- relevant automated tests exist and pass;
- type checking succeeds;
- linting/formatting requirements succeed when configured;
- documentation affected by the change is updated;
- no known secrets or temporary artifacts were introduced;
- architectural deviations are documented;
- intentionally deferred work is identified.

Passing tests do not justify violating the architecture.

---

# Prohibited Shortcuts

Do not:

- modify tests merely to hide an application defect;
- bypass the Execution Controller for convenience;
- bypass write restrictions;
- hard-code a specific LLM provider into core logic;
- embed GitHub behavior into the QE core;
- create a multi-agent hierarchy during MVP;
- treat model inference as executed evidence;
- silently ignore malformed model output;
- implement future milestones without instruction;
- introduce SaaS infrastructure during MVP;
- add speculative abstractions for hypothetical commercial requirements.

---

# Current Implementation Strategy

The product is being built incrementally.

Unless explicitly instructed otherwise, an implementation agent should:

1. identify the requested milestone;
2. read that milestone in the Technical Product Specification;
3. inspect relevant ADRs;
4. implement only the necessary functionality;
5. validate the implementation;
6. summarize results and stop.

The goal is not to produce the largest amount of code.

The goal is to produce a trustworthy foundation on which autonomous Quality Engineering can be built.