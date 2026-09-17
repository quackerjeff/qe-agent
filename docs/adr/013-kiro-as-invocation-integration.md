# ADR-013 — Kiro Harness as an Invocation Integration

**Status:** Accepted

## Context

The QE Agent's core engine is independently usable through its local CLI
and programmatic interfaces. GitHub Actions (Milestone 7) and OpenCode
(ADR-011) are integrated invocation mechanisms, with integration-specific
behavior confined to `src/github/` and `src/opencode/`.

Amazon Kiro (CLI and IDE) is an agentic harness with no server API to push
results into. Its integration surfaces are: headless CLI runs
(`kiro-cli chat --no-interactive [--trust-all-tools|--trust-tools]
[--resume-id] [--agent]`), custom agents (`.kiro/agents/*.md` with YAML
frontmatter), event hooks (`.kiro/hooks/*.json`, v1 schema), steering
files (`.kiro/steering/*.md`), and skills (`.kiro/skills/<name>/SKILL.md`).
Kiro hooks communicate via exit codes (0 = stdout added to context,
2 = block, other = warning) and documented CLI exit codes are 0/1/3.

## Decision

Kiro SHALL be treated as an invocation mechanism, mirroring the GitHub
and OpenCode integrations:

1. **Integration module.** Kiro-specific behavior lives in `src/kiro/`:
   - `KiroContext` describing a headless run; `buildKiroChatArgs` a pure
     function constructing the documented CLI flags;
   - `SpawnKiroClient` — the real client, spawning the actual `kiro-cli`
     as a child process with timeout handling and exit-code semantics
     (0/1/3; exit 3 = MCP startup failure is a completed delivery);
   - `KiroReporter` rendering the canonical QE summary into a prompt and
     delivering it; persistence under `.qe/runs/<id>/kiro-prompt.md`.
     Production code contains no test doubles — stubs live in tests.

2. **CLI surface.** `qe kiro publish --result <path> [--session <id>]
   [--agent <name>] [--trust-all-tools] [--dry-run]`. Delivery defaults to
   read-only trust (`--trust-tools=read,grep,fs_read`) so the Kiro agent
   can interpret but not modify; `--trust-all-tools` (or
   `kiro.trustAllTools` in `.qe/config.yml`) lets Kiro act on the verdict.
   Dry-run spawns no process.

3. **Harness-side configuration.** A committed `.kiro/` directory ships:
   - `.kiro/agents/qe.md` — a "QE operator" agent with shell allowlists
     scoped to the QE CLI and build/test commands, writes denied;
   - `.kiro/steering/qe-integration.md` — always-included steering;
   - `.kiro/hooks/qe-agent.json` — a PreToolUse reminder enforcing the
     production-source boundary (enabled) and an optional Stop-trigger
     QE review (disabled by default);
   - `.kiro/skills/qe-verify/SKILL.md` — a QE verification skill exposed
     as `/qe-verify`.

4. **Delivery is prompt injection, not assertion.** The verdict always
   originates from the QE Orchestrator's deterministic pipeline; the
   Kiro agent receives it as context. `VERDICT_TO_KIRO_EXIT` maps
   verdicts to documented CLI exit codes for scripting.

## Alternatives Considered

- **Kiro Web/Cloud APIs** — rejected for MVP: headless CLI is the
  documented automation surface and requires no additional credentials
  beyond the user's existing Kiro auth.
- **Hooks-only integration** — rejected as sole mechanism: hooks fire on
  Kiro events, not on QE completion, so they complement rather than
  replace explicit delivery.
- **SDK dependency** — none exists for Kiro's headless mode; the CLI is
  the interface.

## Consequences

- Kiro users receive evidence-backed QE verdicts in-session, and with
  `trustAllTools` the Kiro agent can act on findings.
- The QE core remains harness-independent; `src/kiro/` can be removed
  without affecting the engine.
- Read-only default trust keeps delivery safe; opting into full trust is
  an explicit user decision recorded in config.
- Hook-based QE review is disabled by default because it consumes Kiro
  credits per agent loop (documented Kiro behavior).