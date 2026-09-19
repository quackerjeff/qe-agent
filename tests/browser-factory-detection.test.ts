import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectInstalledPlaywrightMcp,
  DEFAULT_MCP_COMMAND,
  DEFAULT_MCP_ARGS,
} from "../src/cli/browser-factory.js";

/**
 * Local Playwright MCP discovery: the QE Agent must reuse a harness's
 * already-installed @playwright/mcp (e.g. Kiro's ~/.kiro/settings/mcp.json
 * entry) rather than downloading a second copy via npx.
 *
 * detectInstalledPlaywrightMcp reads HOME-relative paths, so these tests
 * point HOME at a temp directory to exercise detection deterministically.
 */

describe("detectInstalledPlaywrightMcp", () => {
  let fakeHome: string;
  let realHome: string;

  beforeEach(async () => {
    realHome = process.env.QE_DISCOVERY_HOME;
    fakeHome = await mkdtemp(join(tmpdir(), "qe-mcpdetect-"));
    process.env.QE_DISCOVERY_HOME = fakeHome;
  });

  afterEach(async () => {
    process.env.QE_DISCOVERY_HOME = realHome;
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("returns null when nothing is installed", async () => {
    expect(await detectInstalledPlaywrightMcp()).toBeNull();
  });

  it("detects Kiro's configured playwright MCP server", async () => {
    const cliPath = join(
      fakeHome,
      "npm-cache",
      "_npx",
      "kiro9876",
      "node_modules",
      "@playwright",
      "mcp",
      "cli.js",
    );
    await mkdir(
      join(
        fakeHome,
        "npm-cache",
        "_npx",
        "kiro9876",
        "node_modules",
        "@playwright",
        "mcp",
      ),
      {
        recursive: true,
      },
    );
    await writeFile(cliPath, "#!/usr/bin/env node\n", "utf-8");

    const kiroSettingsDir = join(fakeHome, ".kiro", "settings");
    await mkdir(kiroSettingsDir, { recursive: true });
    await writeFile(
      join(kiroSettingsDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          playwright: {
            command: process.execPath,
            args: [cliPath],
          },
        },
      }),
      "utf-8",
    );

    const detected = await detectInstalledPlaywrightMcp();
    expect(detected).not.toBeNull();
    expect(detected!.command).toBe(process.execPath);
    expect(detected!.args[0]).toBe(cliPath);
    expect(detected!.args).toContain("--headless");
  });

  it("ignores Kiro servers whose CLI path does not exist", async () => {
    const kiroSettingsDir = join(fakeHome, ".kiro", "settings");
    await mkdir(kiroSettingsDir, { recursive: true });
    await writeFile(
      join(kiroSettingsDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          playwright: {
            command: process.execPath,
            args: [join(fakeHome, "missing", "cli.js")],
          },
        },
      }),
      "utf-8",
    );

    expect(await detectInstalledPlaywrightMcp()).toBeNull();
  });

  it("detects an npx-cached @playwright/mcp CLI", async () => {
    const npxCache = join(fakeHome, ".npm", "_npx", "abcd1234");
    const cliPath = join(
      npxCache,
      "node_modules",
      "@playwright",
      "mcp",
      "cli.js",
    );
    await mkdir(join(npxCache, "node_modules", "@playwright", "mcp"), {
      recursive: true,
    });
    await writeFile(cliPath, "#!/usr/bin/env node\n", "utf-8");

    const detected = await detectInstalledPlaywrightMcp();
    expect(detected).not.toBeNull();
    expect(detected!.command).toBe(process.execPath);
    expect(detected!.args[0]).toBe(cliPath);
  });

  it("falls back to the documented npx default when HOME is unreadable", async () => {
    process.env.QE_DISCOVERY_HOME = "/nonexistent/qe-home";
    expect(await detectInstalledPlaywrightMcp()).toBeNull();
    expect(DEFAULT_MCP_COMMAND).toBe("npx");
    expect(DEFAULT_MCP_ARGS[0]).toMatch(/^@playwright\/mcp@\d+\.\d+\.\d+$/);
    expect(DEFAULT_MCP_ARGS[0]).not.toContain("latest");
  });

  it("prefers Kiro's server over an npx cache entry", async () => {
    // Both exist; Kiro's config wins.
    const kiroCli = join(
      fakeHome,
      "npm-cache",
      "_npx",
      "kiro9876",
      "node_modules",
      "@playwright",
      "mcp",
      "cli.js",
    );
    await mkdir(
      join(
        fakeHome,
        "npm-cache",
        "_npx",
        "kiro9876",
        "node_modules",
        "@playwright",
        "mcp",
      ),
      { recursive: true },
    );
    await writeFile(kiroCli, "x", "utf-8");
    await mkdir(join(fakeHome, ".kiro", "settings"), { recursive: true });
    await writeFile(
      join(fakeHome, ".kiro", "settings", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          playwright: { command: "node", args: [kiroCli] },
        },
      }),
      "utf-8",
    );

    const npxCache = join(fakeHome, ".npm", "_npx", "npx123");
    await mkdir(join(npxCache, "node_modules", "@playwright", "mcp"), {
      recursive: true,
    });
    await writeFile(
      join(npxCache, "node_modules", "@playwright", "mcp", "cli.js"),
      "x",
      "utf-8",
    );

    const detected = await detectInstalledPlaywrightMcp();
    expect(detected!.args[0]).toBe(kiroCli);
  });

  it("tolerates malformed Kiro mcp.json", async () => {
    const kiroSettingsDir = join(fakeHome, ".kiro", "settings");
    await mkdir(kiroSettingsDir, { recursive: true });
    await writeFile(
      join(kiroSettingsDir, "mcp.json"),
      "{ not valid json",
      "utf-8",
    );
    expect(await detectInstalledPlaywrightMcp()).toBeNull();
  });
});

