Final Targeted Re-Review — Milestone 5: Browser QE & Playwright

Milestone: 5
Review Type: Targeted correction re-review
Purpose: Verify the specific Milestone 5 blockers are resolved
Do NOT modify the repository.
Do NOT begin Milestone 6.

Required Reading

Read:

- AGENTS.md
- docs/milestones/milestone-5-browser-qe.md
- docs/milestones/milestone-5-review.md
- docs/milestones/milestone-5-corrections.md
- latest Milestone 5 correction completion report
- relevant accepted ADRs

Treat completion reports as claims to verify.

Required Verdict

Return exactly one:

ACCEPT
CHANGES REQUIRED
REJECT

Use ACCEPT if the material Milestone 5 blockers are resolved and no new regression is found.

Do not block for cosmetic cleanup.

1. URL Policy — CRITICAL

Reproduce all previously failing navigation cases.

A. Direct external navigation
Expected:
DENIED

B. Allowed local page redirects to external origin
Expected:
external destination not successfully visited
policy failure recorded
browser result not PASS

C. Allowed local page contains external link
Click it.
Expected:
external navigation denied

D. Script-driven navigation to external origin
Expected:
denied

E. External form submission
Expected:
denied

F. Popup/new page to external origin
Expected:
denied/closed

G. Explicitly allowlisted external origin
Expected:
allowed only when configured

Verify policy is enforced based on what the browser actually does, not only the initial NAVIGATE request.

State whether top-level navigation only or all subresource traffic is governed by this policy.

Do not claim full network isolation if external subresources remain possible.

2. Secret Redaction — CRITICAL

Reproduce the prior ASSERT_VALUE leak.

Use a known value such as:

TOPSECRET-M5

Verify it does not appear in:

- BrowserResult
- canonical evidence
- JSON output
- human report
- logs
- console/page/network metadata
- artifact metadata

Also test a password input.

Expected:
raw secret/password value never emitted

Redacted or boolean/match-style reporting is acceptable.

3. Browser Artifact Root

Run QE against a repository that is NOT the QE Agent process cwd.

Verify browser artifacts land under:

<evaluated-repository>/.qe/...

or the approved repository-local equivalent.

Verify:

- no artifact is written relative to unrelated cwd;
- traversal is denied;
- absolute path escape is denied;
- symlink escape is denied.

4. Canonical Browser Baseline Comparison — CRITICAL

Reproduce:

baseline browser PASS
target browser FAIL

Expected:
structured classification = INTRODUCED

Verify canonical QEResult contains machine-readable:

- classification
- targetEvidenceId
- baselineEvidenceId
- scenario/action identifier as appropriate

Do not parse finding prose to obtain classification.

Then reproduce:

baseline browser FAIL
target browser FAIL equivalently

Expected:
structured classification = PRE_EXISTING

Verify the target is not falsely blamed.

5. Target/Baseline Isolation

For browser baseline comparison verify:

- target uses target source revision;
- baseline uses baseline source revision;
- applications use separate ports/processes;
- same/equivalent browser scenario is executed;
- target and baseline evidence are distinct;
- worktrees are cleaned up.

6. Managed Process Tree Cleanup

Use or inspect a managed app that spawns a child process.

Verify normal cleanup terminates QE-owned descendants.

Also verify cleanup for:

- readiness timeout;
- startup failure;
- browser failure;
- unexpected exception.

Expected:
no QE-owned descendants remain
ports released

Do not accept global pkill as cleanup.

7. Existing-App Ownership

Verify existing-app mode does NOT terminate an application process QE Agent did not start.

8. Browser Evidence Truthfulness

Verify a denied redirect/click/navigation cannot be recorded as PASS.

Browser PASS requires:

- action actually executed;
- policy not violated;
- expected observation satisfied.

9. Prompt Injection

Serve page content instructing QE Agent to:

- navigate externally;
- modify production source.

Verify:

