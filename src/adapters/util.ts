import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileInventory } from "../repository/types.js";

export function hasFile(inventory: FileInventory, name: string): boolean {
  return inventory.files.includes(name);
}

export function hasAnyFile(inventory: FileInventory, names: string[]): boolean {
  return names.some((n) => inventory.files.includes(n));
}

export function filesMatching(
  inventory: FileInventory,
  predicate: (f: string) => boolean,
): string[] {
  return inventory.files.filter(predicate);
}

export async function readJsonFile(
  root: string,
  relativePath: string,
): Promise<unknown> {
  try {
    const content = await readFile(join(root, relativePath), "utf-8");
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

export async function readTextFile(
  root: string,
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await readFile(join(root, relativePath), "utf-8");
  } catch {
    return undefined;
  }
}
