import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  discoverRoot,
  canonicalize,
} from "../src/repository/root-discovery.js";

const execFileAsync = promisify(execFile);

/**
 * Regression tests for root discovery source semantics. Originally
 * motivated by a live test where a Python project checked out under
 * $HOME was hijacked by a stray parent-directory package.json; the
 * fixtures here reproduce that shape generically.
 */

describe("discoverRoot path source", () => {
  let parentDir: string;
  let repoDir: string;

  beforeEach(async () => {
    parentDir = await mkdtemp(join(tmpdir(), "qe-root-"));
    // Simulate $HOME containing a stray project marker.
    await writeFile(join(parentDir, "package.json"), "{}", "utf-8");
    // A real Python-style repo below it with only requirements.txt.
    repoDir = join(parentDir, "sample-python-repo");
    await mkdir(repoDir, { recursive: true });
    await writeFile(join(repoDir, "requirements.txt"), "fastapi\n", "utf-8");
    await writeFile(join(repoDir, "pytest.ini"), "[pytest]\n", "utf-8");
    await execFileAsync("git", ["init", "-q"], { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(parentDir, { recursive: true, force: true });
  });

  it("explicit source never escapes above the given path", async () => {
    const result = await discoverRoot(repoDir, { source: "explicit" });
    expect(result.root).toBe(repoDir);
    expect(result.git.detected).toBe(true);
    // Compare canonical identities, not raw strings: on macOS the Git
    // root (/private/var/...) and the fixture path (/var/...) are the
    // same directory under different aliases.
    expect(await canonicalize(result.git.root!)).toBe(
      await canonicalize(repoDir),
    );
  });

  it("explicit source does not report a parent git repo as the target", async () => {
    // Make the parent a git repo too — the parent must not swallow the target.
    await execFileAsync("git", ["init", "-q"], { cwd: parentDir });
    const result = await discoverRoot(repoDir, { source: "explicit" });
    expect(result.root).toBe(repoDir);
    expect(result.git.detected).toBe(true);
    expect(await canonicalize(result.git.root!)).toBe(
      await canonicalize(repoDir),
    );
  });

  it("inferred source may walk upward to a project marker", async () => {
    const result = await discoverRoot(repoDir, { source: "inferred" });
    // requirements.txt is now a recognized marker, so the repo itself
    // is found before the stray parent package.json.
    expect(result.root).toBe(repoDir);
  });

  it("inferred source inside a subdirectory of the repo still finds the marker", async () => {
    const subDir = join(repoDir, "src");
    await mkdir(subDir, { recursive: true });
    const result = await discoverRoot(subDir, { source: "inferred" });
    expect(result.root).toBe(repoDir);
  });

  it("explicit source on a non-repo directory still reports a usable root", async () => {
    const plainDir = join(parentDir, "plain");
    await mkdir(plainDir, { recursive: true });
    const result = await discoverRoot(plainDir, { source: "explicit" });
    expect(result.root).toBe(plainDir);
    expect(result.git.detected).toBe(false);
  });

  it("recognizes requirements.txt as a project marker for inferred source", async () => {
    const subDir = join(repoDir, "tests");
    await mkdir(subDir, { recursive: true });
    const result = await discoverRoot(subDir, { source: "inferred" });
    expect(result.root).toBe(repoDir);
  });
});
