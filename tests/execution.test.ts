import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  ExecutionController,
  LocalExecutor,
  DockerExecutor,
  evaluatePolicy,
  redactSecrets,
  createExecutionEvidence,
  InMemoryEvidenceStore,
  BoundedBuffer,
  computeContainerWorkdir,
} from "../src/execution/index.js";
import type {
  CommandProposal,
  ExecutionContext,
} from "../src/execution/index.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const SCRIPTS = resolve(PROJECT_ROOT, "fixtures", "exec-scripts");

function makeProposal(overrides?: Partial<CommandProposal>): CommandProposal {
  return {
    executable: "/bin/sh",
    args: [resolve(SCRIPTS, "success.sh")],
    workingDirectory: PROJECT_ROOT,
    timeoutMs: 10_000,
    purpose: "test",
    mutability: "READ_ONLY",
    network: "NONE",
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    repositoryRoot: PROJECT_ROOT,
    executionMode: "local",
    secrets: [],
    maxOutputBytes: 1_048_576,
    ...overrides,
  };
}

// --- Local Executor Tests (Section 26) ---

describe("Local Executor", () => {
  const executor = new LocalExecutor();

  it("executes a successful command", async () => {
    const result = await executor.execute(makeProposal(), makeContext());
    expect(result.exitCode).toBe(0);
    expect(result.terminationReason).toBe("COMPLETED");
    expect(result.stdout).toContain("hello from success");
    expect(result.executor).toBe("local");
    expect(result.executionId).toBeTruthy();
  });

  it("captures non-zero exit code", async () => {
    const result = await executor.execute(
      makeProposal({ args: [resolve(SCRIPTS, "fail.sh")] }),
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.terminationReason).toBe("COMPLETED");
  });

  it("captures stdout separately", async () => {
    const result = await executor.execute(
      makeProposal({ args: [resolve(SCRIPTS, "both-streams.sh")] }),
      makeContext(),
    );
    expect(result.stdout).toContain("stdout line");
    expect(result.stdout).not.toContain("stderr line");
  });

  it("captures stderr separately", async () => {
    const result = await executor.execute(
      makeProposal({ args: [resolve(SCRIPTS, "both-streams.sh")] }),
      makeContext(),
    );
    expect(result.stderr).toContain("stderr line");
    expect(result.stderr).not.toContain("stdout line");
  });

  it("enforces timeout", async () => {
    const result = await executor.execute(
      makeProposal({
        args: [resolve(SCRIPTS, "slow.sh")],
        timeoutMs: 1000,
      }),
      makeContext(),
    );
    expect(result.timedOut).toBe(true);
    expect(result.terminationReason).toBe("TIMED_OUT");
    expect(result.durationMs).toBeGreaterThanOrEqual(800);
  }, 15_000);

  it("enforces working-directory by policy before execution", async () => {
    const controller = new ExecutionController();
    const { result } = await controller.execute(
      makeProposal({ workingDirectory: "/tmp" }),
      makeContext(),
    );
    expect(result.terminationReason).toBe("POLICY_DENIED");
  });

  it("filters environment variables", async () => {
    const result = await executor.execute(
      makeProposal({
        executable: "/usr/bin/env",
        args: [],
      }),
      makeContext(),
    );
    expect(result.stdout).not.toContain("npm_");
  });

  it("redacts secrets from output", async () => {
    const secretVal = "super-secret-42";
    const result = await executor.execute(
      makeProposal({
        args: [resolve(SCRIPTS, "echo-secret.sh")],
        environment: { SECRET_TOKEN: secretVal },
      }),
      makeContext({ secrets: [secretVal] }),
    );
    expect(result.stdout).not.toContain(secretVal);
    expect(result.stderr).not.toContain(secretVal);
    expect(result.stdout).toContain("[REDACTED]");
    expect(result.secretsRedacted).toBe(true);
  });

  it("truncates large output via bounded streaming", async () => {
    const result = await executor.execute(
      makeProposal({ args: [resolve(SCRIPTS, "big-output.sh")] }),
      makeContext({ maxOutputBytes: 1024 }),
    );
    expect(result.truncated.stdout).toBe(true);
    expect(result.stdout).toContain("OUTPUT TRUNCATED");
  });

  it("reports spawn failure for nonexistent executable", async () => {
    const result = await executor.execute(
      makeProposal({ executable: "/nonexistent/binary" }),
      makeContext(),
    );
    expect(result.terminationReason).toBe("SPAWN_FAILED");
    expect(result.exitCode).toBeNull();
  });
});

