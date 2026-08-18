# Milestone 7 Implementation Assignment — GitHub Actions & GitHub Reporting

## Status

READY FOR IMPLEMENTATION

Milestones 0–6 are accepted.

Milestone 7 introduces GitHub/CI integration around the existing QE Agent.

Milestone 7 must NOT redesign the QE engine.

---

# 1. Objective

Make QE Agent usable as an automated quality gate in GitHub repositories.

A repository should be able to run QE Agent from GitHub Actions against a pull request or commit and receive useful QE results directly in the GitHub workflow.

Milestone 7 should support:

1. execution inside GitHub Actions;
2. pull-request/change-aware QE review;
3. machine-readable QE results;
4. GitHub Check or workflow-visible QE summary;
5. optional GitHub issue creation for actionable defects;
6. safe handling of credentials and untrusted repository content;
7. correct CI exit behavior;
8. preservation of the provider-independent QE core.

The existing QE engine remains authoritative.

GitHub is an adapter/integration layer.

---

# 2. Architectural Principle

GitHub integration MUST NOT become part of core QE reasoning.

Maintain this dependency direction:

GitHub / CI Adapter
        |
        v
QE CLI / QEOrchestrator
        |
        v
Existing QE capabilities

Core QE code must not depend on GitHub APIs.

GitHub-specific behavior belongs in an integration/adapter layer.

Do not introduce GitHub-specific concepts into reasoning prompts unless they are generic change metadata already supported by QE.

---

# 3. Primary Usage Model

Expected GitHub workflow:

Pull Request
    |
    v
GitHub Actions
    |
    v
Checkout repository
    |
    v
Install QE Agent
    |
    v
qe review --base <baseline>
    |
    v
QEResult
    |
    +--> Human-readable workflow summary
    |
    +--> Machine-readable JSON artifact
    |
    +--> GitHub Check / status
    |
    +--> Optional GitHub issue

The same QE Agent must remain usable locally without GitHub.

---

# 4. GitHub Actions Support

Provide a documented GitHub Actions integration.

Prefer initially using the existing CLI rather than building a custom JavaScript GitHub Action unless a custom action is clearly necessary.

Example conceptual workflow:

checkout
setup node
install QE Agent
qe review
publish result

Do not duplicate QE orchestration inside GitHub workflow code.

---

# 5. Pull Request Baseline

For pull-request execution, determine the appropriate baseline revision.

The implementation must distinguish:

target revision
baseline revision

For pull requests, baseline should normally represent the PR base SHA or explicitly supplied base revision.

Do not assume HEAD~1 is always the baseline.

Existing Milestone 3 baseline execution/comparison must remain authoritative.

GitHub integration should supply the correct baseline, not reimplement baseline comparison.

---

# 6. Shallow Clone Handling

GitHub Actions frequently uses shallow Git checkouts.

Detect when the required baseline revision is unavailable.

Do NOT silently compare against the wrong revision.

Behavior should be one of:

1. obtain/fetch the required baseline safely; or
2. return a clear BLOCKED/INSUFFICIENT_ENVIRONMENT result explaining that baseline history is unavailable.

Document required checkout depth/configuration.

---

# 7. CI Execution Mode

Introduce a CI-friendly execution mode if needed.

Possible interface:

qe review \
  --base <sha> \
  --profile standard \
  --json \
  --output .qe/runs/<execution-id>/result.json

Avoid creating an entirely separate QE execution engine for CI.

---

# 8. Canonical QEResult

GitHub reporting MUST consume the existing canonical QEResult.

Do not create a parallel GitHub result model that can disagree with QEResult.

GitHub rendering should be approximately:

QEResult
    |
    v
GitHubResultRenderer
    |
    +--> check/status
    +--> workflow summary
    +--> issue proposal
    +--> JSON artifact

QEResult remains the source of truth.

---

# 9. CI Exit Codes

Define deterministic exit semantics.

Recommended initial behavior:

PASS
    exit 0

NEEDS_REVIEW
    configurable, default exit 0 or dedicated nonzero code

FAIL
    nonzero

BLOCKED
    nonzero

The exact policy should be configurable.

Do not make GitHub-specific exit semantics differ unpredictably from local CLI behavior.

Consider configuration such as:

