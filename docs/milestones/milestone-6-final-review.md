Final Targeted Re-Review — Milestone 6: Project-Local QE Memory

Milestone: 6
Review Type: Targeted correction re-review
Purpose: Verify the previously identified Milestone 6 blockers are resolved
Do NOT modify the repository.
Do NOT begin Milestone 7.

Required Reading

Read:

- AGENTS.md
- docs/milestones/milestone-6-project-memory.md
- docs/milestones/milestone-6-review.md
- docs/milestones/milestone-6-corrections.md
- latest Milestone 6 correction completion report
- relevant accepted ADRs

Treat the completion report as claims to verify.

Required Verdict

Return exactly one:

ACCEPT
CHANGES REQUIRED
REJECT

Use ACCEPT if the material Milestone 6 blockers are resolved and no new material regression is found.

Do not block for cosmetic cleanup or future enhancements.

1. Explicit Known-Secret Protection — CRITICAL

Reproduce the previously failing cases.

Known secret:
TOPSECRET-M6

Have memory distillation/update propose content containing that exact value in ordinary prose.

Expected:
raw value does not persist.

Repeat with:
sk-test-secret

Also verify multiple occurrences are blocked.

Check all relevant surfaces:

- PROJECT.md
- TESTING.md
- RISKS.md
- knowledge/*.md
- history summaries
- QEResult.memoryUpdates
- QEResult.memoryWarnings
- logs

The test must use explicit supplied knownSecrets, not rely only on regex secret formats.

2. Evidence-Backed Durable Facts — CRITICAL

Attempt to persist:

"Feature X has been verified"

with:
evidenceIds: []

Expected:
not persisted as confirmed fact.

Then attempt with:
evidenceIds: ["does-not-exist"]

Expected:
rejected.

Then use a valid current-run evidence ID supporting a confirmed runtime fact.

Expected:
proposal may be applied.

Also verify deterministic repository facts such as:

"Tests use Vitest"

may persist without execution evidence when supported by current RepositoryProfile evidence.

State whether this behavior is enforced by production code rather than prompt instructions alone.

3. CLI memory.enabled=false — CRITICAL

Exercise the real qe verify and qe review command paths with:

memory:
  enabled: false

Verify:

- memory is not loaded
- no memory context reaches reasoning
- memory_distiller is not called
- no memory updates are proposed/applied
- no memory files are created
- memoryMetrics is absent or appropriately disabled

Do not verify this only through direct QEOrchestrator construction.

4. historySummaries=false

Exercise real config wiring.

Expected:
no history summary file/directory is created by memory logic.

5. Deterministic Stale-Memory Detection

Create:

TESTING.md:
npm test

Current repository:
pnpm + pnpm test

Expected:

- current repository facts win
- STALE/conflict warning is emitted without requiring the model to identify it
- memoryConflicts increments
- runtime planning does not blindly use stale npm command

Also verify a matching pnpm memory entry does not produce a false warning.

6. Canonical Memory Metrics

Verify QEResult exposes truthful structured memory metrics:

memoryFilesRead
memoryEntriesUsed
memoryUpdatesProposed
memoryUpdatesApplied
memoryUpdatesRejected
memoryConflicts

Exercise:

- memory disabled
- memory loaded
- update applied
- update rejected
- stale conflict

Confirm values reflect actual behavior rather than hard-coded expectations.

7. Runtime .qe/.gitignore

Run against a repository without .qe/.

Cause a legitimate memory update.

Verify:

<repo>/.qe/.gitignore

is created and ignores only ephemeral areas such as:

runs/
cache/
artifacts/
traces/

Verify durable memory remains trackable:

PROJECT.md
TESTING.md
RISKS.md
knowledge/
history/summaries/

Then create a developer-authored .qe/.gitignore and repeat.

Expected:
existing file not overwritten.

8. Memory vs Evidence Regression Check

Create memory saying:

"Feature X works correctly."

Provide no execution evidence.

Expected:
Requirement X cannot become VERIFIED solely from memory.

9. Human Content Preservation

Create human-authored content in TESTING.md and RISKS.md.

Apply QE-managed updates.

Expected:
unrelated human content remains intact.

10. Repository Confinement

Re-run:

- path traversal
- absolute escape
- symlink escape

Expected:
DENIED

No memory write may escape evaluated repository .qe/.

11. Two-Run Persistence

Run 1:
learn and persist durable TESTING.md knowledge

Run 2:
fresh QEOrchestrator
fresh FakeModelGateway
no shared in-memory/session state

Expected:
Run 2 loads persisted memory and receives it in relevant reasoning context.

12. Repository Isolation

Repo A memory:
Jest

Repo B memory:
pytest

Run both sequentially.

Expected:
no leakage.

13. Memory Update Failure

Force a write/application failure if deterministic fixture support exists.

Verify:

- current QE evidence/verdict remain valid
- update reports failure
- existing memory file remains intact
- result does not claim success

14. Scope Regression

Verify corrections did NOT introduce:

- GitHub Actions integration
- GitHub check/issue publishing
- SaaS memory service
- vector database
- embedding search
- cross-project memory
- multi-agent orchestration

Required Validation

Run:

npm test -- tests/milestone-6-memory.test.ts

Run it twice.

Then:

npm run build
npm test
npm run lint
npm run format:check
npm run typecheck

Verify after testing:

- no unexpected temp repos remain
- no secret-bearing temp files remain
- no cross-repository leakage occurred

Required Output

Verdict

Return exactly:

ACCEPT
CHANGES REQUIRED
REJECT

Executive Assessment

Briefly state whether the previously identified Milestone 6 blockers are resolved.

Previous Findings Re-Review

For each mark:

RESOLVED
PARTIALLY RESOLVED
NOT RESOLVED
REGRESSION

Cover:

1. explicit known-secret persistence
2. evidence-backed durable updates
3. CLI memory.enabled wiring
4. stale-memory deterministic conflict detection
5. canonical memory metrics
6. runtime .qe/.gitignore

Secret Safety Results

Report actual reproduction results for:

TOPSECRET-M6
sk-test-secret
multiple occurrences

State whether any raw secret appeared anywhere.

Evidence Enforcement Results

Report:

unsupported confirm[118;1:3ued fact
fake evidence ID
valid evidence ID
deterministic repository fact

CLI Config Results

Report:

qe verify with memory disabled
qe review with memory disabled
history summaries disabled

Stale Memory Results

Report npm-vs-pnpm conflict behavior and warning/metric results.

Metrics Results

Report actual QEResult.memoryMetrics values for representative scenarios.

.gitignore Results

Report runtime-created path and whether an existing developer file was preserved.

Regression Assessment

Report whether corrections weakened:

- memory vs evidence
- human content preservation
- path confinement
- symlink protection
- two-run persistence
- repository isolation

Validation Results

Report exact results for:

npm test -- tests/milestone-6-memory.test.ts # run 1
npm test -- tests/milestone-6-memory.test.ts # run 2
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck

Remaining Findings

Only list material issues that should block Milestone 7.

For each:

Severity:
Location:
Description:
Why it matters:
Recommended correction:

Final Recommendation

Answer explicitly:

Is Milestone 6 sufficiently safe and trustworthy to close and begin Milestone 7?

If yes:

ACCEPT — Milestone 6 may be closed and Milestone 7 may begin.

If a material memory safety, evidence, config, stale-data, isolation, or persistence defect remains:

CHANGES REQUIRED — Milestone 6 remains open.

Do not modify the repository.
Do not begin Milestone 7.
Stop after producing the review.
