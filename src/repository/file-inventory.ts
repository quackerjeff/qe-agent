import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { FileInventory } from "./types.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  "vendor",
  "target",
  "bin",
  "obj",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  ".nyc_output",
  ".next",
  ".nuxt",
  ".cache",
]);

const NESTED_PROJECT_MARKERS = new Set([
  "package.json",
  "pyproject.toml",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "Gemfile",
  "composer.json",
]);

const NESTED_PROJECT_EXTENSIONS = [".sln"];

const MAX_DEPTH = 5;
const MAX_FILES = 10_000;

export interface InventoryResult {
  inventory: FileInventory;
  nestedProjectPaths: string[];
}

export async function buildFileInventory(
  root: string,
): Promise<InventoryResult> {
  const files: string[] = [];
  const nestedProjectPaths: string[] = [];
  await walkDir(root, root, 0, files, nestedProjectPaths);
  return { inventory: { root, files }, nestedProjectPaths };
}

async function isNestedProjectRoot(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return false;
  }
  return entries.some(
    (e) =>
      NESTED_PROJECT_MARKERS.has(e) ||
      NESTED_PROJECT_EXTENSIONS.some((ext) => e.endsWith(ext)),
  );
}

async function walkDir(
  base: string,
  dir: string,
  depth: number,
  files: string[],
  nestedProjectPaths: string[],
): Promise<void> {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) {
        if (entry.name === ".github") {
          await walkDir(
            base,
            join(dir, entry.name),
            depth + 1,
            files,
            nestedProjectPaths,
          );
        }
        continue;
      }
      const childPath = join(dir, entry.name);
      if (depth > 0 && (await isNestedProjectRoot(childPath))) {
        nestedProjectPaths.push(relative(base, childPath));
        continue;
      }
      await walkDir(base, childPath, depth + 1, files, nestedProjectPaths);
    } else if (entry.isFile()) {
      files.push(relative(base, join(dir, entry.name)));
    }
  }
}