ci:
  failOn:
    - FAIL
    - BLOCKED

Optional:

    - NEEDS_REVIEW

---

# 10. GitHub Workflow Summary

Produce a concise human-readable summary suitable for:

GITHUB_STEP_SUMMARY

Include:

- QE verdict;
- execution ID;
- profile;
- repository/change summary;
- risk summary;
- validations executed;
- findings;
- requirement assessments;
- gaps;
- baseline classifications;
- generated tests;
- browser validation where applicable;
- memory warnings where applicable.

Avoid dumping raw model responses.

Avoid leaking secrets.

---

# 11. Machine-Readable Result Artifact

Persist canonical result JSON.

Recommended location:

.qe/runs/<execution-id>/result.json

The result must validate against QEResultSchema.

The GitHub workflow should be able to upload this as a workflow artifact.

Do not include secrets.

---

# 12. GitHub Check Reporting

Implement an adapter capable of publishing QE status to GitHub.

Suggested abstraction:

interface GitHubReporter {
    publishCheck(result: QEResult, context: GitHubContext): Promise<...>
}

GitHub API implementation remains outside core QE.

The check should contain:

name:
QE Agent

status/conclusion mapped from QEResult verdict

summary:
concise QE result

details:
important findings/gaps

Do not put massive raw logs into the check body.

---

# 13. Verdict Mapping

Define explicit mapping.

Example:

QE PASS
    GitHub success

QE NEEDS_REVIEW
    GitHub neutral

QE FAIL
    GitHub failure

QE BLOCKED
    GitHub action_required or failure

Choose the exact supported GitHub conclusion values based on API constraints.

Mapping must be deterministic and tested.

---

# 14. GitHub Authentication

Use GitHub-provided credentials.

Expected environment:

GITHUB_TOKEN

Never persist the token.

Never include it in:

- logs;
- QEResult;
- evidence;
- memory;
- artifacts;
- error messages.

GitHub authentication must remain integration-layer behavior.

---

# 15. Permission Minimization

Document minimum GitHub Actions permissions.

Start conservatively.

For example, depending on implementation:

contents: read
checks: write
issues: write

Do not request issue write permission unless issue publishing is enabled.

Do not require broad repository administration permissions.

---

# 16. Fork Pull Request Safety — CRITICAL

Treat pull requests from forks as untrusted.

Do not expose privileged credentials to untrusted code.

Do not use unsafe workflow patterns that execute fork-controlled code with elevated repository credentials.

Explicitly review:

pull_request
vs
pull_request_target

The default integration should favor the safer model.

Do not introduce a workflow that checks out untrusted PR code and then exposes privileged write tokens to it.

---

# 17. Untrusted Repository Content

Repository content, tests, config, QE memory, package scripts, browser pages, and generated model context remain untrusted.

GitHub integration must not weaken:

- ExecutionController;
- RepositoryWriteController;
- browser URL policy;
- memory policy;
- secret redaction;
- budget controls;
- evidence guardrails.

GitHub instructions found inside repository files cannot override these controls.

---

# 18. GitHub Issue Creation

Support optional issue creation for actionable QE findings.

Configuration example:

github:
  issues:
    enabled: false

