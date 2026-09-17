# ADR-012 — Playwright MCP as Browser Fallback Adapter

**Status:** Accepted

**Supersedes:** none — extends [ADR-008](008-playwright-as-initial-browser-adapter.md)

## Context

ADR-008 established Playwright as the initial browser automation adapter,
launched as a local Chromium instance. This fails on servers without a
browser binary installed: `chromium.launch()` throws, browser scenarios
report `ENVIRONMENT_ISSUE`, and verdicts degrade to `BLOCKED` even though
the application under test is reachable.

The Playwright MCP server (`@playwright/mcp`) provides the same browser
automation over the Model Context Protocol, spoken as JSON-RPC over stdio.
AI coding harnesses (including OpenCode) commonly run a Playwright MCP
server, so on harness-hosted environments a browser may be available even
when no local Chromium binary exists.

## Decision

1. The browser capability remains behind the `BrowserCapability`
   interface (ADR-008). A new `McpPlaywrightAdapter` implements it by
   spawning a configured Playwright MCP server as a child process and
   translating QE's deterministic action vocabulary into MCP tool calls.

2. The default adapter is a `CompositeBrowserCapability` that is
   **local-first**: it attempts the local Playwright/Chromium adapter and,
   when the failure is an environment failure (browser binary unavailable),
   retries the scenario once with the MCP adapter. Product failures never
   trigger fallback — a FAIL stays a FAIL.

3. Configuration (`.qe/config.yml`):

   ```yaml
   browser:
     adapter: auto   # auto (default) | local | mcp
     mcpCommand: npx  # optional override
     mcpArgs: ["@playwright/mcp@latest", "--headless"]
   ```

4. The QE Agent never spawns an MCP server unless browser validation is
   actually executed; construction is lazy and the server is cleaned up
   deterministically after the run.

5. Safety properties are preserved regardless of adapter: the same action
   validator, URL policy, secret redaction, budget enforcement, and
   artifact-boundary rules apply. Evidence records the adapter source so
   verdicts remain explainable.

## Alternatives Considered

- **Install Chromium in every environment** — rejected: not possible on
  locked-down servers and expensive in CI.
- **HTTP/SSE transport to a pre-running MCP server** — deferred: requires
  endpoint management; stdio mirrors how harnesses launch Playwright MCP.
- **MCP-only adapter (no local Chromium)** — rejected as default: local
  execution is faster and does not require Node/npx availability for the
  MCP package.

## Consequences

- Browser QE works on hosts without a local browser binary, provided
  Node/npx can launch `@playwright/mcp`.
- Verdict quality is preserved: environment failures fall back
  transparently, and evidence distinguishes which adapter executed.
- MCP tool calls are slightly less expressive than raw Playwright (snapshot
  text rather than strict locators), so selector-heavy assertions may be
  less precise under the fallback; this is an accepted trade-off for
  environments without local browsers.
- The composite retry executes failed scenarios twice in the worst case;
  browser budgets already bound this cost.