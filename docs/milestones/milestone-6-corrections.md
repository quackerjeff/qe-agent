Milestone 6 Correction Assignment — Project-Local QE Memory

Milestone: 6
Status: Accepted
Completed: 2026-08-17
Accepted: 2026-08-17
Purpose: Resolve independent Milestone 6 review findings
Next Milestone: Do NOT begin Milestone 7

Required Reading

Before modifying code, read:

- AGENTS.md
- docs/milestones/milestone-6-project-memory.md
- docs/milestones/milestone-6-review.md
- relevant PRD/System Design sections
- all accepted ADRs
- the Milestone 6 completion report
- the independent Milestone 6 review findings

Inspect actual implementation before making changes.

Preserve the existing ProjectMemoryManager and repository-local memory architecture.

Do not begin Milestone 7.

Objective

Correct Milestone 6 so that:

1. explicitly known secrets cannot persist to memory;
2. durable factual memory updates require valid evidence where appropriate;
3. CLI verify/review honor memory configuration;
4. stale deterministic conflicts are surfaced without depending solely on model cooperation;
5. memory metrics are canonical/reportable;
6. runtime-created .qe/ state gets appropriate ignore rules.

1. EXPLICIT KNOWN-SECRET ENFORCEMENT — CRITICAL

Current memory protection relies on generic regex secret detection.

That is insufficient.

The system already has explicit known-secret values available in execution/QE context.

Thread known secrets into the memory pipeline.

Known secrets must be considered during:

- memory-distillation output handling;
- MemoryUpdateProposal validation;
- memory application;
- memory reporting;
- history summary creation;
- QEResult memoryUpdates / memoryWarnings serialization if proposal content is surfaced.

A proposal containing an explicitly known secret value must either:

- be rejected; or
- be redacted before persistence.

Prefer reject-on-secret for durable memory writes unless a clearly useful redacted form exists.

Required tests:

A. Unlabelled secret

Known secret:
TOPSECRET-M6

Proposal content:
"The current test token is TOPSECRET-M6"

Expected:
raw value not persisted

B. API-like secret

Known secret:
sk-test-secret

Proposal content contains:
sk-test-secret

Expected:
raw value not persisted

C. Multiple occurrences

Known secret appears multiple times.

Expected:
no occurrence persists.

D. Memory surfaces

Verify raw secret absent from:

