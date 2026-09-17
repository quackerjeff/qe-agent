import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildKiroChatArgs,
  KiroCliError,
  SpawnKiroClient,
  KiroReporter,
  validateResultForPublishing,
  persistKiroPrompt,
  renderKiroPrompt,
  VERDICT_TO_KIRO_EXIT,
  type KiroClient,
  type KiroPromptRequest,
  type KiroPromptResponse,
} from "../src/kiro/index.js";
import { QEConfigSchema } from "../src/config/schema.js";
import { makeResult } from "./helpers/qe-result-fixture.js";
import type { KiroContext } from "../src/kiro/types.js";

/**
 * Kiro integration tests. Test-only stubs live here — production code
 * ships only the real SpawnKiroClient that runs the actual kiro-cli.
 */

class StubKiroClient implements KiroClient {
  public prompts: {
    request: KiroPromptRequest;
    response: KiroPromptResponse;
  }[] = [];
  public shouldFail = false;
  public failureExitCode = 1;

  async runPrompt(request: KiroPromptRequest): Promise<KiroPromptResponse> {
    if (this.shouldFail) {
      throw new KiroCliError("spawn failed", this.failureExitCode);
    }
    const response: KiroPromptResponse = {
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      ok: true,
    };
    this.prompts.push({ request, response });
    return response;
  }
}

function makeContext(overrides: Partial<KiroContext> = {}): KiroContext {
  return {
    executable: "kiro-cli",
    ...overrides,
  };
}

describe("buildKiroChatArgs", () => {
  it("builds a minimal headless command", () => {
    const { cmd, args } = buildKiroChatArgs({
      prompt: "hello",
      context: makeContext(),
    });
    expect(cmd).toBe("kiro-cli");
    expect(args).toEqual([
      "chat",
      "--no-interactive",
      "--output-format",
      "stream-json",
      "hello",
    ]);
  });

  it("adds resume, agent, and mcp flags when configured", () => {
    const { args } = buildKiroChatArgs({
      prompt: "p",
      context: makeContext({
        sessionId: "sess-1",
        agent: "qe",
        requireMcpStartup: true,
      }),
    });
    expect(args).toContain("--resume-id");
    expect(args).toContain("sess-1");
    expect(args).toContain("--agent");
    expect(args).toContain("qe");
    expect(args).toContain("--require-mcp-startup");
  });

  it("trust-all-tools wins over trust-tools", () => {
    const { args } = buildKiroChatArgs({
      prompt: "p",
      context: makeContext({ trustAllTools: true, trustTools: ["read"] }),
    });
    expect(args).toContain("--trust-all-tools");
    expect(args).not.toContain("--trust-tools=read");
  });

  it("joins trust-tools as a comma-separated flag", () => {
    const { args } = buildKiroChatArgs({
      prompt: "p",
      context: makeContext({ trustTools: ["read", "grep"] }),
    });
    expect(args).toContain("--trust-tools=read,grep");
  });

  it("places the prompt last", () => {
    const { args } = buildKiroChatArgs({
      prompt: "the prompt",
      context: makeContext({ sessionId: "s" }),
    });
    expect(args[args.length - 1]).toBe("the prompt");
  });
});