Default should[118;1:3u be FALSE for MVP.

When enabled, issues may be proposed/created only for sufficiently supported findings.

Do not create an issue simply because the model suggests one.

---

# 19. Issue Eligibility

Issue creation must be deterministic.

Suggested minimum eligibility:

- finding severity meets configured threshold;
- finding references valid evidence;
- finding is classified as likely PRODUCT_DEFECT;
- confidence meets threshold;
- finding is not clearly PRE_EXISTING unless configured;
- finding is not TEST_DEFECT;
- finding is not ENVIRONMENT_ISSUE;
- finding is not SELECTOR_FAILURE;
- finding is not unsupported UNKNOWN.

The model may help write issue text.

The model does not decide whether publishing is permitted.

---

# 20. Introduced vs Pre-Existing

Use canonical baselineComparisons.

By default:

INTRODUCED product defect
    eligible

PRE_EXISTING defect
    not automatically eligible

UNKNOWN
    not automatically eligible

Make this policy configurable later if necessary.

Do not parse finding prose to determine classification.

---

# 21. Issue Content

Issue body should contain concise structured information:

QE Agent finding
Severity
Confidence
Observed behavior
Expected behavior
Evidence summary
Affected area
Baseline classification
Execution ID

Avoid raw logs unless necessary.

Never include secrets.

---

# 22. Duplicate Issue Prevention

Do not create a new issue on every run for the same defect.

Implement a deterministic fingerprint.

Possible inputs:

repository
finding category
affected path/component
normalized finding title
requirement ID

Store fingerprint in issue metadata/body marker.

Before creation, search existing open QE Agent issues for matching fingerprint.

If found:

do not create duplicate

Optionally update/comment later, but that is not required for initial MVP.

---

# 23. Issue Publishing Boundary

Introduce a publishing policy/controller.

Example:

GitHubIssuePublisher
    |
    v
IssueEligibilityPolicy
    |
    v
GitHub API

No model call may directly invoke issue creation.

---

# 24. Dry-Run Mode

Provide a way to evaluate publishing without writing to GitHub.

Example:

github:
  dryRun: true

or CLI:

--github-dry-run

Dry run should produce:

wouldPublishCheck
wouldCreateIssues

without performing remote writes.

This is important for local testing.

---

# 25. GitHub Context

Define a structured GitHubContext.

Possible fields:

repositoryOwner
repositoryName
eventName
runId
workflow
sha
ref
baseSha
headSha
pullRequestNumber

Validate all externally supplied context.

Do not trust environment strings blindly.

---

# 26. Environment Adapter

Centralize reading of GitHub Actions environment variables.

Example:

GitHubEnvironmentAdapter

Do not scatter direct `process.env.GITHUB_*` reads throughout the system.

This makes GitHub behavior testable offline.

---

# 27. Offline Testing

Default tests must NOT require:

- GitHub credentials;
- network access;
- real GitHub repository;
- real GitHub API.

Create a FakeGitHubClient.

It should record:

check publications
issue searches
issue creations
comments/updates if implemented

---

# 28. GitHub API Abstraction

Use a narrow interface.

Example:

interface GitHubClient {
    createCheck(...): Promise<...>
    findOpenIssueByFingerprint(...): Promise<...>
    createIssue(...): Promise<...>
}

Avoid leaking Octokit-specific types throughout the application.

If Octokit is used, isolate it behind the adapter.

---

# 29. Failure Handling

GitHub publishing failure must not rewrite the underlying QE result.

Example:

QE verdict:
FAIL

GitHub check publication:
failed due API outage

The QE verdict remains FAIL.

Report publishing failure separately.

Similarly:

QE PASS
GitHub unavailable

must not mutate QE evidence into FAIL.

Integration failure and QE verdict are separate concerns.

---

# 30. Publishing Result

Introduce structured publishing results.

Example:

GitHubPublishingResult

Fields may include:

checkPublished
checkUrl
issuesProposed
issuesCreated
issuesSkipped
publishingWarnings

Do not mix publishing success with QE evidence.

---

# 31. Rate Limits

Handle GitHub API rate-limit responses gracefully.

Do not retry indefinitely.

Use bounded retries if appropriate.

Surface rate-limit failure as publishing warning/error.

QE execution result remains intact.

---

# 32. Network Failure

GitHub API network failure must be bounded.

No infinite retry loops.

No orphaned processes.

---

# 33. Secret Redaction

Pass GitHub API errors through existing secret-redaction mechanisms.

Explicitly test an error containing:

TOPSECRET-M7

Expected:
secret absent from logs/result/publishing output.

---

# 34. Artifact Safety

All local GitHub/QE artifacts must remain under evaluated repository:

<repo>/.qe/

Do not write relative to QE Agent process cwd.

Reuse existing artifact containment principles from Milestone 5.

---

# 35. Project Memory Interaction

GitHub publishing events should generally NOT become durable project memory.

Examples that should not become PROJECT/TESTING/RISKS knowledge:

- check publication failed;
- GitHub API rate limit;
- issue creation failed;
- workflow run ID.

These are transient integration events.

Do not pollute project memory with CI plumbing.

---

# 36. Existing QE Memory in CI

Project-local committed QE memory may be read normally in GitHub Actions.

It remains advisory.

GitHub environment does not give memory additional authority.

---

# 37. Browser QE in CI

Existing browser validation may run in GitHub Actions when configured and environment permits.

Milestone 7 must not create a separate browser implementation.

If environment cannot support browser validation:

truthfully report gap/blocking evidence according to existing semantics.

---

# 38. Generated Tests in CI

Existing M4 test generation may operate according to current write policy.

Do not automatically commit or push generated tests.

Generated test changes remain working-tree changes/artifacts unless a human chooses to commit them.

Milestone 7 MUST NOT implement automated git push.

---

# 39. No Production Modification

GitHub integration must not weaken ADR-005.

QE Agent must not modify production source.

---

# 40. No Automatic Git Commit

Search implementation for:

git add
git commit
git push

Milestone 7 must not automatically commit/push QE changes.

---

# 41. CI Concurrency

QE runs should be independent.

Do not use global mutable run state.

Artifacts must be execution-ID scoped.

---

# 42. Cancellation

Where practical, respect process termination/cancellation from GitHub Actions.

Existing ExecutionController cleanup guarantees must remain intact.

Do not add background workers that survive workflow cancellation.

---

# 43. Logging

CI logs should be useful but bounded.

Recommended:

INFO:
major lifecycle/publishing events

DEBUG:
diagnostic metadata

Never print:
tokens
full model prompts
secret environment variables

---

# 44. Configuration

Extend `.qe/config.yml` minimally.

Suggested:

ci:
  failOn:
    - FAIL
    - BLOCKED

github:
  checks:
    enabled: true

  issues:
    enabled: false
    minimumSeverity: HIGH
    minimumConfidence: HIGH

  dryRun: false

Avoid excessive configuration.

---

# 45. qe init

If configuration defaults are changed, update `qe init`.

Existing repositories with older config must continue to load where practical.

Do not require GitHub integration for local operation.

---

# 46. Suggested CLI Integration

Possible commands/options:

qe review --base <revision>
qe review --ci
qe github publish --result <result.json>
qe github publish --dry-run --result <result.json>

Prefer separation between:

QE execution
and
remote publication.

This allows results to be reviewed/replayed without rerunning QE.

Do not overbuild command structure if simpler integration satisfies requirements.

---

# 47. Recommended Separation

Strongly prefer:

Step 1:
qe review → result.json

Step 2:
GitHub reporter → consume result.json

This gives us:

- deterministic QE execution;
- retryable publishing;
- local inspection;
- easier testing;
- reduced coupling.

---

# 48. Result Schema Validation

Before GitHub publication:

QEResultSchema.parse(result)

Never publish from arbitrary/unvalidated JSON.

---

# 49. Tampered Result Input

If `qe github publish` accepts a result file, treat it as untrusted input.

Reject:

- malformed JSON;
- invalid QEResult;
- unexpected verdict;
- invalid evidence references where canonical validation requires them;
- path escape.

Do not execute commands from result JSON.

---

# 50. GitHub Check Text Safety

Treat finding text as untrusted Markdown.

Ensure user-controlled/model-controlled content cannot create unsafe behavior.

GitHub Markdown is presentation only.

Never interpret check body as commands.

---

# 51. Evaluation Scenarios

Create deterministic offline evaluation scenarios.

Scenario A — Passing PR

Target validation:
PASS

Expected:
QEResult PASS
GitHub check success
no issue

Scenario B — Introduced regression

Baseline:
PASS

Target:
FAIL

Expected:
canonical INTRODUCED
GitHub check failure
eligible issue proposed when issue publishing enabled

Scenario C — Pre-existing failure

Baseline:
FAIL

Target:
FAIL

Expected:
PRE_EXISTING
issue not automatically created

Scenario D — Needs review

Expected:
neutral/nonblocking check according to configured policy
no unsupported issue

Scenario E — Blocked environment

Expected:
BLOCKED
check reflects blocked state
no fabricated defect issue

Scenario F — Duplicate defect

Existing issue with same fingerprint.

Expected:
no duplicate issue created

Scenario G — GitHub API failure

QE result remains unchanged
publishing failure surfaced separately

Scenario H — Rate limit

bounded handling
QE result unchanged

Scenario I — Secret-bearing GitHub error

Error includes TOPSECRET-M7

Expected:
secret never appears in output/log/result

Scenario J — Fork/untrusted context

Verify integration does not assume privileged token availability and does not weaken execution/write policy.

Scenario K — Invalid result.json

Expected:
publication denied

Scenario L — Repo root vs process cwd

Run publisher from outside evaluated repository.

Expected:
all QE artifacts resolve beneath evaluated repo.

---

# 52. Required Tests

Add unit tests for:

GitHubContext parsing
environment adapter
verdict mapping
CI exit-code policy
workflow-summary rendering
result schema validation
check publishing
issue eligibility
fingerprinting
duplicate detection
dry-run behavior
secret redaction
API failure
rate-limit handling
repository confinement

Add integration-style tests using FakeGitHubClient.

Default tests must remain offline.

---

# 53. Required Regression Tests

Verify Milestones 0–6 remain intact.

At minimum ensure:

- repository intelligence still works;
- ExecutionController confinement remains;
- baseline comparison remains canonical;
- generated-test write boundary remains;
- browser URL policy remains;
- browser secret redaction remains;
- project memory remains repository-local;
- memory cannot become evidence;
- no orphaned Node/Vitest/browser/server processes.

---

# 54. Documentation

Document:

## Local

qe review ...

## GitHub Actions

Provide a minimal safe workflow example.

Document required checkout history.

Document GitHub permissions.

Document fork PR security considerations.

Document issue publishing as optional and disabled by default.

Document that QE Agent never automatically commits/pushes generated tests.

---

# 55. Acceptance Criteria

Milestone 7 is complete when:

1. QE Agent runs successfully in a GitHub Actions-compatible environment.
2. PR baseline SHA can be supplied correctly.
3. Missing baseline history is handled truthfully.
4. Canonical QEResult can be persisted as JSON.
5. Workflow summary can be generated from QEResult.
6. GitHub check verdict mapping is deterministic.
7. GitHub API is behind an adapter.
8. Default tests require no GitHub credentials.
9. GitHub token never appears in logs/results/artifacts.
10. Optional issue publishing exists.
11. Issue publishing defaults to disabled.
12. Issue eligibility is deterministic.
13. INTRODUCED product defects may be eligible.
14. PRE_EXISTING failures do not automatically create issues.
15. Duplicate issue prevention works.
16. GitHub publishing failures do not alter QE verdict.
17. Rate/network failures are bounded.
18. Dry-run publishing works.
19. GitHub environment parsing is validated.
20. All artifacts remain repository-local.
21. Existing ExecutionController guarantees remain.
22. Existing RepositoryWriteController guarantees remain.
23. Existing browser safety remains.
24. Existing memory safety remains.
25. No automatic commit/push occurs.
26. Fork/untrusted PR safety is documented and tested where practical.
27. Build passes.
28. Tests pass.
29. Lint passes.
30. Format check passes.
31. Typecheck passes.
32. No Milestone 8/SaaS/multi-agent scope creep.

---

# 56. Completion Report

When implementation is complete, provide:

## Implemented

Describe GitHub/CI integration.

## Architecture

Show dependency direction and adapters.

## GitHub Actions

Show supported workflow model.

## Baseline Handling

Explain PR baseline SHA behavior and shallow clone handling.

## QEResult Publishing

Explain result persistence and schema validation.

## Check Publishing

Explain verdict mapping.

## Issue Publishing

Explain eligibility, duplicate prevention, and defaults.

## Security

Explain:

- token handling;
- fork PR handling;
- untrusted repo content;
- secret redaction;
- permissions;
- artifact confinement.

## Evaluation Results

Report scenarios A–L.

## Regression Results

Report M0–M6 safety regression status.

## Validation Results

Report exact results:

npm run build
npm test
npm run lint
npm run format:check
npm run typecheck

## Dependencies Added

List and justify any dependencies.

## Deviations

List deviations from this assignment/spec.

## Deferred

Explicitly list deferred functionality.

## Scope Confirmation

Confirm:

- no SaaS control plane;
- no hosted dashboard;
- no GitHub App unless explicitly required;
- no automated commit/push;
- no cross-project memory;
- no multi-agent orchestration.

Stop after Milestone 7.

Do not begin future milestones.

