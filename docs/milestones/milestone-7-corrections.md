# Milestone 7 Correction Assignment — GitHub Actions & GitHub Reporting

Milestone: 7
Status: Corrections Required
Purpose: Resolve independent Milestone 7 review findings
Next milestone: Do not proceed beyond Milestone 7

## Required Reading

Before modifying code, read:

- AGENTS.md
- docs/milestones/milestone-7-github-integration.md
- docs/milestones/milestone-7-review.md
- relevant PRD/System Design sections
- all accepted ADRs
- the Milestone 7 completion report
- the independent Milestone 7 review findings

Inspect actual production paths before making changes.

Preserve the GitHub adapter architecture.

Do not redesign the QE engine.

# Objective

Correct Milestone 7 so that:

1. production publishing cannot silently use a fake GitHub client;
2. issue publication requires valid canonical evidence;
3. GITHUB_STEP_SUMMARY path handling is safe;
4. GitHub HTTP calls are bounded by timeout and response-size limits;
5. result output remains confined to the evaluated repository;
6. missing PR baseline history is handled truthfully;
7. safe GitHub Actions guidance exists for fork/untrusted PRs.

# 1. Missing GITHUB_TOKEN Must Fail Clearly

Current behavior:

non-dry-run
+ missing GITHUB_TOKEN
→ FakeGitHubClient
→ apparent publication success

This is unacceptable.

FakeGitHubClient must be used only for:

- explicit tests;
- explicit dry-run mode;
- dependency injection in deterministic offline scenarios.

For production CLI behavior:

dryRun = false
AND
remote check or issue publication is enabled
AND
GITHUB_TOKEN is missing

Expected:

publication fails clearly before any fake success is reported.

Do not return:

checkPublished: true
fake GitHub URL
issueCreated: true

in this situation.

Use an appropriate publishing error/result and non-zero CLI exit where remote publication was explicitly requested.

Required tests:

A. dryRun=true, no token
→ works
→ zero HTTP calls
→ clearly reports dry run

B. dryRun=false, checks enabled, no token
→ clear failure
→ no FakeGitHubClient publication

C. dryRun=false, issues enabled, no token
→ clear failure

D. no remote publishing configured
→ token not required merely to parse/render local output

# 2. Validate Issue Evidence References

Issue eligibility must operate against canonical QEResult evidence.

A finding is NOT issue-eligible unless its supporting evidence references exist.

Before issue publication:

for each finding.evidenceId:
    evidence exists in QEResult.evidence?

If no:

    issue eligibility = false
    reason = invalid/missing evidence

Do not accept a model-supplied string merely because it resembles an evidence ID.

Baseline comparison references must also resolve correctly.

Example attack:

finding.evidenceIds:
  - missing-ev

baselineComparison.targetEvidenceId:
  missing-ev

Expected:
NO ISSUE

Even if:
severity HIGH
confidence high
classification INTRODUCED

Required tests:

- missing finding evidence ID
- valid finding evidence ID
- dangling baseline evidence
- valid target/baseline evidence
- mixed valid/invalid evidence references

Issue creation must occur only when all required references are valid.

# 3. Fix GITHUB_STEP_SUMMARY Relative Path Handling

Current behavior resolves the path before checking whether it was absolute.

Fix validation ordering.

Required:

if !isAbsolute(rawSummaryPath):
    reject

Only after that should normalization/resolution occur.

Reject:

relative.md
./summary.md
../summary.md

Accept:

valid absolute path whose parent exists

Also preserve:

- null-byte rejection;
- nonexistent parent rejection;
- secret redaction;
- model/repository content cannot choose the path.

Required regression tests must assert that relative paths are denied before write.

# 4. Add HTTP Request Timeout

HttpGitHubClient must not hang indefinitely.

Implement an explicit bounded timeout.

Requirements:

- configurable internal/default timeout;
- request destroyed/aborted on timeout;
- timeout reported as GitHub publishing failure;
- QE result remains unchanged;
- no indefinite retry loop.

A reasonable MVP timeout may be chosen and documented.

Tests should use a controlled local HTTP server that accepts the connection but never completes the response.

Expected:
bounded timeout
request terminated
publishing warning/error returned

# 5. Bound GitHub HTTP Response Bodies

Do not buffer unlimited GitHub API response bodies.

Introduce a conservative maximum response size.

When exceeded:

- stop buffering;
- destroy/abort response/request as appropriate;
- return a bounded GitHubApiError;
- do not retain the oversized body;
- QE result remains unchanged.

This applies especially to:

- error responses;
- issue-search results;
- unexpected API output.

Tests:

small normal response
→ succeeds

oversized response
→ bounded failure

large error body containing secret
→ bounded + redacted

# 6. Constrain --output Under Evaluated Repository

The explicit `--output` option must not bypass repository-local artifact policy.

Resolve output relative to the evaluated repository root.

Accept examples such as:

.qe/runs/result.json
reports/qe-result.json

only if repository policy intentionally permits them.

Prefer `.qe/` for QE artifacts.

Reject:

../result.json
../../outside.json
absolute path outside repository
symlink escaping repository

Use realpath/containment protections equivalent to existing artifact safety.

Do not use process cwd as the security root.

Required tests:

repo A evaluated while cwd=repo B
→ output belongs to repo A

relative traversal
→ denied

absolute escape
→ denied

symlink escape
→ denied

valid repo-local output
→ succeeds

