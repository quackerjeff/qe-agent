Independent Review Assignment — Milestone 7: GitHub Actions & GitHub Reporting

Milestone: 7
Review Type: Independent implementation review
Target: GitHub Actions compatibility, GitHub publishing, issue policy, CI safety
Implementation Specification: docs/milestones/milestone-7-github-integration.md

Objective

Perform an independent review of the completed Milestone 7 implementation.

Do NOT modify the repository.

Do not assume the implementation completion report is correct.

Inspect actual code, tests, CLI wiring, config, GitHub adapter behavior,
HTTP requests, result persistence, issue policy, workflow-summary handling,
token handling, fork-PR guidance, and Git baseline behavior.

Primary question:

Is Milestone 7 sufficiently safe, correct, bounded, and decoupled from core QE
to close the MVP GitHub integration milestone?

Required verdict

Return exactly one:

ACCEPT
CHANGES REQUIRED
REJECT

Use CHANGES REQUIRED for any material defect involving:

- token exposure
- unsafe fork-PR behavior
- incorrect QE-to-GitHub verdict mapping
- duplicate issue creation
- unsupported issue creation
- result tampering
- unbounded retries
- artifact escape
- GitHub API coupling into core QE
- incorrect baseline behavior

1. Architecture

Verify GitHub-specific behavior is confined to the integration layer.

Core QE reasoning must not depend on GitHub API types or client code.

Search for GitHub imports under:

src/core/
src/models/
src/repository/

Expected:
none except generic context already allowed by architecture.

2. Production GitHub Client

Verify HttpGitHubClient is genuinely used by the real publish path.

Confirm it supports:

- check creation
- issue search
- issue creation

Verify FakeGitHubClient remains test-only/offline support.

3. HTTP Request Correctness

Inspect actual HTTP request construction.

Verify:

- correct GitHub API host
- correct method
- correct path
- expected headers
- Authorization header only
- token absent from body
- request body JSON shape
- bounded response buffering
- timeout behavior

Do not rely solely on mocks.

4. Token Safety — CRITICAL

Use a known token:

TOPSECRET-M7-TOKEN

Verify it does not appear in:

- logs
- error messages
- QEResult
- GitHubPublishingResult
- workflow summary
- issue body
- check summary
- result.json
- memory
- test artifacts

Also force an HTTP/API error whose payload echoes the token.

Expected:
redacted.

5. Missing Token

Run real publish path without GITHUB_TOKEN.

Verify behavior matches design.

If dry-run:
must work with no token.

If non-dry-run:
must fail clearly without silently substituting a fake remote publisher.

This point is important.

Do NOT accept production mode silently using FakeGitHubClient when the user
believes they are publishing remotely.

6. Dry Run — CRITICAL

Run:

qe github publish --dry-run ...

or equivalent config.

Verify:

- zero remote HTTP calls
- no check created
- no issue created
- wouldPublish/wouldCreate output is accurate
- result remains unchanged

7. GITHUB_STEP_SUMMARY

Verify rendered summary is actually written to GITHUB_STEP_SUMMARY.

Test:

- valid absolute path
- missing env var
- nonexistent parent
- null byte
- relative path

Expected:
safe/clear behavior.

8. Step Summary Path Authority

Verify model/repository content cannot influence the output path.

Only trusted environment adapter should determine it.

9. Step Summary Secret Safety

Put TOPSECRET-M7 in finding text/error text.

Verify raw value is absent from summary file.

10. QEResult Persistence

Verify canonical result JSON is written under evaluated repository .qe/.

Run from cwd outside evaluated repo.

Expected:
artifact still goes under evaluated repo.

11. Output Path Escape

Attempt:

--output ../outside/result.json
absolute path outside repo
symlink escape

Expected:
DENIED

If explicit custom output outside repo is intentionally supported, verify that
this does not violate the milestone's repository-local artifact requirement.

12. Result Schema Validation — CRITICAL

Give publisher:

- malformed JSON
- structurally invalid QEResult
- invalid verdict
- missing required evidence
- unexpected provider-specific data if prohibited

Expected:
publication denied.

No remote calls should occur before schema validation succeeds.

13. Tampered Result

Modify a saved result between QE execution and publication.

Verify the publisher validates the result and does not execute any command
embedded in result content.

14. Verdict Mapping

Verify exactly:

PASS → success
PASS_WITH_CONCERNS → success
NEEDS_REVIEW → neutral
FAIL → failure
BLOCKED → action_required

