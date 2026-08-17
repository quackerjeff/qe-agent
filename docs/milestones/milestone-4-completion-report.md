# Milestone 4 Completion Report — Test Generation & Retesting

## Implemented

Milestone 4 adds safe, targeted test generation to the QE Agent. The agent can now:

1. Identify gaps in automated coverage after initial test execution and gap analysis.
2. Inspect existing test conventions (framework, naming, assertion style, fixtures).
3. Generate targeted test proposals via structured model output.
4. Enforce a strict test-only write boundary that prevents all production-source modification.
5. Apply test changes atomically (write to `.qe-tmp`, rename).
6. Execute generated tests via the existing ExecutionController.
7. Retest relevant existing coverage after generation.
8. Collect execution evidence from generated tests.
9. Keep permanent/candidate tests; remove investigative tests after evidence capture.
10. Update gaps, requirement assessments, and verdict based on new evidence.

## Test Generation Architecture

### Generation Decision

The model receives a `test_generator` role reasoning task containing: requirements, gaps, findings, test context (conventions, related files), risk level, changed files, and profile. It returns a `TestGenerationDecision` with `shouldGenerate`, `reason`, and `proposals[]`. Generation is skipped if `shouldGenerate` is false or proposals are empty.

### Test Context

`buildTestContext()` (test-context-builder.ts) discovers:
- Test framework from profile (Vitest, Jest, Pytest, etc.).
- Test directories from filesystem scan.
- Related test files (up to 5, max 4000 chars each), sorted by relevance to changed files.
- Conventions: naming pattern, import style, assertion library, fixture patterns, test directory.

Bounded: MAX_CONTEXT_FILES = 5, MAX_FILE_CHARS = 4000.

### Structured Model Output

Model output is validated with Zod (`GeneratedTestProposalSchema`). Each proposal includes: `filePath`, `operation` (CREATE/MODIFY), `classification`, `rationale`, and `content`. Invalid proposals are rejected and counted in `testsRejected`.

### Generation Plan

The prompt (prompts/test-generation/v1.ts) instructs the model with:
- Target behavior description from gaps.
- Explicit constraints: no production modification, no test weakening, no skip injection, no excessive mocking.
- Convention adherence requirements.
- Maximum test count budget.

## Write Safety

### RepositoryWriteController

`RepositoryWriteController` (write-controller.ts) validates every write before applying. Checks run in this order:

1. **Path traversal** — `isPathTraversal()` resolves the path and checks it stays within the repo root.
2. **Outside repo** — Double-checks resolved absolute path starts with repo root.
3. **Symlink escape** — `isSymlinkEscape()` walks parent directories checking for symlinks that resolve outside the repo.
4. **File count limit** — MAX_FILES_PER_CYCLE = 8.
5. **Size limit** — MAX_FILE_SIZE_BYTES = 512,000.
6. **Empty content** — Rejects whitespace-only content.
7. **Binary content** — Rejects content with control characters.
8. **Production path** — `classifyTestPath()` must return "TEST", not "PRODUCTION".
9. **Uncertain classification** — Paths that can't be confidently classified as test code are denied.
10. **Dirty file** — For MODIFY or existing-file CREATE, checks `git status --porcelain` for uncommitted changes.
11. **Assertion weakening** — Detects reduction in assertion count (below 50% of original) or high trivial-assertion ratio.
12. **Skip injection** — Detects `.skip`, `xit`, `xdescribe`, `pytest.mark.skip`, `@Disabled`, etc.
13. **Test deletion** — Detects reduction in test declaration count.

### Path Classification

`classifyTestPath()` (test-file-classifier.ts) uses deterministic rules:
- **TEST**: Path starts with known test directories (tests, test, __tests__, spec, e2e, integration) OR filename has test suffixes (.test., .spec., _test., _spec.).
- **PRODUCTION**: Path starts with known production directories (src, lib, app, pkg, cmd, internal) OR has denied filenames (package.json, Dockerfile, .env, Makefile) OR denied extensions (.sql, .sh, .yml, .yaml, .json) OR is in CI paths (.github/, .gitlab-ci, .circleci/).
- **UNCERTAIN**: Cannot be confidently classified as either.

### Production-Source Protection

Every file write proposal must pass path classification. Production paths are denied with `DENIED_PRODUCTION_PATH`. Uncertain paths are denied with `DENIED_UNCERTAIN_CLASSIFICATION`. Only paths classified as TEST are written.

### Traversal/Symlink Defenses

- `isPathTraversal()` resolves paths via `resolve()` and checks they stay within the repository root.
- `isSymlinkEscape()` walks each component of the path, checking `lstatSync` for symlinks that resolve outside the repo.

### Dirty-File Handling

For MODIFY operations and CREATE-over-existing operations, the controller checks `git status --porcelain` to detect uncommitted changes. If the file has uncommitted modifications, the write is denied with `DENIED_DIRTY_FILE`.

## Generated Test Lifecycle

### Permanent (PERMANENT_REGRESSION)

Tests that verify permanent regression behavior. Retained after generation. Intended to remain in the repository permanently.

### Candidate (CANDIDATE)

