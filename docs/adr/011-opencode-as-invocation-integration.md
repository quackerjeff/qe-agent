# ADR-011 — OpenCode Harness as an Invocation Integration

**Status:** Accepted

## Context

The QE Agent's core engine is independently usable through its local CLI and
programmatic interfaces. GitHub Actions was integrated in Milestone 7 as one
invocation mechanism, with GitHub-specific behavior confined to
`src/github/`.

OpenCode is an AI coding harness that developers run locally (TUI, IDE
plugins, web clients) and headlessly (`opencode serve`, an HTTP server with an
OpenAPI spec). Teams using OpenCode want QE verdicts available without
leaving their harness: on demand ("verify these requirements"), and pushed
back into the session as first-class messages.

OpenCode provides several integration surfaces:

- project-local configuration (`.opencode/`) with agents, commands, and
  plugins;
- a custom-tools plugin API that can execute arbitrary code;
- an HTTP server API (`POST /session`, `POST /session/:id/message`,
  `POST /session/:id/prompt_async`, `POST /tui/show-toast`).

## Decision

OpenCode SHALL be treated as an invocation mechanism for the QE Agent, not as
part of the QE core architecture — exactly mirroring the GitHub integration
(ADR series, "GitHub Is an Integration"):

1. **Integration module.** OpenCode-specific behavior lives in
   `src/opencode/` alongside `src/github/`, exposing:
   - harness detection (`isOpenCodeHarness`) and environment parsing
     (`parseOpenCodeContext`);
   - verdict-to-urgency mapping (deterministic wording of delivered results);
   - an `OpenCodeClient` interface with `HttpOpenCodeClient` (real
     server); the test double is `StubOpenCodeClient` in
     `tests/helpers/opencode-stubs.ts` (test-only, not shipped);
   - an `OpenCodeReporter` that delivers a redacted, markdown-rendered QE
     verdict into a session and persists it under `.qe/runs/`.

2. **CLI surface.** `qe opencode publish --result <path> [--session <id>]`
   mirrors `qe github publish`: it validates a `QEResult`, redacts known
   secrets, and either delivers to a running OpenCode server or dry-runs.

3. **Harness-side configuration.** A committed `.opencode/` directory ships:
   - `.opencode/agents/qe.md` — a read-only "QE operator" subagent that
     shells out to the QE CLI and reports evidence-backed verdicts without
     modifying application source;
   - `.opencode/commands/qe-analyze.md`, `qe-verify.md`, `qe-review.md` —
     slash commands invoking the QE CLI;
   - `.opencode/plugins/qe-agent.ts` — custom tools (`qe_analyze`,
     `qe_verify`, `qe_review`, `qe_opencode_publish`) that wrap the
     deterministic CLI so harness models invoke real QE execution instead of
     improvising validation.

4. **Delivery is `prompt_async`, never a model assertion.** Results are
   injected into a session via the server API; a delivered message is
   executed/observed evidence about delivery only. The verdict itself always
   originates from the QE Orchestrator's deterministic pipeline.

5. **Explicit targeting.** Delivery requires an explicit session ID
   (`--session` or `QE_OPENCODE_SESSION_ID`); QE never delivers into an
   arbitrary session. `OPENCODE_SERVER_PASSWORD` is treated as a known
   secret and redacted from all outputs and persisted artifacts.

## Alternatives Considered

- **No integration** — leaves OpenCode users without in-harness QE verdicts.
- **Core knowledge of OpenCode** — rejected; violates the harness
  independence principle (hard-coding an agent harness into the QE core).
- **Plugin-only integration (no `src/opencode/`)** — rejected; headless
  `opencode serve` consumers and CI cannot use UI-only surfaces.
- **SDK dependency (`@opencode-ai/sdk`)** — rejected for the MVP per
  dependency discipline; the server endpoints used are stable, few
  (`/session/:id/prompt_async`, `/tui/show-toast`), and a thin HTTP client
  mirrors the existing `HttpGitHubClient` pattern.

## Consequences

- OpenCode users can request QE runs and receive evidence-backed verdicts
  inside their harness sessions.
- The QE core remains harness-independent; `src/opencode/` can be removed
  without affecting the engine, the CLI, or the GitHub integration.
- The committed `.opencode/` files are documentation-plus-configuration for
  the harness; they are not QE product code and follow OpenCode's documented
  file conventions.
- Maintainers must keep `.opencode/` agent permissions read-only for
  application source so the production-source boundary is respected on the
  harness side as well.