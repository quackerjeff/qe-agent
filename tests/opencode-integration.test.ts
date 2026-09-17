import { describe, it, expect } from "vitest";
import {
  OpenCodeContextSchema,
  VERDICT_TO_URGENCY,
  FakeOpenCodeClient,
  OpenCodeApiError,
  HttpOpenCodeClient,
  parseOpenCodeContext,
  FakeEnvironmentSource,
  isOpenCodeHarness,
  getOpenCodeServerPassword,
  mapVerdictToUrgency,
  shouldFailHarness,
  getHarnessExitCode,
  renderSessionMessage,
  OpenCodeReporter,
  validateResultForPublishing,
  persistResult,
  persistSessionMessage,
  type OpenCodeContext,
  type OpenCodeReporterConfig,
  type HttpRequestFn,
} from "../src/opencode/index.js";
import { QEConfigSchema } from "../src/config/schema.js";
import type { QEResult, Finding } from "../src/types/index.js";
import type { Verdict } from "../src/types/domain.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Test Helpers ---

function makeContext(
  overrides: Partial<OpenCodeContext> = {},
): OpenCodeContext {
  return {
    serverUrl: "http://127.0.0.1:4096",
    sessionId: "sess-123",
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    category: "DEFECT",
    severity: "HIGH",
    confidence: 0.9,
    title: "Null pointer in handler",
    description: "The handler does not check for null input",
    evidenceIds: ["ev-1"],
    affectedFiles: ["src/handler.ts"],
    ...overrides,
  };
}

function makeResult(overrides: Partial<QEResult> = {}): QEResult {
  return {
    executionId: "exec-oc-001",
    repository: { path: "/repo", name: "test-repo" },
    target: "abc123",
    profile: "standard",
    repositoryProfile: {
      root: "/repo",
      git: { detected: true },
      languages: [],
      frameworks: [],
      packageManagers: [],
      buildSystems: [],
      testFrameworks: [],
      ciSystems: [],
      applications: [],
      documentation: [],
      commands: [],
      capabilities: [],
      confidence: 0.9,
    },
    riskAssessment: {
      level: "MEDIUM",
      factors: [],
      confidence: 0.8,
      summary: "Medium risk change",
    },
    validationPlan: {
      objectives: [{ id: "obj-1", description: "Validate change" }],
      plannedActions: [],
      identifiedRisks: [],
      expectedCapabilities: [],
    },
    evidence: [
      {
        id: "ev-1",
        type: "TEST_RESULT",
        provenance: "executed",
        timestamp: new Date().toISOString(),
        source: "vitest",
        status: "PASS",
        summary: "All tests passed",
      },
    ],
    findings: [],
    requirements: [],
    remainingGaps: [],
    verdict: "PASS",
    confidence: "HIGH",
    summary: "All validations passed",
    recommendedNextActions: [],
    metrics: {
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 5000,
      modelCalls: 4,
      commandsExecuted: 3,
      testsExecuted: 10,
      testsGenerated: 0,
      retries: 0,
      stateTransitions: 8,
    },
    ...overrides,
  };
}

function makeDefaultReporterConfig(
  overrides: Partial<OpenCodeReporterConfig> = {},
): OpenCodeReporterConfig {
  return {
    toastEnabled: true,
    dryRun: false,
    maxRetries: 2,
    ...overrides,
  };
}

// ============================================================
// UNIT TESTS
// ============================================================

