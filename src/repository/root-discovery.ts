import { execFile } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { promisify } from "node:util";
import type { GitInfo } from "../types/index.js";

const execFileAsync = promisify(execFile);

const PROJECT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "setup.py",
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

export async function discoverRoot(
  targetPath: string,
): Promise<RootDiscoveryResult> {
  const absolutePath = resolve(targetPath);
  await access(absolutePath, constants.R_OK);

  const git = await detectGit(absolutePath);

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
