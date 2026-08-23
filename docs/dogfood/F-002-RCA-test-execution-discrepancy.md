# F-002 RCA: Cross-Project Test Execution Discrepancy

**Target repository:** `~/Development/BECCO/version-2/becco-ui-v2`
**QE execution ID:** `2c349e3b-4ba7-417b-87f2-0eaf71d93404`
**Date:** 2026-08-23
**Investigator:** Claude (RCA-only — no production code changes)

---

## 1. Exact QE Execution Record

Run `2c349e3b-4ba7-417b-87f2-0eaf71d93404` executed at `2026-08-23T22:32:49.726Z` using profile `quick` (2 min / 6 model calls / 1 retry / 1 test).

**Provider attempts (6 of 6 budget consumed):**

| # | Role | Duration | Success | Tokens (in/out) |
|---|------|----------|---------|-----------------|
| 1 | risk_analyst | 5520ms | yes | 4760/409 |
| 2 | test_strategist | 4505ms | yes | 5700/711 |
| 3 | failure_investigator | 1855ms | yes | 2503/123 |
| 4 | gap_analyst (chunk 0, req-1..19) | 4584ms | yes | 4252/483 |
| 5 | gap_analyst (chunk 1, req-20..25) | 6347ms | yes | 5279/866 |
| 6 | verdict_reviewer | 3377ms | yes | 3851/278 |

**Critical observation:** `failure_investigator` was called. This only occurs when at least one executed command has evidence status `FAIL` (exit code ≠ 0). The failure_investigator consumed model call slot 3 of 6, which in turn prevented `memory_distiller` from running (would have required a 7th call, exceeding the quick profile's budget of 6).

**Consequence:** No history summary was written for this run (history summaries require the memory_distiller). The passing reproduction run (643f30b3) does have a history summary because it used only 6 calls without needing the failure_investigator.

**Evidence IDs cited in gap assessments:**
- `ev-861a4854-1d8c-4bb7-a61c-f07853de020e` — typecheck or build (referenced in req-1, req-2, req-7, req-16)
- `ev-506f7955-3ff8-4603-84a6-140c6871a0b7` — build or typecheck (referenced in req-1)
- `ev-discovery-repository` — repository discovery (referenced in req-2, req-16)

**No test evidence was cited positively.** In gap chunk 0, raw gap: `"The test execution failed due to an environment issue, indicating a gap in verifying test results."` The gap analyst classified the failure as `risk: MEDIUM`, `area: Testing`.

**Verdict:** BLOCKED (due to UI-centric requirements not verifiable by test execution, consistent with passing runs).

## 2. Exact Failure Output

**The actual stdout/stderr from the failing test command is not preserved.**

QE Agent's evidence persistence architecture explains why:

1. `evidence-factory.ts` creates evidence objects containing metadata only: `exitCode`, `durationMs`, `timedOut`, `terminationReason`, `truncated` — but NOT `stdout`/`stderr` (`src/execution/evidence-factory.ts:19-35`).
2. The `failure-investigator.ts` receives `stdout.slice(0, 4096)` and `stderr.slice(0, 4096)` in-memory during the run (`src/core/reasoning/failure-investigator.ts:29-30`), but these are discarded after the model call.
3. Only `diagnostics.json` is written to disk per run. It records provider attempt metadata and gap chunk results — not command output.
4. The gap analyst receives evidence metadata only, not stdout/stderr (`src/core/orchestrator/context-builder.ts` does not include execution output).

**What we know from the model's classification:** The failure_investigator received the actual output and classified the cause as `ENVIRONMENT_ISSUE` (inferred from the gap analyst's downstream summary: "The test execution failed due to an environment issue"). The finding category map in `failure-investigator.ts:42-48` maps `ENVIRONMENT_ISSUE` to `Finding.category = "ENVIRONMENT_ISSUE"`.

**What we do NOT know:** The specific error message, stack trace, or exit code from the failing test command.

## 3. Manual Execution Record

User reported manual execution produced PASS:
- **Command:** `npm run test` (resolves to `vitest run`)
- **Result:** 16 test files, 158 tests, all passing
- **Exit code:** 0
- **Framework:** Vitest 4.1.10, jsdom environment, Vue 3, TypeScript

## 4. QE vs Manual Environment Diff

### QE Local Executor environment (what verify uses):

The orchestrator hardcodes `executionMode: "local"` for all command execution (`src/core/orchestrator/orchestrator.ts:486-488` and `1382-1384`). The local executor builds a filtered environment from the host process via an allowlist (`src/execution/local-executor.ts:13-43`):