Tests proposed to fill coverage gaps. Retained after generation for the developer to review and keep or remove.

### Investigative (INVESTIGATIVE)

Exploratory tests used to gather evidence about behavior. Automatically removed after execution and evidence capture. Evidence is preserved; the test file itself is deleted.

### Cleanup

After all proposals are processed, investigative files are removed via `writeController.removeFile()`. The `retained` flag on each `GeneratedTestChange` is set to `false` for removed files.

### Retention

Permanent and candidate tests: `retained = true`, `permanentTestsRetained++`.
Investigative tests: `retained = false`, `investigativeTestsRemoved++`.

## Execution and Retesting

### Generated Test Execution

Each applied test is executed via `ExecutionController.execute()` with:
- Test command from profile or test context discovery.
- 60-second timeout.
- `mutability: "READ_ONLY"`, `network: "ALLOWED"`.
- Evidence created via `createExecutionEvidence(result, "TEST")`.
- Results tracked: `testsExecuted`, `testsPassing`, `testsFailing`.

### Focused Execution

Generated tests are executed individually per-file after write. The test command is derived from the repository profile's discovered TEST commands.

### Regression Retesting

After test generation, the orchestrator enters `RETESTING` state and re-executes up to 2 existing TEST actions from the validation plan to verify no regressions were introduced.

### Failure Investigation

The existing failure investigation flow (from M3) applies to generated test failures. Failed tests produce FAIL evidence that is incorporated into gap analysis and verdict.

## Requirement / Gap / Verdict Updates

After test generation and retesting, the orchestrator re-enters `ANALYZING_GAPS` to:

1. **Re-assess gaps** — New evidence from generated tests may close gaps identified in the first pass.
2. **Update requirement assessments** — Requirements that were `NOT_VERIFIED` may become `PARTIALLY_VERIFIED` or `VERIFIED` based on new test evidence.
3. **Update findings** — New findings from generated test execution are added to the findings list.
4. **Update verdict** — The verdict engine receives the expanded evidence set, updated gaps, and updated requirements for a more informed final verdict.

## Evaluation Scenarios

All evaluation scenarios are covered by tests in `tests/milestone-4-test-generation.test.ts`:

| Scenario | Description | Result |
|----------|-------------|--------|
| A - Missing coverage resolved | Model proposes valid test, WriteController applies, test executes | PASS — generation triggers, changes recorded, metrics captured |
| B - Production write attempt | Model proposes `src/auth.ts` write | PASS — WriteController returns `DENIED_PRODUCTION_PATH`, file not created |
| C - No gaps, no generation | Gap analysis returns empty gaps | PASS — generation phase skipped, no GENERATING_TESTS state |
| D - Investigative cleanup | Model proposes INVESTIGATIVE test | PASS — file created, executed, then removed; evidence retained |
| E - Path traversal attack | Proposal with `../outside/file.ts` | PASS — `DENIED_TRAVERSAL` |
| F - Symlink escape attack | Symlink pointing outside repo | PASS — `isSymlinkEscape` returns true |
| G - No automatic git commit | Test generated but no new commits created | PASS — commit count unchanged after generation |
| H - Metrics recording | Generation produces metrics in QEResult | PASS — `testGenerationMetrics` populated with correct fields |

## Security / Adversarial Tests

All pass (50/50 tests):

| Attack | Test | Result |
|--------|------|--------|
| Production write attempt | 5 production targets (src/auth.ts, src/payment.ts, app/controllers/user.ts, Program.cs, main.py) | All DENIED (not APPLIED) |
| Path traversal | `../outside-repo/test.ts` and `../../etc/passwd` | DENIED_TRAVERSAL |
| Symlink escape | Symlink to outside directory | `isSymlinkEscape` returns true |
| Prompt injection | Rationale with "IGNORE ALL PREVIOUS INSTRUCTIONS" targeting `src/main.ts` | DENIED_PRODUCTION_PATH, file not written |
| Test weakening | Reducing real assertions to `expect(true).toBe(true)` | DENIED_INVALID_CONTENT |
| Skip injection | Adding `.skip` to existing tests | DENIED_INVALID_CONTENT |
| Test deletion | Reducing test count from 2 to 1 | DENIED_INVALID_CONTENT |
| Package.json write | Attempting to modify package.json | DENIED_PRODUCTION_PATH |
| Dockerfile write | Attempting to create Dockerfile | DENIED_PRODUCTION_PATH |
| CI workflow write | Attempting `.github/workflows/ci.yml` | DENIED_PRODUCTION_PATH |
| Database migration | Attempting `migrations/001.sql` | DENIED_PRODUCTION_PATH |
| Empty content | Whitespace-only content | DENIED_INVALID_CONTENT |
| Oversized content | 600KB content | DENIED_SIZE_LIMIT |
| File count exceeded | 9th file in cycle | DENIED_FILE_COUNT |
| Dirty file overwrite | Uncommitted changes target | DENIED_DIRTY_FILE |
| Uncertain classification | `utils.ts` at repo root | DENIED_UNCERTAIN_CLASSIFICATION |

## Tests