describe("detectInstalledPlaywrightMcp env override", () => {
  let realEnvCli: string | undefined;
  let realHome: string;

  beforeEach(async () => {
    realEnvCli = process.env.QE_PLAYWRIGHT_MCP_CLI;
    realHome = process.env.QE_DISCOVERY_HOME ?? "";
    delete process.env.QE_PLAYWRIGHT_MCP_CLI;
    process.env.QE_DISCOVERY_HOME = "/nonexistent/qe-home";
  });

  afterEach(async () => {
    if (realEnvCli === undefined) delete process.env.QE_PLAYWRIGHT_MCP_CLI;
    else process.env.QE_PLAYWRIGHT_MCP_CLI = realEnvCli;
    if (realHome) process.env.QE_DISCOVERY_HOME = realHome;
    else delete process.env.QE_DISCOVERY_HOME;
  });

  it("uses QE_PLAYWRIGHT_MCP_CLI when set and readable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qe-mcpenv-"));
    try {
      // Provisioned layout so the allowlist accepts the override.
      const cliDir = join(dir, "node_modules", "@playwright", "mcp");
      await mkdir(cliDir, { recursive: true });
      const cliPath = join(cliDir, "cli.js");
      await writeFile(cliPath, "#!/usr/bin/env node\n", "utf-8");
      process.env.QE_PLAYWRIGHT_MCP_CLI = cliPath;

      const detected = await detectInstalledPlaywrightMcp();
      expect(detected).not.toBeNull();
      expect(detected!.command).toBe(process.execPath);
      expect(detected!.args[0]).toBe(cliPath);
      expect(detected!.args).toContain("--headless");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls through when QE_PLAYWRIGHT_MCP_CLI is not the provisioned CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qe-mcpenv-"));
    try {
      const cliPath = join(dir, "other-cli.js");
      await writeFile(cliPath, "#!/usr/bin/env node\n", "utf-8");
      process.env.QE_PLAYWRIGHT_MCP_CLI = cliPath;
      // Discovery home is nonexistent and the override is rejected,
      // so nothing is found.
      expect(await detectInstalledPlaywrightMcp()).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls through when QE_PLAYWRIGHT_MCP_CLI points at a missing file", async () => {
    process.env.QE_PLAYWRIGHT_MCP_CLI = "/nonexistent/mcp/cli.js";
    // Discovery home is also nonexistent, so nothing is found.
    expect(await detectInstalledPlaywrightMcp()).toBeNull();
  });
});