**Included:** `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TMPDIR`, `TMP`, `TEMP`, `HOSTNAME`, `EDITOR`, `VISUAL`, `PAGER`, XDG vars, Windows-specific vars.

**Excluded (notable for Node.js/Vitest):**
- `NODE_ENV` — Vitest sets this internally; absence should not cause failure
- `NODE_OPTIONS` — could affect V8 flags, heap size
- `NVM_DIR`, `NVM_BIN`, `NVM_INC` — not needed if PATH contains the correct node binary
- `npm_config_*` — npm internal configuration
- `VITEST_*`, `VITE_*` — Vitest/Vite configuration variables
- `FORCE_COLOR`, `NO_COLOR`, `COLORTERM` — terminal color control
- `CI` — CI mode flag (affects some test runner behavior)
- `COREPACK_*` — Corepack package manager management

### Manual execution environment:

Full shell environment inherited, including all of the above.

### Spawn configuration:

Local executor: `spawn(executable, args, { cwd, env: filteredEnv, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: true })` (`src/execution/local-executor.ts:96-102`).

Manual: standard terminal session with `shell: true` semantics, full TTY, full env.

**Assessment:** The env filtering is the most significant systematic difference. However, reproduction through the same filtered environment consistently passes (see Section 10), so env filtering is not the deterministic cause of this specific failure.

## 5. Repository-State Comparison

**At time of original QE run (2c349e3b):** Unknown. No git status was captured.

**At time of investigation reproduction (643f30b3):** Tests pass. No uncommitted changes were reported in the target repo during investigation.

**Prior run contamination check:** Run `431b185f-44eb-4357-8680-e61fec4af1b8` (executed 49 seconds before 2c349e3b at `22:32:00.196Z`) was a total API failure — every provider attempt produced `APIConnectionError` in <1ms. No commands were ever planned or executed. No validation actions ran. No files were modified. The run completed in 28ms total. **No state contamination from the prior run.**

**Node module state:** `becco-ui-v2` uses `@rolldown/binding-darwin-arm64` (macOS ARM native binding). The `node_modules` directory contains platform-specific binaries. These work correctly under local execution (macOS host → macOS binary) but fail under Docker execution (macOS binary mounted into Linux container). This is relevant only to the separate Docker finding (Section 16), not to the local-mode verify path.

## 6. Command Order

The test_strategist plans validation actions. Based on the evidence IDs in the gap assessments:

1. Typecheck (`vue-tsc --noEmit`) — `ev-861a4854` — **PASS** (cited as evidence for req-1, req-2, req-7, req-16)
2. Test (`npm run test` → `vitest run`) — no evidence ID cited positively — **FAIL** (triggered failure_investigator)
3. Build (`vite build`) — `ev-506f7955` — **PASS** (cited as evidence for req-1)

**Note:** The exact execution order is inferred from the evidence citation pattern. The test command failure did NOT prevent subsequent commands from executing (the build command ran and passed). This is correct behavior — the orchestrator iterates through all planned actions regardless of individual failures.

## 7. Timeout/Abort Analysis

**No timeout occurred.**

- The quick profile allows 120s total wall clock. The entire run (all 6 provider attempts) completed in ~25s of model time.
- The failure_investigator completed in 1855ms — it received and processed the failure output quickly, indicating a clear/short error message rather than a timeout.
- `terminationReason` is not available in the diagnostics (only provider attempts are logged, not execution results). However, if the command had timed out, the evidence status would be `INCONCLUSIVE` (per `evidence-factory.ts:53`), not `FAIL`, and the failure_investigator would not have been triggered (it only runs for `status === "FAIL"`, i.e., non-zero exit code).

**Conclusion:** The test command ran to completion with a non-zero exit code. It was not killed by timeout.

## 8. Executor Trace

**Executor used:** `LocalExecutor` (hardcoded by orchestrator at `orchestrator.ts:488`).

**Executor path:**
1. `orchestrator.ts:486-488` creates `ExecutionContext` with `executionMode: "local"`
2. `controller.ts:97-111` `selectExecutor()` — `case "local"` returns `this.localExecutor`
3. `local-executor.ts:45-63` `buildEnvironment()` — constructs filtered env from allowlist
4. `local-executor.ts:65-91` `buildSafeCommand()` — validates executable, blocks dangerous commands
5. `local-executor.ts:96-102` `spawn(executable, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: true })`