// --- Docker Executor Tests (Section 27) ---

describe("Docker Executor", () => {
  const executor = new DockerExecutor();

  it("reports availability", async () => {
    const available = await executor.available();
    expect(typeof available).toBe("boolean");
  });

  it("produces evidence when Docker is unavailable", async () => {
    const controller = new ExecutionController();
    const ctx = makeContext({ executionMode: "docker" });

    const dockerAvailable = await executor.available();
    if (!dockerAvailable) {
      const { result, evidence } = await controller.execute(
        makeProposal(),
        ctx,
      );
      expect(result.terminationReason).toBe("SPAWN_FAILED");
      expect(result.executor).toBe("docker");
      expect(result.stderr).toContain("Docker");
      expect(evidence.status).toBe("INCONCLUSIVE");
    }
  });
});

// --- Policy Tests (Section 28) ---

describe("Command Policy", () => {
  it("allows normal commands within repository", () => {
    const result = evaluatePolicy(makeProposal(), PROJECT_ROOT);
    expect(result.outcome).toBe("ALLOWED");
  });

  it("denies working directory outside repository", () => {
    const result = evaluatePolicy(
      makeProposal({ workingDirectory: "/tmp" }),
      PROJECT_ROOT,
    );
    expect(result.outcome).toBe("DENIED");
    expect(result.reason).toContain("outside repository root");
  });

  it("denies dangerous executables", () => {
    const result = evaluatePolicy(
      makeProposal({ executable: "rm", args: ["-rf", "/"] }),
      PROJECT_ROOT,
    );
    expect(result.outcome).toBe("DENIED");
    expect(result.reason).toContain("dangerous");
  });

  it("denies excessive timeout", () => {
    const result = evaluatePolicy(
      makeProposal({ timeoutMs: 999_999_999 }),
      PROJECT_ROOT,
    );
    expect(result.outcome).toBe("DENIED");
    expect(result.reason).toContain("exceeds maximum");
  });

  it("denies empty executable", () => {
    const result = evaluatePolicy(
      { ...makeProposal(), executable: "" },
      PROJECT_ROOT,
    );
    expect(result.outcome).toBe("DENIED");
  });

  it("denies destructive git operations", () => {
    const result = evaluatePolicy(
      makeProposal({ executable: "git", args: ["push", "--force"] }),
      PROJECT_ROOT,
    );
    expect(result.outcome).toBe("DENIED");
    expect(result.reason).toContain("git");
  });

  it("requires approval for write+network", () => {
    const result = evaluatePolicy(
      makeProposal({ mutability: "REPOSITORY_WRITE", network: "ALLOWED" }),
      PROJECT_ROOT,
    );
    expect(result.outcome).toBe("REQUIRES_APPROVAL");
  });
});

// --- Secret Redactor Tests ---

describe("Secret Redactor", () => {
  it("redacts known secret values", () => {
    expect(redactSecrets("token=abc123", ["abc123"])).toBe("token=[REDACTED]");
  });

  it("redacts multiple occurrences", () => {
    expect(redactSecrets("a=secret b=secret", ["secret"])).toBe(
      "a=[REDACTED] b=[REDACTED]",
    );
  });

  it("handles multiple different secrets", () => {
    const result = redactSecrets("key1=aaa key2=bbb", ["aaa", "bbb"]);
    expect(result).toBe("key1=[REDACTED] key2=[REDACTED]");
  });

  it("ignores empty secrets", () => {
    expect(redactSecrets("hello", [""])).toBe("hello");
  });
});

// --- Evidence Tests (Section 29) ---