- URL policy still wins;
- RepositoryWriteController still wins;
- no external navigation;
- no production change.

10. Generated Browser Regression Test

If the correction implemented full end-to-end browser test generation, verify:

confirmed UI regression
→ test generation
→ RepositoryWriteController
→ approved test path
→ actual execution
→ evidence
→ PERMANENT_REGRESSION retention
→ production source unchanged

If this remains intentionally deferred, verify Milestone 4 generic generation guarantees remain intact and no false claim of end-to-end browser generation is made.

11. Milestone 4 Regression Check

Verify browser corrections did not weaken:

- RepositoryWriteController
- generated-test execution proof
- bad-generated-test handling
- production write denial

12. Milestone 3 Regression Check

Verify browser corrections did not weaken:

- structured baseline comparison
- evidence-reference integrity
- execution budgets
- lifecycle history
- retry accounting

13. Process Hygiene

Run:

npm test -- tests/milestone-5-browser-integration.test.ts

twice.

After each run verify no QE-created:

- node
- npm
- playwright
- chromium/chrome
- app-server
- baseline-app-server

processes remain.

Also verify:

- no temporary baseline worktrees remain;
- no unexpected temporary browser test files remain;
- ports are released.

No manual pkill.

14. Targeted Unit Validation

Run:

npm test -- tests/milestone-5-browser.test.ts

Expected:
PASS

15. Full Validation

Run independently:

npm run build
npm test
npm run lint
npm run format:check
npm run typecheck

All must pass.

16. Scope Compliance

Verify corrections did NOT introduce:

- project memory
- GitHub integration
- SaaS
- browser farm
- cross-browser matrix
- visual regression platform
- multi-agent orchestration

Required Output

Verdict

Return exactly one:

ACCEPT
CHANGES REQUIRED
REJECT

Executive Assessment

Briefly state whether the Milestone 5 blockers are resolved.

Previous Findings Re-Review

For each previous finding mark:

RESOLVED
PARTIALLY RESOLVED
NOT RESOLVED
REGRESSION

Cover:

1. redirect/page-initiated URL escape
2. browser secret leak
3. artifact root outside evaluated repo
4. missing canonical browser baseline comparison
5. managed-process descendant cleanup
6. generated browser regression-test completeness

Browser Safety Results

Report actual results for:

- direct external navigation
- redirect escape
- link navigation
- script navigation
- form navigation
- popup navigation
- allowlisted origin
- prompt injection

Secret Redaction Results

Report where TOPSECRET-M5/password was tested and confirm whether it appeared anywhere.

Baseline Results

Report:

baseline PASS + target FAIL
classification:
target evidence present:
baseline evidence present:
final verdict:

baseline FAIL + target FAIL
classification:
target evidence present:
baseline evidence present:
final verdict:

State explicitly whether classification came from structured QEResult data.

Artifact Results

Report evaluated repository path and actual artifact path.

Process Hygiene Results

Report:

browser integration run #1
browser integration run #2
leftover browser/node/app processes
leftover worktrees
port cleanup
manual cleanup required? yes/no

Validation Results

Report exact results for:

npm test -- tests/milestone-5-browser.test.ts
npm test -- tests/milestone-5-browser-integration.test.ts # run 1
npm test -- tests/milestone-5-browser-integration.test.ts # run 2
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck

Remaining Findings

Only list material remaining issues.

For each:

Severity:
Location:
Description:
Why it matters:
Recommended correction:

Final Recommendation

Answer explicitly:

Is Milestone 5 sufficiently safe and trustworthy to close and begin Milestone 6?

If yes:

ACCEPT — Milestone 5 may be closed and Milestone 6 may begin.

If a material browser safety, secret-handling, baseline, artifact, or process-cleanup defect remains:

CHANGES REQUIRED — Milestone 5 remains open.

Do not modify the repository.
Do not begin Milestone 6.
Stop after producing the review.
