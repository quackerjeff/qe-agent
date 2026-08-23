# Token and Cost Telemetry Feature

Status: Proposed for implementation after Milestone 7.

Source: GitHub issue #1, "Add token and cost telemetry to qe analyze".

## Problem

`qe analyze` and related QE workflows need first-class AI usage visibility.
Users should be able to see how many model calls were made, how many tokens
were consumed or reserved, and what the estimated cost was.

For production use, users also need to understand why a run requires a given
amount of model throughput. Large prompts may be valid, but the agent should
not blindly assume that every assembled context fits the current model, account
tier, or token-per-minute limit.

## Product Requirement

The QE Agent SHALL provide token-budget awareness and graceful handling of
model throughput limits.

The agent SHOULD estimate model demand before a call is made, including:

- context tokens;
- maximum response token reservation;
- estimated total TPM demand;
- known model or account limit when available.

If estimated demand exceeds the effective limit, the agent SHOULD reduce,
chunk, or summarize context before making the call. If the request still cannot
fit, the QE result should explain the blocked condition clearly instead of
surfacing only a raw provider error such as `429`.

## Example Human Output

```text
QE Analysis Complete
Risk: MEDIUM
Decision: REVIEW REQUIRED

AI usage:
  Model calls:     7
  Input tokens:    41,822
  Output tokens:    6,103
  Cached tokens:   18,450
  Estimated cost:  $0.14
```

## Example Token Budget Explanation

```text
qe analyze
   |
   |-- System/instructions       2,500 tokens?
   |-- PR diff                   4,000?
   |-- Milestone/spec            2,000?
   |-- Evidence                  1,500?
   |-- Previous findings         1,000?
   `-- max output reservation    1,500?
                              ---------
                               ~12,500
```

The exact categories may evolve, but the agent should expose enough structure
to explain the major contributors.

## Example Throughput Check

```text
QE Analysis
------------
Context tokens:       8,742
Max response tokens:  2,000
Estimated TPM demand: 10,742
Current model limit:  10,000

-> Context exceeds available model throughput.
```

## Functional Requirements

1. `qe analyze` SHOULD report AI usage in human-readable output when model
   usage exists or when usage is meaningfully zero.
2. `qe analyze --json` SHALL expose deterministic telemetry fields suitable for
   automation.
3. Telemetry SHALL remain provider-independent at the core domain and
   orchestration layers.
4. Provider-specific token accounting and pricing details SHALL remain behind
   the Model Gateway/provider adapter boundary.
5. The agent SHOULD estimate token demand before dispatching model calls.
6. The agent SHOULD inspect and right-size `max_tokens` or
   `max_completion_tokens` reservations based on expected output size.
7. Oversized requests SHOULD be reduced, chunked, or summarized before failing.
8. 429 handling SHOULD distinguish transient rate exhaustion from a single
   request that cannot fit under the effective TPM limit.
9. Missing pricing data SHALL NOT fail analysis.
10. Telemetry SHALL NOT include secrets or raw provider credentials.

## Suggested Structured Fields

Exact schemas may be refined during implementation, but output should support:

```text
aiUsage.modelCalls
aiUsage.inputTokens
aiUsage.outputTokens
aiUsage.cachedTokens
aiUsage.maxResponseTokens
aiUsage.estimatedTpmDemand
aiUsage.modelLimit
aiUsage.estimatedCost
aiUsage.currency
aiUsage.contextBreakdown[]
aiUsage.limitStatus
```

Suggested `limitStatus` values:

```text
OK
REDUCED
DEGRADED
BLOCKED
UNKNOWN
```

## Non-Goals

- Do not implement billing, invoices, payment collection, or SaaS account
  infrastructure.
- Do not hard-code provider SDK behavior into core QE logic.
- Do not require external services in deterministic tests.
- Do not store provider secrets in `.qe/config.yml`, reports, logs, or memory.

## Acceptance Criteria

- `qe analyze --json` includes AI usage telemetry.
- Human-readable `qe analyze` output includes an `AI usage` section when
  applicable.
- Runs with no model calls report zero usage or an explicit no-usage state.
- Token usage and estimated cost are aggregated across model calls.
- Context/token budget estimates are available before provider dispatch.
- Oversized requests are detected before dispatch when enough limit data is
  available.
- The agent can reduce, chunk, or summarize oversized context before failing.
- An intrinsically oversized request produces a clear blocked/degraded reason,
  not only a raw 429.
- Tests cover zero usage, populated usage, missing pricing data, oversized
  demand, context reduction behavior, and provider-independent handling.