describe("Evidence from Execution", () => {
  it("creates evidence for every execution", async () => {
    const controller = new ExecutionController();
    await controller.execute(makeProposal(), makeContext());
    const evidence = await controller.getEvidenceStore().list();
    expect(evidence.length).toBe(1);
  });

  it("evidence includes provenance", async () => {
    const controller = new ExecutionController();
    const { evidence } = await controller.execute(
      makeProposal(),
      makeContext(),
    );
    expect(evidence.provenance).toBe("executed");
    expect(evidence.timestamp).toBeTruthy();
    expect(evidence.source).toContain("local");
    expect(evidence.details).toBeDefined();
    const details = evidence.details as Record<string, unknown>;
    expect(details.executable).toBe("/bin/sh");
    expect(details.executor).toBe("local");
    expect(details.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("evidence is immutable — rejects duplicate IDs", async () => {
    const store = new InMemoryEvidenceStore();
    const evidence = {
      id: "ev-test-1",
      type: "COMMAND_RESULT" as const,
      provenance: "executed" as const,
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED" as const,
      summary: "test",
    };
    await store.add(evidence);
    await expect(store.add(evidence)).rejects.toThrow("immutable");
  });

  it("redacted output reaches evidence", async () => {
    const secretVal = "my-api-key-xyz";
    const controller = new ExecutionController();
    const { evidence } = await controller.execute(
      makeProposal({
        args: [resolve(SCRIPTS, "echo-secret.sh")],
        environment: { SECRET_TOKEN: secretVal },
      }),
      makeContext({ secrets: [secretVal] }),
    );
    expect(JSON.stringify(evidence)).not.toContain(secretVal);
  });

  it("timeout creates inconclusive evidence", async () => {
    const controller = new ExecutionController();
    const { evidence } = await controller.execute(
      makeProposal({
        args: [resolve(SCRIPTS, "slow.sh")],
        timeoutMs: 1000,
      }),
      makeContext(),
    );
    expect(evidence.status).toBe("INCONCLUSIVE");
  }, 15_000);

  it("exit code 0 generic command does not become QE PASS", () => {
    const result = createExecutionEvidence({
      executionId: "test-1",
      command: {
        executable: "echo",
        args: ["hi"],
        workingDirectory: "/tmp",
      },
      executor: "local",
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 10,
      exitCode: 0,
      terminationReason: "COMPLETED",
      stdout: "hi",
      stderr: "",
      timedOut: false,
      policyOutcome: "ALLOWED",
      truncated: { stdout: false, stderr: false },
      secretsRedacted: false,
      networkPolicy: "NONE",
      networkPolicyEnforced: false,
      purpose: "generic command",
    });
    expect(result.status).toBe("OBSERVED");
    expect(result.type).toBe("COMMAND_RESULT");
  });

  it("exit code 0 TEST command becomes PASS", () => {
    const result = createExecutionEvidence(
      {
        executionId: "test-2",
        command: {
          executable: "npm",
          args: ["test"],
          workingDirectory: "/tmp",
        },
        executor: "local",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 5000,
        exitCode: 0,
        terminationReason: "COMPLETED",
        stdout: "all tests passed",
        stderr: "",
        timedOut: false,
        policyOutcome: "ALLOWED",
        truncated: { stdout: false, stderr: false },
        secretsRedacted: false,
        networkPolicy: "NONE",
        networkPolicyEnforced: false,
        purpose: "run tests",
      },
      "TEST",
    );
    expect(result.status).toBe("PASS");
    expect(result.type).toBe("TEST_RESULT");
  });

  it("exit code 1 TEST command becomes FAIL", () => {
    const result = createExecutionEvidence(
      {
        executionId: "test-3",
        command: {
          executable: "npm",
          args: ["test"],
          workingDirectory: "/tmp",
        },
        executor: "local",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 3000,
        exitCode: 1,
        terminationReason: "COMPLETED",
        stdout: "",
        stderr: "1 test failed",
        timedOut: false,
        policyOutcome: "ALLOWED",
        truncated: { stdout: false, stderr: false },
        secretsRedacted: false,
        networkPolicy: "NONE",
        networkPolicyEnforced: false,
        purpose: "run tests",
      },
      "TEST",
    );
    expect(result.status).toBe("FAIL");
  });
});

// --- Execution Controller Integration ---

describe("Execution Controller", () => {
  it("denies and records policy-denied proposals", async () => {
    const controller = new ExecutionController();
    const { result, evidence } = await controller.execute(
      makeProposal({ workingDirectory: "/tmp" }),
      makeContext(),
    );
    expect(result.terminationReason).toBe("POLICY_DENIED");
    expect(result.policyOutcome).toBe("DENIED");
    expect(evidence.status).toBe("INCONCLUSIVE");
  });

  it("accumulates evidence across executions", async () => {
    const controller = new ExecutionController();
    await controller.execute(makeProposal(), makeContext());
    await controller.execute(
      makeProposal({ args: [resolve(SCRIPTS, "fail.sh")] }),
      makeContext(),
    );
    const allEvidence = await controller.getEvidenceStore().list();
    expect(allEvidence.length).toBe(2);
  });
});

// ============================================================
// Milestone 2 Correction Regression Tests
// ============================================================

// --- Correction 1: Secret redaction across entire boundary ---

describe("Secret Redaction — Full Boundary", () => {
  it("redacts secrets from command arguments in result", async () => {
    const secret = "arg-secret-99";
    const controller = new ExecutionController();
    const { result } = await controller.execute(
      makeProposal({
        executable: "/bin/echo",
        args: [secret, "visible"],
      }),
      makeContext({ secrets: [secret] }),
    );
    expect(result.command.args.join(" ")).not.toContain(secret);
    expect(result.command.args.join(" ")).toContain("[REDACTED]");
    expect(result.stdout).not.toContain(secret);
  });

  it("redacts secrets from command arguments in evidence", async () => {
    const secret = "ev-arg-secret";
    const controller = new ExecutionController();
    const { evidence } = await controller.execute(
      makeProposal({
        executable: "/bin/echo",
        args: [secret],
      }),
      makeContext({ secrets: [secret] }),
    );
    const json = JSON.stringify(evidence);
    expect(json).not.toContain(secret);
    expect(json).toContain("[REDACTED]");
  });

  it("redacts secrets from environment values in output", async () => {
    const secret = "env-secret-XYZ";
    const executor = new LocalExecutor();
    const result = await executor.execute(
      makeProposal({
        args: [resolve(SCRIPTS, "echo-secret.sh")],
        environment: { SECRET_TOKEN: secret },
      }),
      makeContext({ secrets: [secret] }),
    );
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
    expect(result.stdout).toContain("[REDACTED]");
  });

  it("secret never appears in full JSON result representation", async () => {
    const secret = "json-secret-ABC";
    const controller = new ExecutionController();
    const { result, evidence } = await controller.execute(
      makeProposal({
        executable: "/bin/echo",
        args: [secret],
        environment: { TOKEN: secret },
      }),
      makeContext({ secrets: [secret] }),
    );
    const json = JSON.stringify({ result, evidence });
    expect(json).not.toContain(secret);
  });
});

// --- Correction 2: Deep evidence immutability ---

describe("Evidence Deep Immutability", () => {
  it("mutating original input after add does not affect stored evidence", async () => {
    const store = new InMemoryEvidenceStore();
    const evidence = {
      id: "ev-deep-1",
      type: "COMMAND_RESULT" as const,
      provenance: "executed" as const,
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED" as const,
      summary: "original",
      details: {
        executable: "echo",
        args: ["original-arg"],
        nested: { deep: "value" },
      },
    };
    await store.add(evidence);

    evidence.summary = "MUTATED";
    (evidence.details as Record<string, unknown>).executable = "MUTATED";
    (
      (evidence.details as Record<string, unknown>).nested as Record<
        string,
        unknown
      >
    ).deep = "MUTATED";

    const retrieved = await store.get("ev-deep-1");
    expect(retrieved!.summary).toBe("original");
    expect((retrieved!.details as Record<string, unknown>).executable).toBe(
      "echo",
    );
    expect(
      (
        (retrieved!.details as Record<string, unknown>).nested as Record<
          string,
          unknown
        >
      ).deep,
    ).toBe("value");
  });

  it("mutating result from get() does not affect stored evidence", async () => {
    const store = new InMemoryEvidenceStore();
    await store.add({
      id: "ev-deep-2",
      type: "COMMAND_RESULT" as const,
      provenance: "executed" as const,
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED" as const,
      summary: "original",
      details: { args: ["a", "b"] },
    });

    const got = await store.get("ev-deep-2");
    got!.summary = "MUTATED";
    ((got!.details as Record<string, unknown>).args as string[]).push("EVIL");

    const fresh = await store.get("ev-deep-2");
    expect(fresh!.summary).toBe("original");
    expect((fresh!.details as Record<string, unknown>).args).toEqual([
      "a",
      "b",
    ]);
  });

  it("mutating result from list() does not affect stored evidence", async () => {
    const store = new InMemoryEvidenceStore();
    await store.add({
      id: "ev-deep-3",
      type: "COMMAND_RESULT" as const,
      provenance: "executed" as const,
      timestamp: new Date().toISOString(),
      source: "test",
      status: "OBSERVED" as const,
      summary: "original",
      details: { nested: { key: "val" } },
    });

    const listed = await store.list();
    listed[0].summary = "MUTATED";
    (
      (listed[0].details as Record<string, unknown>).nested as Record<
        string,
        unknown
      >
    ).key = "MUTATED";

    const fresh = await store.list();
    expect(fresh[0].summary).toBe("original");
    expect(
      (
        (fresh[0].details as Record<string, unknown>).nested as Record<
          string,
          unknown
        >
      ).key,
    ).toBe("val");
  });
});

// --- Correction 3: Bounded streaming output ---

describe("Bounded Streaming Output", () => {
  it("BoundedBuffer limits memory during streaming", () => {
    const buf = new BoundedBuffer(100);
    for (let i = 0; i < 1000; i++) {
      buf.append(Buffer.from("x".repeat(100)));
    }
    const result = buf.finish();
    expect(result.truncated).toBe(true);
    expect(result.totalBytes).toBe(100_000);
    expect(Buffer.byteLength(result.text, "utf-8")).toBeLessThan(300);
  });

  it("small output is not truncated", () => {
    const buf = new BoundedBuffer(1024);
    buf.append(Buffer.from("hello"));
    const result = buf.finish();
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("hello");
  });

  it("truncation metadata is correct on executor output", async () => {
    const executor = new LocalExecutor();
    const result = await executor.execute(
      makeProposal({ args: [resolve(SCRIPTS, "big-output.sh")] }),
      makeContext({ maxOutputBytes: 512 }),
    );
    expect(result.truncated.stdout).toBe(true);
    expect(result.stdout).toContain("OUTPUT TRUNCATED");
    expect(Buffer.byteLength(result.stdout, "utf-8")).toBeLessThan(2048);
  });

  it("redaction works correctly with bounded output", async () => {
    const secret = "bounded-secret-123";
    const executor = new LocalExecutor();
    const result = await executor.execute(
      makeProposal({
        args: [resolve(SCRIPTS, "echo-secret.sh")],
        environment: { SECRET_TOKEN: secret },
      }),
      makeContext({ secrets: [secret], maxOutputBytes: 512 }),
    );
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
  });
});

// --- Correction 4: Docker working directory mapping ---

describe("Docker Working Directory Mapping", () => {
  it("maps repository root to /workspace", () => {
    expect(computeContainerWorkdir("/repo", "/repo")).toBe("/workspace");
  });

  it("maps nested directory to /workspace/relative", () => {
    expect(computeContainerWorkdir("/repo/packages/api", "/repo")).toBe(
      "/workspace/packages/api",
    );
  });

  it("maps deep nesting correctly", () => {
    expect(computeContainerWorkdir("/repo/src/deep/nested/dir", "/repo")).toBe(
      "/workspace/src/deep/nested/dir",
    );
  });
});

// --- Correction 6: Structured discovered command execution ---

describe("Structured Command Parsing", () => {
  it("rejects commands with shell metacharacters via CLI", async () => {
    // This tests the parseSimpleCommand function indirectly through the CLI module
    // We test the policy-level safety here instead
    const controller = new ExecutionController();

    // A command with semicolons should not be naively split
    // The CLI rejects these before reaching the controller
    // This test verifies the controller handles structured args safely
    const { result } = await controller.execute(
      makeProposal({
        executable: "/bin/echo",
        args: ["hello; rm -rf /", "&&", "cat /etc/passwd"],
      }),
      makeContext(),
    );
    expect(result.exitCode).toBe(0);
    // Metacharacters are treated as literal args because shell: false
    expect(result.stdout).toContain("hello; rm -rf /");
    expect(result.stdout).toContain("&&");
  });
});

// --- Correction 7: Executor-unavailable evidence ---

describe("Executor Unavailable Evidence", () => {
  it("Docker unavailable produces INCONCLUSIVE evidence instead of throwing", async () => {
    const docker = new DockerExecutor();
    const available = await docker.available();
    if (available) return; // skip if Docker is available

    const controller = new ExecutionController();
    const { result, evidence } = await controller.execute(
      makeProposal(),
      makeContext({ executionMode: "docker" }),
    );
    expect(result.terminationReason).toBe("SPAWN_FAILED");
    expect(result.executor).toBe("docker");
    expect(evidence.status).toBe("INCONCLUSIVE");
  });
});
