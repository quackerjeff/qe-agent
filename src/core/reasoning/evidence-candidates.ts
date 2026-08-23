const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "shall",
  "should",
  "would",
  "could",
  "can",
  "may",
  "might",
  "must",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "between",
  "out",
  "up",
  "down",
  "over",
  "under",
  "again",
  "then",
  "once",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "not",
  "only",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "but",
  "and",
  "or",
  "if",
  "while",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "they",
  "them",
  "their",
  "we",
  "our",
  "you",
  "your",
]);

const TYPE_SIGNALS: Record<string, string[]> = {
  TEST_RESULT: [
    "test",
    "testing",
    "tests",
    "verified",
    "verification",
    "suite",
    "coverage",
    "pass",
    "fail",
    "assertion",
  ],
  COMMAND_RESULT: [
    "command",
    "execute",
    "execution",
    "script",
    "run",
    "output",
    "exit",
  ],
  DISCOVERY_RESULT: [
    "discover",
    "detect",
    "detection",
    "framework",
    "tool",
    "capability",
    "repository",
    "analyze",
    "analysis",
    "configuration",
    "available",
    "identify",
  ],
  LIFECYCLE_OBSERVATION: [
    "lifecycle",
    "invocation",
    "mode",
    "budget",
    "runtime",
    "observe",
    "observation",
    "state",
  ],
  BUILD_RESULT: ["build", "compile", "compilation", "artifact"],
  STATIC_ANALYSIS_RESULT: [
    "lint",
    "linting",
    "static",
    "analysis",
    "quality",
    "check",
    "typecheck",
    "format",
    "formatting",
  ],
  BROWSER_RESULT: [
    "browser",
    "ui",
    "rendering",
    "visual",
    "page",
    "navigation",
    "accessibility",
  ],
};

export function extractTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  for (const word of words) {
    if (!STOP_WORDS.has(word)) {
      terms.add(word);
    }
  }
  return terms;
}

function evidenceToSearchText(ev: {
  type: string;
  summary: string;
  details?: Record<string, unknown>;
}): string {
  const parts = [ev.type.replace(/_/g, " "), ev.summary];

  if (ev.details && typeof ev.details === "object") {
    for (const [key, value] of Object.entries(ev.details)) {
      parts.push(key.replace(/([A-Z])/g, " $1"));
      if (typeof value === "string") {
        parts.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") parts.push(item);
        }
      }
    }
  }

  return parts.join(" ");
}

function requirementToSearchText(req: {
  description: string;
  acceptanceCriteria?: { description: string }[];
}): string {
  const parts = [req.description];
  if (req.acceptanceCriteria) {
    for (const ac of req.acceptanceCriteria) {
      parts.push(ac.description);
    }
  }
  return parts.join(" ");
}

function hasTypeSignalMatch(
  reqTerms: Set<string>,
  evidenceType: string,
): boolean {
  const signals = TYPE_SIGNALS[evidenceType];
  if (!signals) return false;
  for (const signal of signals) {
    if (reqTerms.has(signal)) return true;
  }
  return false;
}

function hasContentOverlap(
  reqTerms: Set<string>,
  evTerms: Set<string>,
  minOverlap: number = 2,
): boolean {
  let overlap = 0;
  for (const term of evTerms) {
    if (reqTerms.has(term)) {
      overlap++;
      if (overlap >= minOverlap) return true;
    }
  }
  return false;
}

export function buildCandidateEvidenceMap(
  requirements: {
    id: string;
    description: string;
    acceptanceCriteria?: { id: string; description: string }[];
  }[],
  evidence: {
    id: string;
    type: string;
    summary: string;
    details?: Record<string, unknown>;
  }[],
): Map<string, string[]> {
  const candidates = new Map<string, string[]>();

  const evSearchData = evidence.map((ev) => ({
    id: ev.id,
    type: ev.type,
    terms: extractTerms(evidenceToSearchText(ev)),
  }));

  for (const req of requirements) {
    const reqTerms = extractTerms(requirementToSearchText(req));
    const matched: string[] = [];

    for (const ev of evSearchData) {
      if (
        hasTypeSignalMatch(reqTerms, ev.type) ||
        hasContentOverlap(reqTerms, ev.terms)
      ) {
        matched.push(ev.id);
      }
    }

    candidates.set(req.id, matched);
  }

  return candidates;
}