If GitHub API uses a different supported conclusion value, verify the actual
mapping is valid and deterministic.

15. CI Exit Policy

Verify ci.failOn behavior through production CLI paths.

Test:

PASS
PASS_WITH_CONCERNS
NEEDS_REVIEW
FAIL
BLOCKED

with different configured failOn sets.

16. QE Verdict Independence — CRITICAL

Force GitHub check publication to fail.

Expected:
QEResult verdict unchanged.

Force issue creation to fail.

Expected:
QEResult verdict unchanged.

Integration failure must remain separate from QE semantics.

17. Check Publishing

Using a local fake HTTP server or deterministic request capture, verify the
real HttpGitHubClient emits the expected check payload.

18. Check Summary Safety

Treat finding/model text as untrusted Markdown.

Verify check text is rendered safely as presentation only.

No embedded text should influence execution or publication policy.

19. Issue Eligibility — CRITICAL

Independently test eligibility for:

- INTRODUCED HIGH-confidence product defect
- PRE_EXISTING defect
- UNKNOWN baseline classification
- TEST_DEFECT
- ENVIRONMENT_ISSUE
- FLAKY_TEST
- low severity
- low confidence
- invalid evidence references

Expected:
only policy-eligible findings proceed.

20. Evidence Validation for Issues

A finding must not be issue-eligible solely because the model says it is.

Verify referenced evidence IDs exist in QEResult.

21. Baseline Classification for Issues

Verify issue eligibility reads canonical baselineComparisons.

Do not accept prose parsing.

22. Duplicate Fingerprint

Inspect fingerprint inputs.

Verify semantically same defect produces stable fingerprint across repeated runs.

23. Duplicate Prevention — CRITICAL

Existing open issue with fingerprint marker.

Expected:
no second issue created.

24. Fingerprint Collision Safety

Create two materially different findings with similar titles.

Verify they are not trivially collapsed if affected component/category differs.

25. Closed Issue Behavior

Verify intended behavior if matching fingerprint exists only on a closed issue.

Document whether a new issue is allowed.

26. GitHub Search Failure

If duplicate search fails:

do not silently create a duplicate issue unless policy explicitly permits it.

Prefer safe non-creation + warning.

27. API Rate Limit

Simulate GitHub 403/429 rate limit.

Verify:

- bounded retries only
- no infinite loop
- QE result unchanged
- warning surfaced

28. Network Failure

Simulate connection reset/timeout.

Expected:
bounded failure
QE result unchanged.

29. HTTP Timeout

Verify node:https requests have an actual timeout.

Do not allow hung publication indefinitely.

30. Large API Response

Verify response buffering is bounded.

Do not allow unbounded API error body accumulation.

31. GitHub Environment Parsing

Validate:

repository owner/name
event
run ID
ref
SHA
base SHA
head SHA
PR number

Malformed values should fail clearly.

32. GITHUB_REPOSITORY

Test malformed:

owneronly
/ repo
owner/
owner/repo/extra

Expected:
rejected.

33. PR Baseline

Verify supplied PR base SHA is passed to QE review correctly.

Do not fall back silently to HEAD~1.

34. Shallow Clone — CRITICAL

Construct or simulate a shallow Git checkout where base SHA is unavailable.

Expected:
BLOCKED or explicit fetch strategy.

Must NOT silently compare against:
HEAD
HEAD~1
wrong merge base

35. Fetch Behavior

If implementation fetches baseline history automatically, inspect command safety.

Any git fetch should remain bounded and deterministic.

36. Fork PR Security — CRITICAL

Review documented GitHub Actions example.

Verify it does NOT recommend an unsafe pattern such as:

pull_request_target
+
checkout untrusted PR head
+
privileged GITHUB_TOKEN
+
execute tests

Default documented workflow should favor safe pull_request semantics.

37. Fork Token Availability

Simulate no write token.

QE execution should still be possible where appropriate.

Publishing may be dry-run/skipped.

38. Permission Minimization

Verify documented workflow requests only necessary permissions.

Issue permission should not be required if issue publishing is disabled.

39. Workflow Summary in Fork Context

Verify read-only/unprivileged runs can still produce local summary/result without requiring remote writes.

40. Repository Content Cannot Enable Publishing

A malicious .qe/config.yml or repository instruction should not be able to obtain a token or bypass host-level policy.

Review the trust model carefully.

41. Issue Publishing Default

Fresh config/default init:

github.issues.enabled must be false.

