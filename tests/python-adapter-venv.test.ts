import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PythonAdapter } from "../src/adapters/python/adapter.js";
import type { FileInventory } from "../src/repository/types.js";

/**
 * Virtual-environment support in the Python adapter: projects with a
 * .venv must have install/test commands executed inside it. Verified
 * live against a real Python project whose bare-`pip` PATH resolution
 * was broken while its project venv worked.
 */
describe("PythonAdapter virtual environments", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "qe-pyvenv-"));
    await writeFile(join(root, "requirements.txt"), "fastapi\n", "utf-8");
    await writeFile(join(root, "pytest.ini"), "[pytest]\n", "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function inventory(): FileInventory {
    // Mirror the real inventory: venv contents are ignored.
    return { root, files: ["requirements.txt", "pytest.ini"] };
  }

  async function makeVenv(dir: string, exe = "bin/python"): Promise<string> {
    const pythonPath = join(root, dir, ...exe.split("/"));
    await mkdir(join(pythonPath, ".."), { recursive: true });
    await writeFile(pythonPath, "#!/bin/sh\n", "utf-8");
    await chmod(pythonPath, 0o755);
    return pythonPath;
  }

  it("emits venv-scoped commands when a project .venv exists", async () => {
    const pythonPath = await makeVenv(".venv");
    const result = await new PythonAdapter().analyze(inventory());

    const test = result.commands.find((c) => c.id === "pytest:test");
    expect(test).toBeDefined();
    expect(test!.executable).toBe(pythonPath);
    expect(test!.args).toEqual(["-m", "pytest"]);

    const install = result.commands.find((c) => c.id === "pip:install");
    expect(install).toBeDefined();
    expect(install!.executable).toBe(pythonPath);
    expect(install!.args).toEqual([
      "-m",
      "pip",
      "install",
      "-r",
      "requirements.txt",
    ]);
  });

  it("falls back to bare commands when no venv exists", async () => {
    const result = await new PythonAdapter().analyze(inventory());

    const test = result.commands.find((c) => c.id === "pytest:test");
    expect(test!.executable).toBe("pytest");

    const install = result.commands.find((c) => c.id === "pip:install");
    expect(install!.executable).toBe("pip");
  });

  it("detects Windows-style venv layouts", async () => {
    const pythonPath = await makeVenv(".venv", "Scripts/python.exe");
    const result = await new PythonAdapter().analyze(inventory());
    const install = result.commands.find((c) => c.id === "pip:install");
    expect(install!.executable).toBe(pythonPath);
  });

  it("prefers .venv over venv and env", async () => {
    const preferred = await makeVenv(".venv");
    await makeVenv("venv");
    const result = await new PythonAdapter().analyze(inventory());
    const test = result.commands.find((c) => c.id === "pytest:test");
    expect(test!.executable).toBe(preferred);
  });

  it("requires the venv python to be executable", async () => {
    // File exists but is not executable — must not be used.
    const pythonPath = join(root, ".venv", "bin", "python");
    await mkdir(join(pythonPath, ".."), { recursive: true });
    await writeFile(pythonPath, "not executable", "utf-8");
    await chmod(pythonPath, 0o644);
    const result = await new PythonAdapter().analyze(inventory());
    const test = result.commands.find((c) => c.id === "pytest:test");
    expect(test!.executable).toBe("pytest");
  });
});
