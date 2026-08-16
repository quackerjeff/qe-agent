# Milestone 0 Review Corrections

Apply only the approved corrections from the independent Milestone 0 review.

Do not begin Milestone 1.

Before modifying code, read:

1. `AGENTS.md`
2. the Milestone 0 implementation requirements
3. relevant ADRs, especially ADR-004 and ADR-009

## Required Corrections

### 1. Tighten Canonical `QEResult`

The current canonical `QEResultSchema` is too permissive.

A canonical completed QE result SHALL NOT allow a successful verdict such as `PASS` while omitting the core information needed to support that verdict.

Review the Technical Product Specification and make the canonical result contract consistent with:

- ADR-004 — Evidence-First QE Model
- ADR-009 — Canonical QE Result Contract

At minimum, determine whether the following should be required for a completed canonical `QEResult`:

- `repositoryProfile`
- `riskAssessment`
- `validationPlan`
- `evidence`
- `findings`
- `requirements`
- `remainingGaps`
- `verdict`
- `confidence`
- `summary`
- `recommendedNextActions`
- `metrics`

Do not make fields optional merely because later milestones have not implemented the behavior that produces them yet.

If Milestone 0 requires representing incomplete or in-progress execution state, introduce a clearly separate type/schema rather than weakening the canonical completed result.

Add tests proving that an incomplete `PASS` result cannot validate as a canonical completed `QEResult`.

Avoid over-designing future orchestration state.

### 2. Correct `qe init` Filesystem Error Handling

Update `qe init` so that only filesystem `ENOENT` is interpreted as “configuration does not exist.”

Other filesystem read errors, including permission errors and unexpected filesystem states, must surface as useful failures.

Add automated tests where practical.

### 3. Correct `browser.enabled` YAML Semantics

Change the configuration schema so `browser.enabled` accepts:

```yaml
browser:
  enabled: auto
```

or real YAML booleans:

```yaml
browser:
  enabled: true
```

```yaml
browser:
  enabled: false
```

Do not require `"true"` or `"false"` as strings.

Add tests for all supported values.

### 4. Future-Facing Configuration

Keep the current future-facing configuration sections if they match the approved MVP configuration in the Technical Product Specification.

Do not implement their behavior.

Update documentation and/or code comments as appropriate to make clear that configuration for later milestones may be accepted before the corresponding runtime capability exists.

Do not remove approved configuration solely because its implementation milestone has not yet occurred.

### 5. Local Agent Files

If `.claude/` contains only local agent/tooling state, add it to `.gitignore`.

Do not remove or alter developer-local files unnecessarily.

## Do Not Implement

Do not implement:

- repository discovery;
- Git analysis;
- capability detection behavior;
- Execution Controller;
- Docker execution;
- autonomous test execution;
- LLM provider integrations;
- risk reasoning;
- validation planning;
- test generation;
- browser execution;
- GitHub integration;
- project-memory behavior;
- multi-agent orchestration.

## Validation

After corrections, run:

```text
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

Also verify:

```text
qe --help
qe --version
qe init
```

## Completion Report

Report:

### Changes Made

Describe each correction.

### Tests Added or Updated

Identify tests added or changed.

### Validation Results

Provide results for each required command.

### Architecture Impact

State whether any ADR or Technical Product Specification behavior changed.

### Remaining Review Findings

List any independent-review findings intentionally deferred and why.

Stop after completing these corrections. Do not begin Milestone 1.