describe("OpenCodeContext parsing", () => {
  it("parses complete environment", () => {
    const env = new FakeEnvironmentSource({
      QE_OPENCODE_SESSION_ID: "sess-abc",
      OPENCODE_SERVER_URL: "http://localhost:9999",
      OPENCODE_SERVER_USERNAME: "user",
      OPENCODE_SERVER_PASSWORD: "pw",
    });
    const ctx = parseOpenCodeContext(env);
    expect(ctx).not.toBeNull();
    expect(ctx!.sessionId).toBe("sess-abc");
    expect(ctx!.serverUrl).toBe("http://localhost:9999");
    expect(ctx!.username).toBe("user");
    expect(ctx!.password).toBe("pw");
  });

  it("returns null without a session ID", () => {
    const env = new FakeEnvironmentSource({
      OPENCODE_SERVER_URL: "http://localhost:4096",
    });
    expect(parseOpenCodeContext(env)).toBeNull();
  });

  it("applies default server URL when unset", () => {
    const env = new FakeEnvironmentSource({
      QE_OPENCODE_SESSION_ID: "sess-1",
    });
    const ctx = parseOpenCodeContext(env);
    expect(ctx!.serverUrl).toBe("http://127.0.0.1:4096");
  });

  it("rejects invalid server URLs", () => {
    const env = new FakeEnvironmentSource({
      QE_OPENCODE_SESSION_ID: "sess-1",
      OPENCODE_SERVER_URL: "not-a-url",
    });
    expect(parseOpenCodeContext(env)).toBeNull();
  });

  it("parses optional session title", () => {
    const env = new FakeEnvironmentSource({
      QE_OPENCODE_SESSION_ID: "sess-1",
      QE_OPENCODE_SESSION_TITLE: "QE run",
    });
    const ctx = parseOpenCodeContext(env);
    expect(ctx!.sessionTitle).toBe("QE run");
  });
});

describe("isOpenCodeHarness detection", () => {
  it("detects server URL", () => {
    expect(
      isOpenCodeHarness(
        new FakeEnvironmentSource({ OPENCODE_SERVER_URL: "http://x:1" }),
      ),
    ).toBe(true);
  });

  it("detects OPENCODE_BIN", () => {
    expect(
      isOpenCodeHarness(new FakeEnvironmentSource({ OPENCODE_BIN: "/bin/oc" })),
    ).toBe(true);
  });

  it("returns false outside the harness", () => {
    expect(isOpenCodeHarness(new FakeEnvironmentSource({}))).toBe(false);
  });
});

describe("getOpenCodeServerPassword", () => {
  it("reads password from environment", () => {
    expect(
      getOpenCodeServerPassword(
        new FakeEnvironmentSource({ OPENCODE_SERVER_PASSWORD: "secret" }),
      ),
    ).toBe("secret");
  });

  it("returns undefined when unset", () => {
    expect(
      getOpenCodeServerPassword(new FakeEnvironmentSource({})),
    ).toBeUndefined();
  });
});

describe("verdict mapping", () => {
  it("maps every verdict to an urgency", () => {
    const verdicts: Verdict[] = [
      "PASS",
      "PASS_WITH_CONCERNS",
      "NEEDS_REVIEW",
      "FAIL",
      "BLOCKED",
    ];
    for (const v of verdicts) {
      expect(VERDICT_TO_URGENCY[v]).toBeDefined();
      expect(mapVerdictToUrgency(v)).toBe(VERDICT_TO_URGENCY[v]);
    }
  });

  it("maps positive verdicts to normal", () => {
    expect(mapVerdictToUrgency("PASS")).toBe("normal");
  });

  it("maps concerns and review to warning", () => {
    expect(mapVerdictToUrgency("PASS_WITH_CONCERNS")).toBe("warning");
    expect(mapVerdictToUrgency("NEEDS_REVIEW")).toBe("warning");
  });

  it("maps failures to error", () => {
    expect(mapVerdictToUrgency("FAIL")).toBe("error");
    expect(mapVerdictToUrgency("BLOCKED")).toBe("error");
  });

  it("computes harness exit codes from failOn set", () => {
    const failOn: Verdict[] = ["FAIL", "BLOCKED"];
    expect(getHarnessExitCode("PASS", failOn)).toBe(0);
    expect(getHarnessExitCode("FAIL", failOn)).toBe(1);
    expect(getHarnessExitCode("BLOCKED", failOn)).toBe(1);
    expect(shouldFailHarness("NEEDS_REVIEW", failOn)).toBe(false);
  });
});

