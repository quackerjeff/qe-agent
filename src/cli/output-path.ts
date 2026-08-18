import { resolve, relative, isAbsolute } from "node:path";
import { realpath, mkdir, writeFile } from "node:fs/promises";

export type OutputPathResult =
  { ok: true; resolvedPath: string } | { ok: false; error: string };

export async function resolveSafeResultOutputPath(
  repositoryRoot: string,
  requestedPath: string,
): Promise<OutputPathResult> {
  const outputPath = resolve(repositoryRoot, requestedPath);
  const rel = relative(repositoryRoot, outputPath);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      ok: false,
      error: "--output must resolve to a path within the evaluated repository",
    };
  }

  try {
    const realParent = await realpath(resolve(outputPath, ".."));
    const realRepo = await realpath(repositoryRoot);
    const realRel = relative(realRepo, realParent);
    if (realRel.startsWith("..") || isAbsolute(realRel)) {
      return {
        ok: false,
        error: "--output parent escapes the evaluated repository via symlink",
      };
    }
  } catch {
    // Parent doesn't exist yet — will be created by writeSafeResultOutput,
    // which is fine since the logical path already passed containment check.
  }

  return { ok: true, resolvedPath: outputPath };
}

export async function writeSafeResultOutput(
  repositoryRoot: string,
  requestedPath: string,
  content: string,
): Promise<OutputPathResult> {
  const resolved = await resolveSafeResultOutputPath(
    repositoryRoot,
    requestedPath,
  );
  if (!resolved.ok) return resolved;

  await mkdir(resolve(resolved.resolvedPath, ".."), { recursive: true });
  await writeFile(resolved.resolvedPath, content, "utf-8");
  return resolved;
}
