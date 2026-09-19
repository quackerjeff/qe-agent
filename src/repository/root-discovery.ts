import { execFile } from "node:child_process";
import { access, constants, realpath, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { promisify } from "node:util";
import type { GitInfo } from "../types/index.js";

const execFileAsync = promisify(execFile);

const PROJECT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "pytest.ini",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "Makefile",
  ".sln",
];

export interface RootDiscoveryResult {
  root: string;
  git: GitInfo;
}

export interface RootDiscoveryOptions {
  /**
   * How the target path was determined. This distinguishes the two
   * supported invocation styles:
   *
   * - "explicit" — the user supplied the repository path (e.g. `--repo`).
   *   That path is the authoritative root; the search never escapes above
   *   it (stray project markers in parent directories must not hijack
   *   the analysis target).
   * - "inferred" (default) — the path was derived from the environment
   *   (e.g. cwd in a local terminal or inside a GitHub Actions runner,
   *   where the checkout may sit below the project root). The search may
   *   walk upward to find the nearest project marker or git root.
   */
  source?: "explicit" | "inferred";
}

export async function discoverRoot(
  targetPath: string,
  options: RootDiscoveryOptions = {},
): Promise<RootDiscoveryResult> {
  const explicit = options.source === "explicit";
  const absolutePath = resolve(targetPath);
  await access(absolutePath, constants.R_OK);

  const git = await detectGit(absolutePath);

  if (explicit) {
    // An explicitly given repository path is the root, full stop. Git
    // metadata may still be reported, but only when its root matches the
    // given path (a parent repo must not swallow the target). Both
    // sides are canonicalized with realpath so equivalent path aliases
    // (e.g. /var/... vs /private/var/... on macOS, symlinked tmpdirs)
    // compare equal.
    if (git.detected && git.root) {
      const [canonicalInput, canonicalGitRoot] = await Promise.all([
        canonicalize(absolutePath),
        canonicalize(git.root),
      ]);
      if (canonicalGitRoot === canonicalInput) {
        return { root: absolutePath, git };
      }
    }
    return { root: absolutePath, git: { detected: false } };
  }

  const projectRoot = await findNearestProjectRoot(absolutePath);
  if (projectRoot) {
    return { root: projectRoot, git };
  }

  if (git.detected && git.root) {
    return { root: git.root, git };
  }

  return { root: absolutePath, git };
}

async function findNearestProjectRoot(
  startPath: string,
): Promise<string | undefined> {
  let dir = startPath;
  const info = await stat(startPath);
  if (!info.isDirectory()) {
    dir = dirname(startPath);
  }

  const root = resolve("/");
  while (dir !== root) {
    for (const marker of PROJECT_MARKERS) {
      if (marker.startsWith(".")) {
        const matches = await globMatch(dir, marker);
        if (matches) return dir;
      } else {
        try {
          await access(resolve(dir, marker), constants.F_OK);
          return dir;
        } catch {
          // not found, continue
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

async function globMatch(dir: string, ext: string): Promise<boolean> {
  const { readdir } = await import("node:fs/promises");
  try {
    const entries = await readdir(dir);
    return entries.some((e) => e.endsWith(ext));
  } catch {
    return false;
  }
}

async function detectGit(path: string): Promise<GitInfo> {
  try {
    const { stdout: root } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: path },
    );
    let branch: string | undefined;
    try {
      const { stdout: branchOut } = await execFileAsync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: path },
      );
      branch = branchOut.trim() || undefined;
    } catch {
      // detached HEAD or other failure — branch stays undefined
    }
    return { detected: true, root: root.trim(), branch };
  } catch {
    return { detected: false };
  }
}

/**
 * Canonicalize a path for identity comparison (symlinks, /var vs
 * /private/var aliases, tmpdir indirection). Falls back to the
 * resolved input when the path does not exist.
 */
export async function canonicalize(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return resolve(p);
  }
}