42. Check Publishing Default

Verify intended default and document it.

43. Config Migration

Old M0 placeholder fields:

blockOnFail
createIssues

Ensure old config either:
- migrates cleanly
- fails with actionable message
- remains backward compatible

Do not silently misinterpret old config.

44. GitHub API Host Pinning

Verify production client cannot be redirected to arbitrary host by repository-controlled input unless GHES support is explicitly designed.

If API host is configurable, validate it carefully.

45. Redirect Handling

Verify GitHub HTTP client does not blindly follow arbitrary redirects with Authorization header attached.

46. TLS

Use HTTPS only for GitHub production API.

47. Secret Error Redaction

Force error body containing:

TOPSECRET-M7

Verify publishing warning is redacted.

48. Issue Body Safety

Issue body should contain:

finding
severity
confidence
evidence summary
baseline classification
execution ID

Verify no secret/raw logs are dumped.

49. Workflow Summary Completeness

Verify summary includes useful QE result information without full raw model responses.

50. No Automatic Git Write

Search for:

git add
git commit
git push

Expected:
none in GitHub integration.

51. Generated Tests

Verify GitHub integration does not auto-commit generated tests.

52. Browser Regression

Verify M5 URL policy and secret redaction tests still pass.

53. Memory Regression

Verify M6 memory safety tests still pass.

54. Execution Regression

Verify ExecutionController and RepositoryWriteController guarantees remain intact.

55. Process Hygiene

Run targeted M7 suite twice if it spawns any child process/network fixture servers.

Verify no orphaned processes remain.

56. Offline Default Suite

npm test must not require:

real GitHub token
real GitHub network access
OpenAI key

57. Dependencies

No unnecessary GitHub framework or SaaS dependency.

58. Scope

Verify no:

GitHub App
webhook service
hosted control plane
dashboard
cross-project memory
multi-agent orchestration

Required Demonstrations

A. PASS result → success check
B. INTRODUCED regression → failure check + eligible issue
C. PRE_EXISTING failure → no automatic issue
D. NEEDS_REVIEW → neutral
E. BLOCKED → action_required
F. Duplicate issue suppressed
G. API failure leaves QE result unchanged
H. Rate limit bounded
I. Secret error redacted
J. Fork/untrusted context safe
K. Invalid result denied
L. Repo root != cwd still writes local artifacts correctly
M. Shallow clone missing base produces truthful BLOCKED result
N. Real HttpGitHubClient request shape verified
O. Step summary written through GITHUB_STEP_SUMMARY

Required Validation

Run independently:

npm test -- tests/milestone-7-github.test.ts

Run targeted suite twice if any network fixture servers are spawned.

Then:

npm run build
npm test
npm run lint
npm run format:check
npm run typecheck

Required Output

Verdict

Return exactly:

ACCEPT
CHANGES REQUIRED
REJECT

Executive Assessment

State whether Milestone 7 is sufficiently complete and safe.

Acceptance Criteria

Evaluate all Milestone 7 acceptance criteria:

PASS
PARTIAL
FAIL

Explain every PARTIAL/FAIL.

GitHub API Assessment

Report:

- real client wiring
- request correctness
- timeout
- retry behavior
- response bounds
- API host/TLS
- token handling

Fork PR Security Assessment

State explicitly whether the documented workflow is safe for untrusted fork PRs.

Issue Policy Assessment

Report:

- eligibility
- baseline classification
- evidence validation
- duplicate prevention
- closed issue behavior
- search failure behavior

Result/Publishing Separation Assessment

Confirm publishing failures cannot mutate QE result semantics.

Artifact/Summary Assessment

Report:

- result path
- cwd isolation
- step summary path
- path safety
- secret safety

Baseline/Shallow Clone Assessment

Report whether unavailable base SHA can ever cause an incorrect comparison.

Regression Assessment

Report whether M2–M6 safety guarantees remain intact.

Validation Results

Report exact commands/results.

Findings

For every material issue:

Severity:
Location:
Description:
Why it matters:
Recommended correction:

Recommended Actions

Must Fix
Should Fix
Defer

Final Recommendation

Answer explicitly:

Is Milestone 7 sufficiently safe and complete to close?

If yes:

ACCEPT — Milestone 7 may be closed.

If material GitHub security, publishing, issue-policy, baseline, token, or artifact defects remain:

CHANGES REQUIRED — Milestone 7 remains open.

Do not modify the repository.
Stop after producing the review.
