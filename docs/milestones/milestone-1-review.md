# Independent Review Assignment — Milestone 1: Repository Intelligence

**Milestone:** 1  
**Review Type:** Independent implementation review  
**Target:** Repository Intelligence  
**Implementation Specification:** `docs/milestones/milestone-1-repository-intelligence.md`

# Objective

Perform an independent review of the completed Milestone 1 implementation.

You are a reviewer, not the implementation agent.

Do not assume the implementation agent's completion report is correct.

Inspect the actual repository, implementation, tests, fixtures, and Git diff.

Do NOT modify code during this review.

# Required Reading

Before reviewing the implementation, read:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. all accepted ADRs under `docs/adr/`
5. `docs/milestones/milestone-1-repository-intelligence.md`
6. the Milestone 1 implementation report, if present

Treat the implementation report only as a claim of what was implemented.

Verify those claims independently.

# Primary Review Question

Determine whether Milestone 1 reliably answers:

> **What is this repository, and how does available deterministic evidence suggest it is built and tested?**

Milestone 1 must remain observational.

It must NOT execute discovered project build, test, install, start, browser, or other application commands.

# Review Areas

## 1. Milestone Scope

Verify that Milestone 1 implements repository intelligence without prematurely implementing later milestones.

Specifically verify that the implementation does NOT perform:

- project build execution;
- project test execution;
- dependency installation;
- Docker execution;
- browser execution;
- application startup;
- autonomous QE reasoning;
- LLM-based repository analysis;
- risk reasoning;
- validation-plan reasoning;
- test generation;
- failure investigation;
- verdict generation;
- GitHub check/report integration;
- GitHub issue creation;
- project-memory behavior;
- multi-agent orchestration.

Safe deterministic Git metadata queries are permitted.

Flag any scope creep.

---

## 2. `qe analyze`

Exercise:

```text
qe analyze
```

Verify that it:

- analyzes the current repository;
- resolves the repository root correctly;
- works from a nested directory;
- produces useful human-readable output;
- does not imply that discovered commands were executed;
- produces a validated `RepositoryProfile`.

If implemented, also test:

```text
qe analyze --repo <path>
qe analyze --json
```

Verify behavior against the milestone requirements.

---

## 3. Repository Root Discovery

Review repository-root discovery.

Verify:

- Git repositories are correctly identified;
- nested working directories resolve correctly;
- non-Git source directories can still be analyzed where intended;
- lack of `.git` does not automatically make analysis fail;
- Git-specific behavior does not leak unnecessarily into the repository-analysis domain model.

---

## 4. Repository Inventory

Inspect the inventory implementation.

Verify that it:

- discovers relevant metadata files;
- excludes obvious dependency/generated directories;
- does not recursively ingest unnecessary repository contents;
- remains bounded;
- does not follow dangerous/unnecessary filesystem paths;
- handles reasonable repository sizes safely.

Look specifically for accidental traversal of:

```text
node_modules/
.git/
dist/
build/
coverage/
vendor/
target/
bin/
obj/
.venv/
venv/
```

where appropriate.

Flag unbounded recursive scanning.

---

## 5. Evidence-Backed Detection

This is a critical review area.

Every material technology detection should have supporting provenance.

Verify detections such as:

```text
TypeScript
Python
.NET
React
pytest
Vitest
pnpm
Playwright
GitHub Actions
```

can explain why they were detected.

Look for detections that exist merely because an adapter returned a label.

A detection without evidence should either:

- be explicitly classified as heuristic; or
- be considered invalid.

---

## 6. Confidence

Review the confidence model.

Verify that confidence:

- is deterministic;
- is understandable;
- reflects evidence strength;
- does not imply unsupported statistical precision;
- handles conflicting evidence sensibly.

Confirm stronger evidence produces stronger confidence than weak filename/directory heuristics.

Do not require a sophisticated scoring algorithm.

Prefer simple, explainable behavior.

---

## 7. Adapter Architecture

Verify ADR-002 is genuinely preserved.

Ecosystem-specific detection should live behind adapters or similarly isolated capability providers.

Look for large blocks such as:

```text
if Node...
else if Python...
else if .NET...
```

inside the central analyzer/orchestrator.

Flag ecosystem-specific behavior leaking into core orchestration.

Adapters should remain small and focused.

Do not require abstractions beyond what Milestone 1 actually needs.

---

## 8. Language Detection

Verify deterministic language detection for the required initial languages.

Check that generated/vendor content does not distort language detection.

Verify source extensions alone are not treated as definitive proof of an ecosystem.