- PROJECT.md
- TESTING.md
- RISKS.md
- knowledge/*.md
- history summaries
- QEResult.memoryUpdates
- QEResult.memoryWarnings
- logs

Do not rely only on regex format matching.

2. EVIDENCE-BACKED DURABLE MEMORY — CRITICAL

Prompt guidance is not sufficient.

Durable factual claims must be validated deterministically before write.

Examples of claims requiring evidence:

- "Feature X has been verified"
- "Payment rounding fails for negative refunds"
- "This test is flaky"
- "This regression was introduced by the current change"
- "This generated regression test covers requirement R-12"

For proposals that assert confirmed product/runtime/test behavior:

- require one or more current-run evidence IDs;
- validate each evidence ID exists;
- validate evidence type/status is appropriate to support the claim.

If evidence is missing or invalid:

- reject the proposal; OR
- downgrade/reclassify it as hypothesis/risk language if the design supports that safely.

Do not silently persist unsupported confirmed facts.

Implement the smallest deterministic classification needed to distinguish:

CONFIRMED_FACT
TESTING_PROCEDURE
PROJECT_METADATA
RISK_OR_HYPOTHESIS
HISTORY_SUMMARY

or an equivalent model.

Not every memory update requires execution evidence.

Examples that may be supported by deterministic repository facts:

- canonical package manager;
- test command;
- project structure;
- known test directory.

Examples that require execution evidence:

- observed defect;
- regression status;
- flaky behavior;
- verified runtime behavior.

Required tests:

A. Unsupported verified claim

Proposal:
"Feature X has been verified"

evidenceIds: []

Expected:
not persisted as confirmed fact.

B. Fake evidence ID

evidenceIds:
["does-not-exist"]

Expected:
rejected.

C. Valid evidence

Proposal:
"Refund boundary test fails for negative amount"

evidenceIds:
[valid failing execution evidence]

Expected:
may be persisted.

D. Deterministic repository fact

Proposal:
"Tests use Vitest"

Supported by RepositoryProfile metadata.

Expected:
may persist without execution evidence if current deterministic repository evidence supports it.

3. CLI MEMORY CONFIGURATION — CRITICAL

The production CLI paths must honor:

memory.enabled
memory.historySummaries

Update qe verify and qe review wiring so QEOrchestrator receives the actual loaded memory configuration.

Required behavior:

memory.enabled = false

Expected:

- memory is not loaded;
- memory is not added to reasoning context;
- memory updates are not proposed;
- memory updates are not applied;
- memory files are not created.

memory.enabled = true

Expected:
normal memory behavior.

historySummaries = false

Expected:
no history summary written.

historySummaries = true

Expected:
summary may be written according to policy.

Add regression coverage through the real CLI command handler/factory path, not only direct QEOrchestrator construction.

4. DETERMINISTIC STALE-MEMORY CONFLICT DETECTION

Current stale warnings depend too heavily on model-returned staleEntries.

Add deterministic conflict detection for high-confidence repository facts where practical.

At minimum cover canonical command/package-manager conflicts.

Example:

TESTING.md:
npm test

Current RepositoryProfile:
pnpm
pnpm test

Expected:

- current repository evidence wins;
- stale/conflict warning is emitted;
- runtime planning does not prefer stale npm command;
- correction may be proposed.

Do not attempt broad semantic contradiction detection.

Keep this focused on deterministic facts such as:

- package manager;
- discovered test command;
- build command;
- framework/tooling identity where high-confidence.

5. MEMORY METRICS IN CANONICAL RESULT

Expose truthful memory metrics through QEResult.metrics or approved run metadata.

At minimum:

memoryFilesRead
memoryEntriesUsed
memoryUpdatesProposed
memoryUpdatesApplied
memoryUpdatesRejected
memoryConflicts

Verify metrics are based on actual operations.

Add tests covering:

- no memory;
- memory loaded;
- update applied;
- update rejected;
- stale conflict.

6. RUNTIME .qe/.gitignore

When runtime memory creation causes `.qe/` to be created, ensure an appropriate:

.qe/.gitignore

exists.

It should ignore ephemeral content such as:

runs/
cache/
artifacts/
traces/

It must NOT ignore durable memory:

PROJECT.md
TESTING.md
RISKS.md
knowledge/
history/summaries/

Do not overwrite a developer's existing `.qe/.gitignore`.

If absent, create a minimal safe default.

7. PRESERVE HUMAN CONTENT

Re-run human-content preservation tests after these corrections.

Memory validation/rejection logic must not cause managed-section updates to overwrite unrelated content.

8. PRESERVE REPOSITORY CONFINEMENT

Do not regress:

- repository-local `.qe/`;
- traversal denial;
- absolute escape denial;
- symlink escape denial;
- atomic writes.

9. PRESERVE MEMORY VS EVIDENCE

Memory remains advisory.

Even after adding evidence-aware persistence:

- memory itself is still not current-run evidence;
- current run requirements cannot become VERIFIED from persisted memory alone;
- new memory created during the current run cannot retroactively strengthen the current verdict.

10. PRESERVE TWO-RUN BEHAVIOR

Re-run the two-run persistence scenario.

Run 1:
learn durable testing procedure
→ persist

Run 2:
fresh QEOrchestrator
fresh FakeModelGateway
→ load persisted memory
→ relevant reasoning context includes it

No shared in-memory/session state.

11. PRESERVE REPOSITORY ISOLATION

Re-run Repo A / Repo B isolation.

No global state or singleton should leak memory.

12. DO NOT IMPLEMENT

Do NOT implement:

- GitHub Actions integration
- GitHub check publishing
- GitHub issue creation
- SaaS memory service
- vector database
- embedding search
- cross-project memory
- organizational memory
- multi-agent orchestration

Required Regression Tests

At minimum add tests proving:

1. explicitly known TOPSECRET-M6 cannot persist;
2. explicitly known sk-test-secret cannot persist;
3. known secrets cannot leak through QEResult memory fields;
4. unsupported confirmed fact is rejected;
5. nonexistent evidence ID is rejected;
6. valid execution evidence may support durable confirmed fact;
7. deterministic repository facts may support durable metadata appropriately;
8. CLI verify honors memory.enabled=false;
9. CLI review honors memory.enabled=false;
10. historySummaries=false prevents summary creation;
11. stale npm-vs-pnpm conflict is detected deterministically;
12. current repo facts win over stale memory;
13. memory metrics appear in canonical result;
14. runtime-created .qe/ gets safe .gitignore;
15. human content remains preserved;
16. two-run persistence still works;
17. repository isolation still works.

Required Validation

Run:

npm test -- tests/milestone-6-memory.test.ts

Run targeted CLI/config tests if separate.

Then:

npm run build
npm test
npm run lint
npm run format:check
npm run typecheck

Run the memory-sensitive suite twice.

Verify:

- no temp repos remain unexpectedly;
- no secret-bearing temp files remain;
- no memory leaks between repos.

Completion Report

Provide:

Secret Safety
- how explicit known secrets are threaded into memory;
- reject/redact behavior;
- test results.

Evidence Enforcement
- how proposal claims are classified;
- which claims require evidence;
- invalid evidence behavior;
- valid evidence behavior.

CLI Configuration
- verify/review wiring;
- memory.enabled=false demonstration;
- historySummaries behavior.

Stale Memory
- deterministic conflict detection;
- npm-vs-pnpm demonstration.

Metrics
- canonical fields;
- actual example values.

.gitignore
- runtime creation behavior;
- preservation of existing developer file.

Regression Safety
- memory vs evidence;
- human-content preservation;
- repository confinement;
- two-run persistence;
- repo isolation.

Validation Results
- exact command results.

Scope Confirmation
Explicitly confirm:
- no GitHub integration;
- no SaaS memory;
- no vector DB;
- no cross-project memory;
- no multi-agent orchestration.

Stop after completing Milestone 6 corrections.

Do not begin Milestone 7.