describe("renderSessionMessage", () => {
  const redact = (t: string) => t;

  it("renders verdict and core fields", () => {
    const msg = renderSessionMessage(makeResult(), redact);
    expect(msg).toContain("# QE Agent Verdict — PASS");
    expect(msg).toContain("**PASS**");
    expect(msg).toContain("All validations passed");
    expect(msg).toContain("## Validations Executed");
    expect(msg).toContain("## Metrics");
  });

  it("renders findings section when findings exist", () => {
    const msg = renderSessionMessage(
      makeResult({
        findings: [makeFinding()],
        verdict: "FAIL",
      }),
      redact,
    );
    expect(msg).toContain("# QE Agent Verdict — FAIL");
    expect(msg).toContain("## Findings");
    expect(msg).toContain("Null pointer in handler");
  });

  it("renders remaining gaps when present", () => {
    const msg = renderSessionMessage(
      makeResult({
        remainingGaps: [
          {
            area: "auth",
            description: "No auth coverage",
            risk: "HIGH",
            recommendation: "Add login tests",
          },
        ],
      }),
      redact,
    );
    expect(msg).toContain("## Remaining Gaps");
    expect(msg).toContain("No auth coverage");
  });

  it("omits evidence header when no evidence exists", () => {
    const msg = renderSessionMessage(makeResult({ evidence: [] }), redact);
    expect(msg).not.toContain("## Validations Executed");
  });

  it("applies secret redaction", () => {
    const msg = renderSessionMessage(
      makeResult({ summary: "key sk-supersecret used" }),
      (t) => t.replace("sk-supersecret", "***"),
    );
    expect(msg).toContain("***");
    expect(msg).not.toContain("sk-supersecret");
  });
});

