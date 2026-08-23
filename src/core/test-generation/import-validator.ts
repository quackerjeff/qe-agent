import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

const JS_TS_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const INDEX_FILENAMES = JS_TS_EXTENSIONS.filter(Boolean).map(
  (ext) => `/index${ext}`,
);

const RELATIVE_IMPORT_RE =
  /(?:^|[\s;,])(?:import|export)\s+(?:(?:type\s+)?(?:\{[^}]*\}|[^\s;]+)\s+from\s+)?['"](\.[^'"]+)['"]/gm;

export interface ImportValidationResult {
  valid: boolean;
  unresolvedImports: UnresolvedImport[];
}

export interface UnresolvedImport {
  specifier: string;
  resolvedCandidates: string[];
}

export function validateRelativeImports(
  testContent: string,
  testFilePath: string,
  repositoryRoot: string,
): ImportValidationResult {
  const testDir = dirname(resolve(repositoryRoot, testFilePath));
  const unresolvedImports: UnresolvedImport[] = [];

  for (const match of testContent.matchAll(RELATIVE_IMPORT_RE)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;

    const candidates: string[] = [];
    const base = resolve(testDir, specifier);

    for (const ext of JS_TS_EXTENSIONS) {
      candidates.push(base + ext);
    }
    for (const indexFile of INDEX_FILENAMES) {
      candidates.push(base + indexFile);
    }

    const resolved = candidates.some((c) => existsSync(c));
    if (!resolved) {
      unresolvedImports.push({
        specifier,
        resolvedCandidates: candidates.slice(0, 4),
      });
    }
  }

  return {
    valid: unresolvedImports.length === 0,
    unresolvedImports,
  };
}
