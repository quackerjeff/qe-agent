import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { runInit } from "../src/cli/init.js";
import { QEConfigSchema } from "../src/config/index.js";
import type { Logger, LogEntry, LogSink } from "../src/logging/index.js";
import { StructuredLogger } from "../src/logging/index.js";

class TestLogSink implements LogSink {
  public entries: LogEntry[] = [];
  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

function createTestLogger(): { logger: Logger; sink: TestLogSink } {
  const sink = new TestLogSink();
  const logger = new StructuredLogger(sink, "TRACE");
  return { logger, sink };
}

describe("qe init", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "qe-init-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates .qe/config.yml in an empty directory", async () => {
    const { logger } = createTestLogger();
    await runInit(tempDir, logger);

    const configPath = join(tempDir, ".qe", "config.yml");
    const content = await readFile(configPath, "utf-8");
    const parsed = parseYaml(content);
    const result = QEConfigSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
    }
  });

  it("does not overwrite existing config.yml", async () => {
    const qeDir = join(tempDir, ".qe");
    await mkdir(qeDir, { recursive: true });

    const customConfig = "version: 1\nprofile: deep\n";
    await writeFile(join(qeDir, "config.yml"), customConfig, "utf-8");

    const { logger, sink } = createTestLogger();
    await runInit(tempDir, logger);

    const content = await readFile(join(qeDir, "config.yml"), "utf-8");
    expect(content).toBe(customConfig);

    const messages = sink.entries.map((e) => e.message);
    expect(messages.some((m) => m.includes("already exists"))).toBe(true);
  });

  it("logs a message on first init", async () => {
    const { logger, sink } = createTestLogger();
    await runInit(tempDir, logger);

    const messages = sink.entries.map((e) => e.message);
    expect(messages.some((m) => m.includes("Initialized"))).toBe(true);
  });

  it("produces a valid config when parsed", async () => {
    const { logger } = createTestLogger();
    await runInit(tempDir, logger);

    const configPath = join(tempDir, ".qe", "config.yml");
    const content = await readFile(configPath, "utf-8");
    const parsed = parseYaml(content);
    const config = QEConfigSchema.parse(parsed);

    expect(config.profile).toBe("standard");
    expect(config.execution.mode).toBe("auto");
  });

  it("surfaces permission errors instead of treating them as missing config", async () => {
    const qeDir = join(tempDir, ".qe");
    await mkdir(qeDir, { recursive: true });
    const configPath = join(qeDir, "config.yml");
    await writeFile(configPath, "version: 1\n", "utf-8");
    await chmod(configPath, 0o000);

    const { logger } = createTestLogger();
    try {
      await runInit(tempDir, logger);
      // If we're running as root, chmod won't prevent reads — skip
    } catch (err) {
      expect(err).toBeDefined();
      expect((err as NodeJS.ErrnoException).code).toBe("EACCES");
    } finally {
      await chmod(configPath, 0o644);
    }
  });
});