describe("OpenCodeReporter", () => {
  it("delivers message to session", async () => {
    const client = new FakeOpenCodeClient();
    const reporter = new OpenCodeReporter(
      client,
      makeDefaultReporterConfig({ toastEnabled: false }),
    );
    const result = await reporter.publish(makeResult(), makeContext(), []);
    expect(result.messageDelivered).toBe(true);
    expect(result.sessionId).toBe("sess-123");
    expect(result.warnings).toHaveLength(0);
    expect(client.messages).toHaveLength(1);
    expect(client.messages[0].request.text).toContain(
      "QE Agent Verdict — PASS",
    );
  });

  it("does not send in dry-run mode", async () => {
    const client = new FakeOpenCodeClient();
    const reporter = new OpenCodeReporter(
      client,
      makeDefaultReporterConfig({ dryRun: true, toastEnabled: true }),
    );
    const result = await reporter.publish(makeResult(), makeContext(), []);
    expect(result.messageDelivered).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.messageId).toBe("(dry-run)");
    expect(client.messages).toHaveLength(0);
    expect(client.toasts).toHaveLength(0);
  });

  it("sends toast on failure verdicts when enabled", async () => {
    const client = new FakeOpenCodeClient();
    const reporter = new OpenCodeReporter(
      client,
      makeDefaultReporterConfig({ toastEnabled: true }),
    );
    await reporter.publish(
      makeResult({ verdict: "FAIL", confidence: "HIGH" }),
      makeContext(),
      [],
    );
    expect(client.toasts).toHaveLength(1);
    expect(client.toasts[0].variant).toBe("error");
    expect(client.toasts[0].message).toContain("FAIL");
  });

  it("sends success toast for PASS verdicts", async () => {
    const client = new FakeOpenCodeClient();
    const reporter = new OpenCodeReporter(
      client,
      makeDefaultReporterConfig({ toastEnabled: true }),
    );
    await reporter.publish(makeResult(), makeContext(), []);
    expect(client.toasts).toHaveLength(1);
    expect(client.toasts[0].variant).toBe("success");
  });

  it("records warning and continues when message delivery fails", async () => {
    const client = new FakeOpenCodeClient();
    client.shouldFailMessage = true;
    const reporter = new OpenCodeReporter(
      client,
      makeDefaultReporterConfig({ toastEnabled: false }),
    );
    const result = await reporter.publish(makeResult(), makeContext(), []);
    expect(result.messageDelivered).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Message delivery failed");
  });

  it("does not retry client errors (only server errors)", async () => {
    const client = new FakeOpenCodeClient();
    client.shouldFailMessage = true;
    client.failureError = new OpenCodeApiError("bad request", 400, false);
    const reporter = new OpenCodeReporter(
      client,
      makeDefaultReporterConfig({ toastEnabled: false }),
    );
    await reporter.publish(makeResult(), makeContext(), []);
    // One attempt, no retries for non-server errors
    expect(client.sendAttempts).toBe(1);
  });

  it("retries server errors up to maxRetries", async () => {
    const client = new FakeOpenCodeClient();
    client.shouldFailMessage = true;
    client.failureError = new OpenCodeApiError("server boom", 500, true);
    const reporter = new OpenCodeReporter(
      client,
      makeDefaultReporterConfig({ toastEnabled: false, maxRetries: 2 }),
    );
    await reporter.publish(makeResult(), makeContext(), []);
    // Initial attempt + 2 retries = 3
    expect(client.sendAttempts).toBe(3);
  });

  it("redacts known secrets from delivered message", async () => {
    const client = new FakeOpenCodeClient();
    const reporter = new OpenCodeReporter(
      client,
      makeDefaultReporterConfig({ toastEnabled: false }),
    );
    await reporter.publish(
      makeResult({ summary: "used token secret1234 here" }),
      makeContext(),
      ["secret1234"],
    );
    const text = client.messages[0].request.text;
    expect(text).not.toContain("secret1234");
    expect(text).toContain("***");
  });

  it("records toast failure as warning", async () => {
    const client = new FakeOpenCodeClient();
    const originalShowToast = client.showToast.bind(client);
    client.showToast = async () => {
      throw new Error("toast unavailable");
    };
    const reporter = new OpenCodeReporter(
      client,
      makeDefaultReporterConfig({ toastEnabled: true }),
    );
    const result = await reporter.publish(makeResult(), makeContext(), []);
    expect(result.messageDelivered).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Toast notification failed");
    client.showToast = originalShowToast;
  });
});