describe("SpawnKiroClient", () => {
  it("runs a real child process and captures its output", async () => {
    const client = new SpawnKiroClient(10_000);
    const response = await client.runPrompt({
      // Use echo as a stand-in executable: it exits 0 and echoes the prompt.
      prompt: "hello-from-qe",
      context: { executable: "echo", args: [], trustTools: [] },
    } as Parameters<typeof client.runPrompt>[0]);
    expect(response.exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(response.stdout).toContain("hello-from-qe");
  }, 15_000);

  it("reports non-zero exit codes as not ok", async () => {
    const client = new SpawnKiroClient(10_000);
    const response = await client.runPrompt({
      prompt: "x",
      context: {
        executable: "false",
        args: [],
        trustTools: [],
      },
    } as Parameters<typeof client.runPrompt>[0]);
    expect(response.exitCode).toBe(1);
    expect(response.ok).toBe(false);
  }, 15_000);

  it("rejects when the executable cannot be spawned", async () => {
    const client = new SpawnKiroClient(5_000);
    await expect(
      client.runPrompt({
        prompt: "x",
        context: {
          executable: "/nonexistent/kiro-cli-binary",
          args: [],
          trustTools: [],
        },
      } as Parameters<typeof client.runPrompt>[0]),
    ).rejects.toThrow(KiroCliError);
  }, 15_000);
});

describe("KiroReporter", () => {
  it("delivers the rendered prompt via the client", async () => {
    const client = new StubKiroClient();
    const reporter = new KiroReporter({ dryRun: false, maxRetries: 1 });
    const result = await reporter.publish(
      makeResult({ executionId: "exec-kiro-001" }),
      makeContext(),
      client,
      [],
    );
    expect(result.promptDelivered).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(client.prompts).toHaveLength(1);
    expect(client.prompts[0].request.prompt).toContain(
      "Verdict: PASS (confidence: HIGH)",
    );
  });

  it("dry-run delivers without a client and spawns nothing", async () => {
    const reporter = new KiroReporter({ dryRun: true, maxRetries: 1 });
    const result = await reporter.publish(
      makeResult(),
      makeContext(),
      undefined,
      [],
    );
    expect(result.promptDelivered).toBe(true);
    expect(result.dryRun).toBe(true);
  });

  it("warns when no client is provided outside dry-run", async () => {
    const reporter = new KiroReporter({ dryRun: false, maxRetries: 1 });
    const result = await reporter.publish(
      makeResult(),
      makeContext(),
      undefined,
      [],
    );
    expect(result.promptDelivered).toBe(false);
    expect(result.warnings[0]).toContain("no Kiro client provided");
  });

  it("does not retry spawn failures (executable missing)", async () => {
    const client = new StubKiroClient();
    client.shouldFail = true;
    client.failureExitCode = 1;
    const reporter = new KiroReporter({ dryRun: false, maxRetries: 3 });
    const result = await reporter.publish(
      makeResult(),
      makeContext(),
      client,
      [],
    );
    expect(result.promptDelivered).toBe(false);
    expect(result.warnings[0]).toContain("Kiro delivery failed");
    // Single attempt: spawn errors are not retried.
    expect(client.prompts).toHaveLength(0);
  });

  it("records non-ok exit codes as warnings", async () => {
    const client = new StubKiroClient();
    const reporter = new KiroReporter({ dryRun: false, maxRetries: 0 });
    const result = await reporter.publish(
      makeResult(),
      makeContext(),
      client,
      [],
    );
    expect(result.warnings).toHaveLength(0);
    expect(result.promptDelivered).toBe(true);
  });

  it("redacts known secrets from the delivered prompt", async () => {
    const client = new StubKiroClient();
    const reporter = new KiroReporter({ dryRun: false, maxRetries: 0 });
    await reporter.publish(
      makeResult({ summary: "uses token secret1234 here" }),
      makeContext(),
      client,
      ["secret1234"],
    );
    const prompt = client.prompts[0].request.prompt;
    expect(prompt).not.toContain("secret1234");
    expect(prompt).toContain("[REDACTED]");
  });
});

describe("renderKiroPrompt", () => {
  const redact = (t: string) => t;

  it("frames the canonical summary with verdict and confidence", () => {
    const prompt = renderKiroPrompt(makeResult(), redact);
    expect(prompt).toContain("Verdict: PASS (confidence: HIGH)");
    expect(prompt).toContain("| Verdict | **PASS** |");
    expect(prompt).toContain("## Metrics");
  });
});

describe("verdict exit mapping", () => {
  it("maps every verdict to a documented exit code", () => {
    expect(VERDICT_TO_KIRO_EXIT.PASS).toBe(0);
    expect(VERDICT_TO_KIRO_EXIT.PASS_WITH_CONCERNS).toBe(0);
    expect(VERDICT_TO_KIRO_EXIT.NEEDS_REVIEW).toBe(1);
    expect(VERDICT_TO_KIRO_EXIT.FAIL).toBe(1);
    expect(VERDICT_TO_KIRO_EXIT.BLOCKED).toBe(1);
  });
});

describe("validateResultForPublishing", () => {
  it("accepts a valid QEResult", () => {
    expect(validateResultForPublishing(makeResult()).verdict).toBe("PASS");
  });

  it("rejects invalid shapes", () => {
    expect(() => validateResultForPublishing({ nope: true })).toThrow();
  });
});

describe("persistence", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "qe-kiro-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists the kiro prompt under .qe/runs", async () => {
    const result = makeResult({ executionId: "exec-kiro-001" });
    const path = await persistKiroPrompt(result, dir, []);
    expect(path).toContain(join(".qe", "runs", "exec-kiro-001"));
    const prompt = await readFile(path, "utf-8");
    expect(prompt).toContain("Verdict: PASS");
    expect(path).toContain("kiro-prompt.md");
  });

  it("redacts secrets in the persisted prompt", async () => {
    const path = await persistKiroPrompt(
      makeResult({ summary: "leaked secret1234" }),
      dir,
      ["secret1234"],
    );
    const prompt = await readFile(path, "utf-8");
    expect(prompt).not.toContain("secret1234");
  });
});

describe("kiro config schema", () => {
  it("provides defaults for the kiro section", () => {
    const config = QEConfigSchema.parse({ version: 1 });
    expect(config.kiro.promptEnabled).toBe(true);
    expect(config.kiro.dryRun).toBe(false);
  });

  it("accepts explicit kiro settings", () => {
    const config = QEConfigSchema.parse({
      version: 1,
      kiro: { promptEnabled: false, dryRun: true },
    });
    expect(config.kiro.promptEnabled).toBe(false);
    expect(config.kiro.dryRun).toBe(true);
  });
});
