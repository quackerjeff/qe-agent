import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  QEConfigSchema,
  getDefaultConfig,
  ConfigValidationError,
  loadConfig,
} from "../src/config/index.js";

describe("QEConfig defaults", () => {
  it("produces a valid default configuration", () => {
    const config = getDefaultConfig();
    expect(config.version).toBe(1);
    expect(config.profile).toBe("standard");
    expect(config.execution.mode).toBe("auto");
    expect(config.execution.maxMinutes).toBe(20);
    expect(config.tests.generation).toBe(true);
    expect(config.tests.commitPermanentTests).toBe(true);
    expect(config.browser.enabled).toBe("auto");
    expect(config.github.blockOnFail).toBe(true);
    expect(config.github.createIssues).toBe(true);
    expect(config.memory.enabled).toBe(true);
    expect(config.model.provider).toBe("default");
  });

  it("fills defaults for omitted optional sections", () => {
    const config = QEConfigSchema.parse({ version: 1 });
    expect(config.profile).toBe("standard");
    expect(config.execution.mode).toBe("auto");
    expect(config.execution.maxMinutes).toBe(20);
  });
});

describe("QEConfig valid configurations", () => {
  it("accepts a minimal configuration with only version", () => {
    const result = QEConfigSchema.safeParse({ version: 1 });
    expect(result.success).toBe(true);
  });

  it("accepts a full valid configuration", () => {
    const full = {
      version: 1,
      profile: "deep",
      execution: { mode: "docker", maxMinutes: 60 },
      tests: { generation: false, commitPermanentTests: false },
      browser: { enabled: false },
      github: { blockOnFail: false, createIssues: false },
      memory: { enabled: false },
      model: { provider: "anthropic" },
    };
    const result = QEConfigSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profile).toBe("deep");
      expect(result.data.execution.mode).toBe("docker");
    }
  });

  it("accepts quick profile", () => {
    const result = QEConfigSchema.safeParse({
      version: 1,
      profile: "quick",
    });
    expect(result.success).toBe(true);
  });

  it("roundtrips through YAML", () => {
    const yamlStr = `
version: 1
profile: standard
execution:
  mode: local
  maxMinutes: 10
`;
    const parsed = parseYaml(yamlStr);
    const result = QEConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.execution.mode).toBe("local");
      expect(result.data.execution.maxMinutes).toBe(10);
    }
  });
});

describe("QEConfig browser.enabled", () => {
  it("accepts 'auto' string", () => {
    const result = QEConfigSchema.safeParse({
      version: 1,
      browser: { enabled: "auto" },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.browser.enabled).toBe("auto");
  });

  it("accepts boolean true", () => {
    const result = QEConfigSchema.safeParse({
      version: 1,
      browser: { enabled: true },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.browser.enabled).toBe(true);
  });

  it("accepts boolean false", () => {
    const result = QEConfigSchema.safeParse({
      version: 1,
      browser: { enabled: false },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.browser.enabled).toBe(false);
  });

  it("defaults to 'auto' when omitted", () => {
    const result = QEConfigSchema.safeParse({ version: 1 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.browser.enabled).toBe("auto");
  });

  it("rejects string 'true' (not a valid value)", () => {
    const result = QEConfigSchema.safeParse({
      version: 1,
      browser: { enabled: "true" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects string 'false' (not a valid value)", () => {
    const result = QEConfigSchema.safeParse({
      version: 1,
      browser: { enabled: "false" },
    });
    expect(result.success).toBe(false);
  });

  it("roundtrips boolean true through YAML", () => {
    const yamlStr = `
version: 1
browser:
  enabled: true
`;
    const parsed = parseYaml(yamlStr);
    const result = QEConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.browser.enabled).toBe(true);
  });

  it("roundtrips boolean false through YAML", () => {
    const yamlStr = `
version: 1
browser:
  enabled: false
`;
    const parsed = parseYaml(yamlStr);
    const result = QEConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.browser.enabled).toBe(false);
  });

  it("roundtrips 'auto' through YAML", () => {
    const yamlStr = `
version: 1
browser:
  enabled: auto
`;
    const parsed = parseYaml(yamlStr);
    const result = QEConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.browser.enabled).toBe("auto");
  });
});

describe("QEConfig invalid configurations", () => {
  it("rejects missing version", () => {
    const result = QEConfigSchema.safeParse({ profile: "standard" });
    expect(result.success).toBe(false);
  });

  it("rejects wrong version number", () => {
    const result = QEConfigSchema.safeParse({ version: 2 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid profile", () => {
    const result = QEConfigSchema.safeParse({
      version: 1,
      profile: "turbo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative maxMinutes", () => {
    const result = QEConfigSchema.safeParse({
      version: 1,
      execution: { maxMinutes: -5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid execution mode", () => {
    const result = QEConfigSchema.safeParse({
      version: 1,
      execution: { mode: "cloud" },
    });
    expect(result.success).toBe(false);
  });
});

describe("loadConfig", () => {
  it("throws ConfigValidationError for missing config", async () => {
    await expect(loadConfig("/nonexistent/path")).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it("error includes useful message for missing config", async () => {
    try {
      await loadConfig("/nonexistent/path");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const configErr = err as ConfigValidationError;
      expect(configErr.message).toContain("qe init");
    }
  });
});