Test at least one repository containing misleading files or generated content if fixtures make this practical.

---

## 9. Package Manager Detection

Verify package-manager detection and evidence.

Pay particular attention to ambiguous JavaScript repositories.

For example, if both:

```text
package-lock.json
pnpm-lock.yaml
```

exist, the analyzer should not silently pretend certainty about which package manager is authoritative.

Verify ambiguity is preserved or clearly represented.

---

## 10. Framework Detection

Verify framework detections rely on reasonable evidence such as dependency metadata or explicit configuration.

Flag framework detection based only on weak filenames unless confidence reflects that weakness.

Unknown frameworks must not cause repository analysis to fail.

---

## 11. Test Framework Detection

Verify supported test-framework detection.

Ensure the analyzer distinguishes:

> test framework detected/configured

from:

> tests executed successfully

No output should imply that a discovered test suite passed.

---

## 12. Test Location Discovery

Review test-location discovery.

Verify it finds common patterns without ingesting or parsing the entire test suite unnecessarily.

Check behavior for:

```text
tests/
test/
__tests__/
spec/
e2e/
*.test.*
*.spec.*
```

where applicable.

---

## 13. Repository Instruction Discovery

Verify discovery of:

```text
README*
CONTRIBUTING*
AGENTS.md
CLAUDE.md
docs/
```

Review any content-reading behavior.

Ensure documentation reading is bounded.

Verify discovered commands retain provenance back to the documentation/configuration from which they were obtained.

---

## 14. CI Discovery

Review GitHub Actions detection and workflow parsing.

Verify that:

- workflows may provide repository intelligence;
- workflow commands are not executed;
- GitHub-specific parsing remains repository intelligence rather than becoming core GitHub integration;
- malformed or complex workflows fail gracefully.

Do not require a complete GitHub Actions interpreter.

---

## 15. Command Discovery

This is another critical review area.

Inspect how commands are discovered from:

- package scripts;
- Makefile targets;
- README documentation;
- CI workflows;
- project metadata.

Every discovered command should have provenance.

Verify that command discovery does NOT cause command execution.

Look for dangerous accidental behavior such as:

```text
exec()
spawn()
execSync()
system()
shell execution libraries
```

being used to validate discovered project commands.

Git metadata commands may be an exception when used only for repository inspection.

---

## 16. Capability Registry

Verify that discovered capabilities represent:

> evidence that a capability appears available

rather than:

> proof that the capability works.

Review capability IDs for consistency.

Capabilities should include appropriate confidence/evidence.

Verify capability population occurs through the adapter/capability architecture rather than a large hard-coded central mapping.

---

## 17. Unknown / Custom Repository Behavior

Run the analyzer against the unknown/custom fixture.

This is a critical product behavior.

Verify that an unfamiliar ecosystem still produces useful intelligence from:

- documentation;
- CI;
- Makefile/build scripts;
- source structure;
- test directories;
- custom commands.

Unknown technology SHALL NOT be treated as an error.

---

## 18. Monorepository Behavior

Review obvious monorepo/multi-project handling.

Verify the analyzer does not assume one root-level package/build file describes every subproject.

Milestone 1 does not require a dependency graph.

Flag either extreme:

- no awareness of multiple project roots;
- excessive monorepo architecture beyond milestone scope.

---

## 19. RepositoryProfile Schema

Review changes to the Milestone 0 `RepositoryProfile`.

Verify:

- the schema is runtime validated;
- fields added by Milestone 1 are justified;
- evidence/provenance is preserved;
- unnecessary future concepts were not added;
- domain types remain independent of GitHub and specific LLM providers.

Review any other Milestone 0 schema changes for unintended contract drift.

---

## 20. Fixture Quality

Inspect the actual fixtures.

At minimum verify useful fixtures exist for:

- JavaScript / TypeScript;
- Python;
- .NET;
- unknown/custom repository.

If browser detection is implemented, verify an appropriate Playwright detection fixture exists.

Fixtures should be:

- small;
- deterministic;
- understandable;
- free from dependency installation requirements;
- intentionally designed to test repository intelligence.

Do not judge fixture quality solely by fixture count.

---

## 21. Test Quality

Review tests for meaningful behavior.

Look specifically for coverage of:

- repository root detection;
- nested directory handling;
- non-Git directories;
- evidence provenance;
- confidence differences;
- conflicting package-manager evidence;
- unknown repositories;
- generated/vendor exclusion;
- command provenance;
- CI discovery;
- capability population;
- adapter behavior;
- schema validation.