**Docker was NOT used.** The `executionMode: "local"` hardcoding in the orchestrator bypasses the `auto` mode resolution logic in the ExecutionController. The config-level `execution.mode: auto` setting only applies to `qe exec` CLI commands (`src/cli/exec.ts:39`), not to verify/review orchestration.

**Key distinction:** `qe exec --command npm --arg run --arg test` (CLI) uses config default → auto → Docker when available. `qe verify` (orchestrator) hardcodes local. These are different execution paths with different executors.

## 9. Environment Filtering Analysis

The local executor's `SAFE_ENV_VARS` allowlist (`src/execution/local-executor.ts:13-43`) excludes 6 categories of variables relevant to the Node.js/Vitest ecosystem:

| Category | Variables | Impact on Vitest |
|----------|-----------|-----------------|
| Node runtime | `NODE_ENV`, `NODE_OPTIONS` | Vitest sets NODE_ENV internally; NODE_OPTIONS could affect heap/V8 flags |
| Package manager | `npm_config_*`, `COREPACK_*` | Affects npm resolution behavior, could affect package scripts |
| Test framework | `VITEST_*`, `VITE_*` | Vitest respects these for configuration overrides |
| Version manager | `NVM_DIR`, `NVM_BIN`, `NVM_INC` | Not needed if PATH is correct |
| CI/terminal | `CI`, `FORCE_COLOR`, `NO_COLOR` | CI mode changes some test runner defaults; color vars affect output |
| Platform | `DISPLAY`, `DBUS_*`, `XDG_SESSION_*` | Irrelevant for jsdom tests |

**Assessment:** The allowlist is restrictive but functional for standard test execution. PATH is included, which means the correct Node.js binary is used. HOME is included, which means npm can find its cache. The absence of `NODE_ENV` is the most notable exclusion, but Vitest's `vitest run` command sets `NODE_ENV=test` internally.

**However:** The allowlist IS a source of non-reproducibility between QE execution and manual execution. Any test that depends on an excluded variable will behave differently. This is by design (security isolation) but represents a predictable divergence surface.

## 10. Reproduction Results

### Reproduction 1: `qe exec` with auto mode (WRONG reproduction path)
- **Command:** `node dist/cli/main.js exec --command npm --arg run --arg test --repo ~/Development/BECCO/version-2/becco-ui-v2`
- **Mode resolved:** auto → Docker (Docker available on this machine)
- **Result:** FAIL — `Cannot find module '@rolldown/binding-linux-arm64-gnu'`
- **Relevance:** This is a SEPARATE issue. The orchestrator's verify path never uses Docker. This reproduction tested the wrong execution path.

### Reproduction 2: `qe exec` with local mode (CORRECT executor, CLI path)
- **Command:** `node dist/cli/main.js exec --command npm --arg run --arg test --repo ~/Development/BECCO/version-2/becco-ui-v2 --mode local`
- **Result:** PASS — exit code 0, 16 test files, 158 tests, 2198ms
- **Relevance:** Same executor (LocalExecutor) as verify uses. Passes.

### Reproduction 3: Full `qe verify` pipeline (CORRECT reproduction path)
- **Command:** `node dist/cli/main.js verify --profile quick --repo ~/Development/BECCO/version-2/becco-ui-v2 --requirements ~/Development/BECCO/version-2/becco-ui-v2/docs/ui/vue-project-shell.md`
- **Execution ID:** `643f30b3-fcc0-4630-8e4c-40d419bdaa0d`
- **Result:** All 3 commands passed (typecheck PASS, test PASS, build PASS). No failure_investigator triggered. Verdict: BLOCKED (same as original, due to UI requirements not verifiable by test execution).
- **Evidence:** `ev-d93697cf` (typecheck), `ev-4cc934bb` (test), `ev-bacaf589` (build) — all PASS.
- **Relevance:** This is the EXACT reproduction path. The failure is NOT reproducible.

### Reproduction 4: Manual execution
- **Command:** `npm run test` in becco-ui-v2 directory
- **Result:** PASS — 16 test files, 158 tests
- **Relevance:** Confirms the target project's tests are passing.

**Summary:** 4 reproduction attempts, 3 on the correct execution path — all pass. The original failure is not reproducible.

## 11. Flakiness Analysis

**Vitest test suite characteristics:**
- 16 test files, 158 tests
- jsdom environment (no real browser, no network)
- Vue 3 component tests
- No known external dependencies in test fixtures
- Tests consistently pass across manual runs and QE reproductions