# 7. Real Missing-Baseline Handling

Milestone 7 must explicitly handle GitHub/shallow-clone baseline unavailability.

Do not depend on incidental low-level Git command failure without normalizing the result.

For:

qe review --base <sha>

if the baseline revision does not exist locally:

Expected one of:

A. safely fetch the required revision; OR
B. produce truthful BLOCKED behavior explaining baseline history is unavailable.

For MVP, option B is acceptable and simpler.

Must NOT silently fall back to:

HEAD
HEAD~1
another merge base
current working tree

Add a deterministic shallow-clone/missing-SHA regression test.

Expected:

baseline unavailable
→ BLOCKED / explicit baseline-unavailable condition
→ no false INTRODUCED/PRE_EXISTING comparison

If a fetch strategy is implemented instead, it must use safe structured Git execution and bounded network behavior.

# 8. GitHub Actions Fork Safety Documentation

Add or correct the documented workflow example.

The default example must avoid unsafe use of:

pull_request_target
+
checkout of untrusted PR head
+
privileged write-capable token
+
execution of PR-controlled code

Prefer a safe pull_request-based workflow for QE execution.

Document that fork PRs may not have write-capable credentials.

Recommen[118;1:3uded model:

untrusted PR:
    QE execution
    local result/summary
    publication skipped/dry-run if token unavailable

trusted context:
    optional publication

Document minimum permissions.

If issues are disabled:
do not require issues: write

# 9. Preserve QE / Publishing Separation

Do not allow any correction to mutate QEResult verdict because GitHub publishing failed.

Examples:

QE verdict FAIL
GitHub timeout
→ QE verdict remains FAIL

QE verdict PASS
missing GitHub token
→ QE verdict remains PASS
→ publishing failure reported separately

# 10. Preserve Dry-Run Semantics

Dry-run must perform zero remote writes.

Verify:

- no HTTP check call;
- no issue search if unnecessary;
- no issue creation;
- no misleading remote URLs.

Dry-run should report what would happen.

# 11. Preserve Token / Secret Safety

Re-run explicit secret tests.

Use:

TOPSECRET-M7
TOPSECRET-M7-TOKEN

Verify absent from:

- HTTP bodies
- logs
- publishing results
- check summary
- issue body
- workflow summary
- result.json
- error messages
- memory

Authorization header may contain token only while making the actual request.

# 12. Preserve Issue Policy

Do not regress:

- introduced vs pre-existing policy;
- severity threshold;
- confidence threshold;
- TEST_DEFECT exclusion;
- ENVIRONMENT_ISSUE exclusion;
- FLAKY_TEST exclusion;
- duplicate fingerprints;
- issue publishing default disabled.

# 13. Preserve Duplicate-Safety Behavior

If duplicate issue lookup fails:

prefer:
no issue creation
+ warning

rather than:
create issue anyway

unless existing documented policy explicitly states otherwise.

Add test if not already present.

# 14. Preserve M0–M6 Safety Guarantees

Do not regress:

- ExecutionController
- RepositoryWriteController
- baseline comparison
- browser URL policy
- browser secret redaction
- memory repository isolation
- memory vs evidence
- process cleanup
- canonical QEResult

# 15. Do Not Implement

Do NOT add:

- GitHub App
- webhook server
- hosted control plane
- dashboard
- automatic git commit/push
- cross-project memory
- multi-agent orchestration
- SaaS infrastructure

# Required Regression Tests

At minimum add tests for:

1. non-dry-run + no token fails clearly
2. dry-run + no token succeeds without remote writes
3. invalid evidence prevents issue creation
4. valid evidence permits otherwise eligible issue
5. relative GITHUB_STEP_SUMMARY path rejected
6. HTTP request times out
7. HTTP response-size limit enforced
8. `--output` traversal denied
9. `--output` absolute escape denied
10. `--output` symlink escape denied
11. valid repo-local output succeeds
12. missing base SHA becomes truthful BLOCKED
13. no fallback to HEAD~1/current revision
14. GitHub publishing failure leaves QE verdict unchanged
15. explicit tokens/secrets remain redacted

# Required Validation

Run:

npm test -- tests/milestone-7-github.test.ts

Run targeted suite twice if local HTTP fixture servers are used.

Then run:

npm run build
npm test
npm run lint
npm run format:check
npm run typecheck

Verify:

- no fixture HTTP servers remain;
- no orphaned child processes;
- no secret-bearing files;
- no unexpected artifacts outside test repositories.

# Completion Report

Provide:

## Missing Token Behavior

Show:

dry-run/no token
production/no token
production/token present

## Evidence Eligibility

Show invalid and valid evidence examples.

## Step Summary Safety

Show relative-path rejection and valid absolute-path behavior.

## HTTP Bounds

Report:
request timeout
max response bytes
timeout demonstration
oversized-response demonstration

## Output Confinement

Show traversal/absolute/symlink results.

## Shallow Clone

Demonstrate missing baseline SHA handling through real production review behavior.

## Fork Workflow Safety

Show documented recommended workflow and permission model.

## Publishing Separation

Show GitHub failure does not alter QE verdict.

## Regression Results

Report M0–M6 safety regression status.

## Validation Results

Report exact command results.

## Scope Confirmation

Confirm no:
- GitHub App
- SaaS/control plane
- auto commit/push
- multi-agent orchestration

Stop after completing Milestone 7 corrections.
