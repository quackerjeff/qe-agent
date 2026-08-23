# Implementation Prompt: Token and Cost Telemetry

You are implementing the token and cost telemetry feature for the QE Agent.

Do not implement unrelated milestone work. Keep the implementation small,
provider-independent, deterministic where possible, and consistent with
AGENTS.md, the PRD, the technical specification, and accepted ADRs.

## Required Reading

Before implementing, read:

1. `AGENTS.md`
2. `docs/Automated QE Agent — Product & Functional Requirements.md`
3. `docs/QE Agent — MVP Technical Product Specification & System Design.md`
4. `docs/features/token-cost-telemetry.md`
5. `docs/adr/003-model-provider-abstraction.md`
6. `docs/adr/004-evidence-first-qe-model.md`
7. `docs/adr/009-canonical-qe-result-contract.md`
8. `docs/adr/010-state-machine-and-single-orchestrator-architecture.md`

## Objective

Modify `qe analyze` so it reports token and cost telemetry directly through the
QE Agent.

The implementation must also introduce token-budget awareness so the agent can
estimate model demand before dispatch and gracefully handle requests that exceed
available model throughput.

## Required Behavior

`qe analyze` human-readable output should be able to include:

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

`qe analyze --json` must expose deterministic structured telemetry fields.

The agent should also be able to explain approximate token demand before model
dispatch, for example:

```text
QE Analysis
------------
Context tokens:       8,742
Max response tokens:  2,000
Estimated TPM demand: 10,742
Current model limit:  10,000

-> Context exceeds available model throughput.
```

## Implementation Requirements

1. Add a provider-independent telemetry model for AI usage.
2. Aggregate telemetry across model calls.
3. Include model call count, input tokens, output tokens, cached tokens, max
   response token reservation, estimated TPM demand, limit information when
   known, and estimated cost when available.
4. Keep provider-specific usage extraction and pricing details behind the Model
   Gateway/provider adapter boundary.
5. Do not leak provider SDK types into core QE logic.
6. Estimate token demand before model calls when context is assembled.
7. Inspect current `max_tokens` or `max_completion_tokens` behavior and
   right-size output reservations to realistic expected output sizes.
8. If estimated demand exceeds the effective limit, reduce, chunk, or summarize
   context before dispatch.
9. Distinguish transient 429/rate exhaustion from an intrinsically oversized
   request that cannot fit under the current TPM limit.
10. When the request cannot fit after reduction, return a clear blocked or
    degraded result that explains the throughput constraint.
11. Ensure telemetry is available in JSON output without mixing diagnostics into
    stdout.
12. Ensure human-readable output remains concise.
13. Do not implement billing, payment, account management, or SaaS
    infrastructure.
14. Do not persist secrets in logs, reports, memory, prompts, or test artifacts.

## Suggested Design Shape

Prefer a small domain type such as:

```text
AIUsageTelemetry
AIUsageTotals
AIContextTokenBreakdown
AIThroughputEstimate
```

Use different names if the existing codebase suggests better names, but keep
the concepts explicit and provider-independent.

Suggested fields:

```text
modelCalls
inputTokens
outputTokens
cachedTokens
maxResponseTokens
estimatedTpmDemand
modelLimit
estimatedCost
currency
contextBreakdown
limitStatus
```

Suggested limit statuses:

```text
OK
REDUCED
DEGRADED
BLOCKED
UNKNOWN
```

## Testing Requirements

Add deterministic tests for:

- `qe analyze --json` includes telemetry;
- human-readable `qe analyze` includes the AI usage section when applicable;
- no-model-call runs report zero usage or a clear no-usage state;
- missing pricing data does not fail analysis;
- usage is aggregated across multiple fake Model Gateway calls;
- cached tokens are represented when provider usage includes them;
- output token reservation contributes to estimated TPM demand;
- oversized requests are detected before dispatch when limits are known;
- oversized context is reduced, chunked, or summarized before failure;
- intrinsically oversized requests do not rely only on exponential backoff;
- provider-specific details do not leak into core domain types;
- telemetry does not include secrets.

Use fake/scripted Model Gateway implementations for deterministic tests.

## Required Validation

Run:

```text
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
```

Also manually exercise where practical:

```text
qe analyze
qe analyze --json
```

## Completion Report

When done, report:

- files changed;
- telemetry fields added;
- how provider independence was preserved;
- how oversized requests are detected and handled;
- test coverage added;
- validation results;
- intentionally deferred work.