**Potential flakiness vectors:**
1. **jsdom resource contention:** jsdom creates synthetic DOMs; under memory pressure or concurrent spawns, allocation could fail. However, the test suite is small (158 tests, ~2s total).
2. **File system race conditions:** If `vite.config.ts` compilation or dependency resolution encounters a lock file from a concurrent process, it could fail transiently.
3. **npm script resolution:** With the filtered environment, `npm run test` resolves the `vitest` binary through `node_modules/.bin`. If the binary lookup failed transiently (e.g., disk cache miss), the command would fail.
4. **Rolldown native binding loading:** `@rolldown/binding-darwin-arm64` is a native binary. If macOS Gatekeeper or code signing validation triggered on first execution after the binary was written, it could fail once and succeed on retry.

**Assessment:** No deterministic flakiness mechanism identified. The tests are stable in all reproductions. If the original failure was flaky, it was a one-shot transient condition that is not reproducible.

## 12. Evidence/Finding/Verdict Trace

### Evidence chain (failing run 2c349e3b):

```
ExecutionController.execute()
  → LocalExecutor.execute()
    → spawn("npm", ["run", "test"], { env: filteredEnv, shell: false })
    → exit code ≠ 0
  → EvidenceFactory.createExecutionEvidence(result, "TEST")
    → evidence.status = "FAIL" (exitCode !== 0)
    → evidence.id = "ev-{executionId}"

executionResults.filter(r => r.evidence.status === "FAIL")
  → [test execution result]
  → failure_investigator called with stdout[0:4096], stderr[0:4096], exitCode
  → model classifies: likelyCause = "ENVIRONMENT_ISSUE"
  → Finding: { category: "ENVIRONMENT_ISSUE", ... }

context-builder → gap_analyst receives evidence metadata (no stdout/stderr)
  → gap_analyst chunk 0: "The test execution failed due to an environment issue"
  → raw gap: { area: "Testing", risk: "MEDIUM" }

verdict_reviewer
  → BLOCKED (insufficient evidence for UI requirements)
```

### Evidence chain (passing reproduction 643f30b3):

```
ExecutionController.execute()
  → LocalExecutor.execute()
    → spawn("npm", ["run", "test"], { env: filteredEnv, shell: false })
    → exit code = 0
  → EvidenceFactory.createExecutionEvidence(result, "TEST")
    → evidence.status = "PASS"
    → evidence.id = "ev-4cc934bb-2a66-4fdb-9f30-be4331d9e459"

No failure_investigator triggered.
memory_distiller runs (budget allows 6th call without failure_investigator).
History summary written.
Verdict: BLOCKED (same — UI requirements not verifiable).
```

### Key difference:
The ONLY difference between the failing and passing runs is the test command's exit code. The test command exited non-zero in the original run and zero in the reproduction. Everything else (executor, environment filtering, command construction, budget management, gap analysis, verdict) behaved identically.

## 13. First Bad State

**First bad state:** Non-zero exit code from `npm run test` during local execution in run `2c349e3b`.

**Where it occurred:** `src/execution/local-executor.ts:192-218` — the child process exited with a non-zero code. The local executor correctly captured this and reported it. The evidence factory correctly marked the evidence as `FAIL`. The failure_investigator correctly classified it as `ENVIRONMENT_ISSUE`. The gap_analyst correctly noted the testing gap. The verdict_reviewer correctly produced BLOCKED.

**What is NOT the first bad state:**
- Not the evidence persistence (diagnostics.json was correctly written)
- Not the model calls (all 6 succeeded)
- Not the budget management (correctly exhausted at 6/6)
- Not the verdict (BLOCKED is correct given the available evidence)
- Not the orchestrator's executor selection (correctly used local, not Docker)

The entire QE pipeline behaved correctly given the input (a failing test command). The discrepancy is that the test command failed during the QE run but passes in all reproductions.

## 14. Root Cause

### Classification: UNKNOWN_INSUFFICIENT_EVIDENCE

**The root cause of the original test failure cannot be determined.**

**Why:**
1. The actual error output (stdout/stderr) from the failing test command is not preserved. The evidence factory stores metadata only; the failure_investigator consumed the output in-memory and discarded it after the model call.
2. The failure is not reproducible through the exact same execution path (local executor, same environment filtering, same command).
3. No repository state contamination from the prior run (431b185f) is possible — it failed at the API layer before executing any commands.
4. The failure_investigator's classification of "ENVIRONMENT_ISSUE" is second-hand evidence — it tells us the model's interpretation of the output, not the output itself.

**Most likely hypotheses (ranked by probability):**