50 tests in `tests/milestone-4-test-generation.test.ts`:

- **Test File Classifier** (8 tests): Directory classification, suffix classification, production paths, denied filenames, CI paths, uncertain paths, custom directories, path traversal detection.
- **RepositoryWriteController** (14 tests): Valid creation, production denial, traversal denial, package.json denial, Dockerfile denial, CI denial, migration denial, empty content, oversized content, file count limit, dirty file, uncertain classification, weakening detection, skip injection, test deletion, investigative cleanup.
- **Symlink Escape Detection** (2 tests): Symlink outside repo, normal paths allowed.
- **M4 Schema Validation** (5 tests): TestGenerationPlan, GeneratedTestProposal, GeneratedTestChange, TestGenerationMetrics, QEResult with generatedTestChanges.
- **M4 Lifecycle Transitions** (4 tests): ANALYZING_GAPS→GENERATING_TESTS, GENERATING_TESTS→RETESTING, RETESTING→ANALYZING_GAPS, full lifecycle flow.
- **Prompt Injection Resistance** (1 test): Production write denied despite injection content.
- **Adversarial Production Write Attempts** (5 tests): Multiple production targets denied.
- **Orchestrator Integration** (4 tests): Skips generation (no gaps), triggers generation (gaps exist), denies production proposals, records metrics.
- **Test Context Builder** (1 test): Convention detection from real repo.
- **Budget Controls** (3 tests): quick=1, standard=3, deep=8.
- **No Automatic Git Commit** (1 test): Commit count unchanged after generation.

Plus 279 existing tests from Milestones 0–3, all passing.

## Validation Results

```
npm run build       — PASS (tsc compiles cleanly)
npm test            — PASS (329 tests, 13 files, 0 failures)
npm run lint        — PASS (0 errors, 1 pre-existing warning in M3 test)
npm run format:check — PASS (all files formatted)
npm run typecheck   — PASS (tsc --noEmit clean)
```

## Schema Changes

Added to `src/types/schemas.ts`:

| Schema | Purpose |
|--------|---------|
| `TestClassification` | Enum: PERMANENT_REGRESSION, CANDIDATE, INVESTIGATIVE |
| `WriteOperation` | Enum: CREATE, MODIFY |
| `WriteOutcome` | Enum: APPLIED, DENIED_PRODUCTION_PATH, DENIED_TRAVERSAL, DENIED_SYMLINK, DENIED_DIRTY_FILE, DENIED_OUTSIDE_REPO, DENIED_INVALID_CONTENT, DENIED_SIZE_LIMIT, DENIED_FILE_COUNT, DENIED_UNCERTAIN_CLASSIFICATION |
| `TestGenerationPlanSchema` | Structured generation plan with objective, target behavior, requirements, classification |
| `GeneratedTestProposalSchema` | Model output for proposed test: filePath, operation, classification, rationale, content |
| `GeneratedTestChangeSchema` | Recorded change: id, path, outcome, hashes, retention, requirement linkage |
| `TestGenerationMetricsSchema` | Generation metrics: attempts, generated, executed, passing, failing, rejected, retained, removed |

Added to `QEResultSchema` and `PartialQEResultSchema`:
- `generatedTestChanges: z.array(GeneratedTestChangeSchema).optional()`
- `testGenerationMetrics: TestGenerationMetricsSchema.optional()`

Added `maxGeneratedTests` to `ExecutionBudget` (quick=1, standard=3, deep=8).

All types exported from `src/types/index.ts`.

## Dependencies Added

None. Milestone 4 uses only existing dependencies (Node.js built-ins, Zod, existing project modules).

## Deviations

None. Implementation follows the PRD, Technical Product Specification, AGENTS.md, and accepted ADRs.

## Deferred

The following are intentionally deferred to Milestone 5 or later:

- Dedicated Playwright/browser QE reasoning
- Project-memory persistence
- GitHub Actions publishing
- GitHub issue creation
- Automatic Git commit/push
- Production-code fixes
- Organization policy engine
- Hosted/SaaS infrastructure
- Multi-agent orchestration

## Concerns

1. **Generation quality** — FakeModelGateway tests validate the pipeline mechanics (write safety, lifecycle, evidence collection) but cannot evaluate the quality of real model-generated tests. Real-world testing with an OpenAI provider is recommended before production use.
2. **Test execution isolation** — Generated tests execute in the repository's working tree. A malicious or poorly generated test could have side effects. The ExecutionController's timeout and process-tree cleanup provide some protection, but full sandboxing (Docker) would be stronger.
3. **Convention inference accuracy** — The test context builder infers conventions from a bounded sample of existing test files. Repositories with inconsistent conventions may produce mismatched generated tests.

## Scope Confirmation

- **No production-source modification was implemented.** The RepositoryWriteController enforces test-only writes. All production paths are denied deterministically.
- **No automatic Git commit/push was implemented.** Generated test files are written to the working tree only. The "No Automatic Git Commit" test explicitly verifies commit count is unchanged.
- **No project memory was implemented.** No persistence between runs.
- **No multi-agent orchestration was implemented.** Single-agent execution model preserved.