Flag tests that merely reproduce implementation details without validating useful behavior.

---

## 22. Security / Safety

Verify Milestone 1 remains observational.

Search for all process-execution mechanisms.

Determine exactly what external commands can execute.

Git metadata operations are acceptable where necessary.

Project-defined commands SHALL NOT execute.

Also review:

- symlink handling;
- filesystem traversal;
- unexpectedly large file reads;
- secret exposure in output;
- unsafe parsing assumptions.

Do not demand a production-grade sandbox during Milestone 1.

---

## 23. Performance / Boundedness

Perform a reasonable assessment of repository scanning behavior.

Look for:

- reading every file;
- loading entire large files unnecessarily;
- recursively scanning ignored directories;
- repeated filesystem traversal;
- O(n²)-style behavior where avoidable.

Milestone 1 does not require extensive performance optimization.

Flag obvious architectural problems that would make ordinary repositories painful to analyze.

---

## 24. Repository Hygiene

Check:

- build output is ignored;
- dependencies are not committed;
- fixture junk is not committed;
- `.qe/` is not globally ignored if durable QE files are intended to be version controlled;
- local AI-tool state is not unintentionally committed;
- no secrets are present;
- no temporary analysis output is tracked.

---

## 25. Dependency Review

Review dependencies introduced during Milestone 1.

Every new dependency should have a concrete current-milestone purpose.

Flag:

- agent frameworks;
- LLM SDKs;
- unnecessary GitHub SDKs;
- execution frameworks;
- large parser frameworks where simple parsing would suffice;
- dependencies added only for future milestones.

---

# Required Demonstrations

Independently run repository analysis against at least:

## JavaScript / TypeScript Fixture

Verify:

- ecosystem;
- language;
- package manager;
- test framework;
- commands;
- capabilities;
- evidence.

## Python Fixture

Verify:

- ecosystem;
- language;
- package manager;
- test framework;
- commands;
- capabilities;
- evidence.

## .NET Fixture

Verify:

- ecosystem;
- build tooling;
- test framework;
- commands;
- capabilities;
- evidence.

## Unknown / Custom Fixture

Verify useful analysis occurs without a recognized specialized ecosystem.

Also run `qe analyze` against the QE Agent repository itself.

---

# Required Validation

Run the project's documented validation independently.

At minimum:

```text
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

Exercise the built CLI rather than relying only on unit tests.

Do not rely on the implementation agent's reported validation.

# Output Format

Produce the following review report.

## Verdict

Choose exactly one:

- ACCEPT
- ACCEPT WITH MINOR CHANGES
- CHANGES REQUIRED
- REJECT

## Executive Assessment

Briefly explain the verdict.

## Acceptance Criteria

Evaluate **every acceptance criterion** in:

`docs/milestones/milestone-1-repository-intelligence.md`

Mark each:

- PASS
- PARTIAL
- FAIL

Explain all PARTIAL or FAIL results.

## Findings

For each finding provide:

**Severity**

- BLOCKER
- HIGH
- MEDIUM
- LOW
- INFORMATIONAL

**Location**

Relevant file(s).

**Description**

What was found.

**Why It Matters**

Connect the issue to product correctness, architecture, safety, maintainability, or milestone requirements.

**Recommended Correction**

Give a bounded recommendation.

Do not implement it.

## Architecture Assessment

Explicitly assess compliance with:

- ADR-001
- ADR-002
- ADR-003
- ADR-004
- ADR-005
- ADR-006
- ADR-007
- ADR-008
- ADR-009
- ADR-010

Also assess relevant `AGENTS.md` constraints.

## Evidence / Confidence Assessment

Evaluate whether repository detections are genuinely evidence-backed and whether confidence is understandable.

## Safety Assessment

State whether Milestone 1 executes any project-defined commands.

If it does, identify them precisely.

## Scope Assessment

Identify any later-milestone functionality that was implemented.

If none, explicitly state none.

## Fixture Assessment

Evaluate whether fixtures meaningfully exercise repository intelligence.

## Validation Results

Report commands actually executed and their results.

## Recommended Actions Before Milestone 2

Separate findings into:

### Must Fix

Issues that should be corrected before Milestone 2.

### Should Fix

Useful corrections that do not block Milestone 2.

### Defer

Valid concerns that belong to later milestones.

## Final Recommendation

State whether Milestone 1 should be:

- accepted as-is;
- corrected and re-reviewed;
- substantially reworked.

Do not modify the repository.

Stop after producing the review.