1. **Transient native binding issue (40%):** First-time loading of `@rolldown/binding-darwin-arm64` in a clean subprocess environment may trigger macOS security validation (Gatekeeper/codesign) that fails once and succeeds on subsequent attempts.

2. **Transient file system contention (25%):** The prior run (431b185f) and the current run (2c349e3b) were initiated ~49 seconds apart. If the API failure run partially initialized any file system state (npm cache, temp files) that was still being cleaned up, it could interfere with the test run's module resolution.

3. **Environment-dependent test flake (20%):** One of the 158 tests may depend on an environment variable excluded by the SAFE_ENV_VARS allowlist. The failure was non-reproducible because the specific combination of excluded variable + test path + timing aligned only once.

4. **npm script resolution failure (10%):** `npm run test` under `shell: false` with a filtered environment may occasionally fail to resolve the `vitest` binary, especially if npm's internal caching depends on an excluded variable.

5. **Unknown transient condition (5%):** Disk I/O, memory pressure, or other OS-level transient condition.

**Confidence in root cause: LOW (insufficient evidence).**

## 15. Generic Product Impact

### Primary impact: Evidence loss

QE Agent does not persist command execution output (stdout/stderr) to disk. This means:
- Post-run RCA is impossible when the failure is not reproducible
- The failure_investigator's model-mediated classification is the only record of what went wrong
- Users cannot distinguish between a genuine product defect, a test flake, and an environment issue without re-running

This is a **product-level observability gap**, not a bug in any single component.

### Secondary impact: Docker/local mode confusion

The `qe exec` CLI command and the `qe verify` orchestrator use **different execution mode defaults**:
- `qe exec`: config default → `auto` → Docker when available
- `qe verify`/`qe review`: hardcoded `local`

This means `qe exec --command npm --arg run --arg test` produces a DIFFERENT result than `qe verify` running the same command, if Docker is available and the project has platform-specific native bindings. This is confusing for users attempting to reproduce verify results via `qe exec`.

### Tertiary impact: Quick profile budget exhaustion

The quick profile's 6-call budget is exactly consumed by a run with one failure (risk_analyst + test_strategist + failure_investigator + 2×gap_analyst + verdict_reviewer = 6). This leaves no budget for memory_distiller, meaning:
- No history summary is written for failing quick-profile runs
- Project memory is not updated after failures
- The QE system learns nothing from its own failures under the quick profile

## 16. Smallest Generic Correction

### Correction 1: Persist execution output to diagnostics (PRIMARY)

**Where:** `src/core/orchestrator/orchestrator.ts` — after each `controller.execute()` call (line 493-496)

**What:** Add `stdout` (truncated, first 8192 bytes) and `stderr` (truncated, first 8192 bytes) to the run's diagnostics, keyed by evidence ID. This preserves the actual failure output for post-run RCA.

**Scope:** Add an `executionResults` array to the diagnostics schema containing `{ evidenceId, exitCode, stdout, stderr, durationMs }` per executed command. Apply secret redaction before writing (already available via `redactSecrets`).

**Risk:** Low. This adds ~16KB max per command to diagnostics.json. Secrets are already redacted in the executor output. No behavioral change to any QE reasoning.

### Correction 2: Document execution mode divergence (SECONDARY)

**Where:** `docs/USER_GUIDE.md` — Troubleshooting section

**What:** Add a troubleshooting entry explaining that `qe exec` defaults to auto mode (→ Docker) while `qe verify` hardcodes local mode. Users should use `qe exec --mode local` to reproduce verify-path execution.

**Risk:** None. Documentation only.

### Not recommended at this time:

- Changing the quick profile budget (violates regression-preservation contract)
- Adding environment variables to the SAFE_ENV_VARS allowlist (security decision that needs separate analysis)
- Changing the `executionMode: "local"` hardcoding (intentional design decision)

## 17. Regression Surfaces

Any implementation of Correction 1 must NOT:
- Change the diagnostics schema in a way that breaks existing tooling reading diagnostics.json (additive-only)
- Include unsanitized secrets in persisted output (redactSecrets must be applied)
- Change model-call accounting, retry admission, or budget management
- Alter the evidence schema, evidence provenance, or evidence projection
- Affect the verdict, gap analysis, or failure investigation behavior
- Change wall-clock timing or timeout behavior

The correction is purely additive: new data in diagnostics output, no behavioral changes.

## 18. Confidence