describe("OpenCodeContextSchema", () => {
  it("validates a minimal context", () => {
    const result = OpenCodeContextSchema.safeParse({ sessionId: "s1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serverUrl).toBe("http://127.0.0.1:4096");
    }
  });

  it("rejects missing session ID", () => {
    expect(
      OpenCodeContextSchema.safeParse({ serverUrl: "http://x:1" }).success,
    ).toBe(false);
  });
});

describe("FakeOpenCodeClient", () => {
  it("creates sessions with incrementing IDs", async () => {
    const client = new FakeOpenCodeClient();
    const s1 = await client.createSession("QE run");
    const s2 = await client.createSession();
    expect(s1.sessionId).not.toBe(s2.sessionId);
    expect(s1.title).toBe("QE run");
    expect(client.sessionCreations).toHaveLength(2);
  });

  it("records sent messages", async () => {
    const client = new FakeOpenCodeClient();
    await client.sendMessage({ sessionId: "s1", text: "hello" });
    expect(client.messages).toHaveLength(1);
    expect(client.messages[0].request.text).toBe("hello");
    expect(client.messages[0].response.delivered).toBe(true);
  });
});

describe("HttpOpenCodeClient", () => {
  it("sends message via prompt_async", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fetchFn: HttpRequestFn = async (url, options) => {
      seen.push({ url, body: JSON.parse(options.body ?? "{}") });
      return { status: 204, json: async () => ({}) };
    };
    const client = new HttpOpenCodeClient(
      "http://127.0.0.1:4096",
      { username: "u", password: "p" },
      fetchFn,
    );
    const res = await client.sendMessage({
      sessionId: "sess-1",
      text: "verdict",
    });
    expect(res.delivered).toBe(true);
    expect(seen[0].url).toContain("/session/sess-1/prompt_async");
    const body = seen[0].body as { parts: { type: string; text: string }[] };
    expect(body.parts[0].text).toBe("verdict");
  });

  it("creates session via POST /session", async () => {
    const seen: { url: string; method: string }[] = [];
    const fetchFn: HttpRequestFn = async (url, options) => {
      seen.push({ url, method: options.method });
      return { status: 200, json: async () => ({ id: "sess-9" }) };
    };
    const client = new HttpOpenCodeClient(
      "http://127.0.0.1:4096",
      undefined,
      fetchFn,
    );
    const res = await client.createSession("QE run");
    expect(res.sessionId).toBe("sess-9");
    expect(seen[0].url).toContain("/session");
  });

  it("throws OpenCodeApiError on non-2xx", async () => {
    const fetchFn: HttpRequestFn = async () => ({
      status: 500,
      json: async () => ({ error: "boom" }),
    });
    const client = new HttpOpenCodeClient(
      "http://127.0.0.1:4096",
      undefined,
      fetchFn,
    );
    await expect(
      client.sendMessage({ sessionId: "s", text: "t" }),
    ).rejects.toThrow(OpenCodeApiError);
  });

  it("applies basic auth header when password is set", async () => {
    let authHeader: string | undefined;
    const fetchFn: HttpRequestFn = async (_url, options) => {
      authHeader = options.headers.Authorization;
      return { status: 204, json: async () => ({}) };
    };
    const client = new HttpOpenCodeClient(
      "http://127.0.0.1:4096",
      { username: "qe", password: "pw" },
      fetchFn,
    );
    await client.sendMessage({ sessionId: "s", text: "t" });
    expect(authHeader).toMatch(/^Basic /);
  });
});

describe("validateResultForPublishing", () => {
  it("accepts a valid QEResult", () => {
    const result = validateResultForPublishing(makeResult());
    expect(result.verdict).toBe("PASS");
  });

  it("rejects invalid result shapes", () => {
    expect(() => validateResultForPublishing({ not: "a result" })).toThrow();
  });
});

describe("persistence", () => {
  it("persists result and session message under .qe/runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qe-oc-"));
    try {
      const result = makeResult();
      const resultPath = await persistResult(result, dir);
      const messagePath = await persistSessionMessage(result, dir, []);
      const persisted = JSON.parse(await readFile(resultPath, "utf-8"));
      expect(persisted.executionId).toBe("exec-oc-001");
      const message = await readFile(messagePath, "utf-8");
      expect(message).toContain("QE Agent Verdict — PASS");
      expect(resultPath).toContain(join(".qe", "runs", "exec-oc-001"));
      expect(messagePath).toContain("opencode-message.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("redacts secrets in persisted session message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qe-oc-"));
    try {
      const messagePath = await persistSessionMessage(
        makeResult({ summary: "leaked secret1234 value" }),
        dir,
        ["secret1234"],
      );
      const message = await readFile(messagePath, "utf-8");
      expect(message).not.toContain("secret1234");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("opencode config schema", () => {
  it("provides defaults for the opencode section", () => {
    const config = QEConfigSchema.parse({ version: 1 });
    expect(config.opencode.messageEnabled).toBe(true);
    expect(config.opencode.toastEnabled).toBe(true);
    expect(config.opencode.dryRun).toBe(false);
  });

  it("accepts explicit opencode settings", () => {
    const config = QEConfigSchema.parse({
      version: 1,
      opencode: { toastEnabled: false, dryRun: true },
    });
    expect(config.opencode.toastEnabled).toBe(false);
    expect(config.opencode.dryRun).toBe(true);
  });

  it("preserves existing github section", () => {
    const config = QEConfigSchema.parse({ version: 1 });
    expect(config.github.checks.enabled).toBe(true);
  });
});