| Aspect | Confidence | Rationale |
|--------|------------|-----------|
| Original failure occurred | HIGH | Diagnostics show failure_investigator was triggered; gap_analyst independently noted "test execution failed" |
| Execution path was local (not Docker) | HIGH | Orchestrator hardcodes `executionMode: "local"` at two locations; code is unambiguous |
| Failure is not reproducible | HIGH | 3 reproduction attempts on the correct path all pass |
| Root cause identification | LOW | Actual failure output not preserved; model-mediated classification is the only evidence |
| "Environment issue" classification | MEDIUM | Model received actual output and classified it, but model classifications are probabilistic, not deterministic |
| Prior run contamination | HIGH (ruled out) | Run 431b185f was total API failure; no commands executed; no file system effects |
| Docker as original cause | HIGH (ruled out) | Orchestrator verify path never uses Docker regardless of config |

## 19. Recommendation

### COLLECT_MORE_EVIDENCE

**Rationale:** The root cause cannot be determined from available evidence. The actual failure output was consumed by the failure_investigator model call and discarded. The failure is not reproducible.

**Recommended next steps:**

1. **Implement Correction 1 (output persistence)** before further cross-project acceptance testing. Without preserved command output, any non-reproducible failure will require the same dead-end RCA process.

2. **Re-run cross-project acceptance** against `becco-ui-v2` 3× with the quick profile after implementing output persistence. If a failure recurs, the preserved stdout/stderr will identify the exact cause.

3. **If failure recurs:** The preserved output will classify into one of:
   - Native binding loading error → fix: add rolldown-related env vars or use a warm-up step
   - Module resolution failure → fix: add `npm_config_*` to SAFE_ENV_VARS
   - Test-level flake → fix: fix in target repository
   - Unknown environment issue → provides exact error message for targeted investigation

4. **Document the `qe exec` vs `qe verify` execution mode divergence** in troubleshooting (Correction 2), regardless of whether the original failure recurs.

---

## Appendix A: Separate Finding — Docker Native Binding Incompatibility

**Discovered during investigation, not the cause of F-002.**

When `qe exec` resolves to Docker mode (auto → Docker available), it mounts the host repository into a Linux container (`node:20-slim`) via `-v ${repositoryRoot}:/workspace:ro`. If the repository's `node_modules` contains platform-specific native bindings (e.g., `@rolldown/binding-darwin-arm64` on macOS), the Linux container cannot load them and fails with `Cannot find module '@rolldown/binding-linux-arm64-gnu'`.

**Affected path:** `qe exec` CLI only (config default `auto` → Docker). NOT `qe verify` or `qe review` (hardcoded `local`).

**Impact:** Any project with platform-specific native Node.js bindings will fail when `qe exec` defaults to Docker. This includes projects using Vite/Vitest (via rolldown), esbuild, swc, sharp, better-sqlite3, and many other packages.

**Smallest correction:** Either (a) detect native binding presence and fall back to local, (b) run `npm install` inside the container before test execution, or (c) document the limitation and recommend `--mode local` for projects with native bindings.

**This is a genuine `QE_EXECUTION_CONTROLLER_DEFECT` but is filed separately as it does not affect the verify/review execution path.**

## Appendix B: Run Timeline

```
22:32:00.196Z  Run 431b185f starts (API failure run)
22:32:00.224Z  Run 431b185f completes (28ms, total API failure, no commands executed)
               — 49 second gap —
22:32:49.726Z  Run 2c349e3b starts (F-002 failing run)
22:32:55.246Z  test_strategist completes, commands planned
22:33:03.521Z  failure_investigator called (test command failed)
22:33:05.379Z  gap_analyst chunks dispatched in parallel
22:33:11.728Z  verdict_reviewer starts
22:33:15.107Z  Run 2c349e3b completes (diagnostics written, no history summary)
               — 12 minute gap (investigation/reproduction) —
22:45:06.784Z  Run 643f30b3 starts (reproduction run, all commands pass)
22:45:34.739Z  Run 643f30b3 completes (history summary written)
```

## Appendix C: Diagnostic Files Inventory

| Run | File | Contents |
|-----|------|----------|
| 431b185f | `diagnostics.json` | 15 provider attempts, all APIConnectionError |
| 2c349e3b | `diagnostics.json` | 6 provider attempts (all succeed), failure_investigator present |
| 643f30b3 | `diagnostics.json` | 6 provider attempts (all succeed), no failure_investigator |
| 643f30b3 | `history/summaries/643f30b3.md` | "Verdict: BLOCKED, Findings: None" |

No run has preserved execution output (stdout/stderr).
