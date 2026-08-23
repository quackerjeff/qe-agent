import type { Evidence } from "../../types/index.js";

const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 500;

const DETERMINISTIC_OBSERVED_TYPES = new Set([
  "DISCOVERY_RESULT",
  "LIFECYCLE_OBSERVATION",
]);

export function isAuthoritativeVerificationEvidence(ev: Evidence): boolean {
  if (ev.provenance === "executed") return true;
  if (
    ev.provenance === "observed" &&
    DETERMINISTIC_OBSERVED_TYPES.has(ev.type)
  ) {
    return true;
  }
  return false;
}

export function sanitizeEvidenceDetails(
  details: unknown,
): Record<string, unknown> | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const raw = details as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue;
    if (typeof value === "boolean" || typeof value === "number") {
      result[key] = value;
    } else if (typeof value === "string") {
      result[key] =
        value.length > MAX_STRING_LENGTH
          ? value.slice(0, MAX_STRING_LENGTH)
          : value;
    } else if (Array.isArray(value)) {
      const bounded = value.slice(0, MAX_ARRAY_ITEMS);
      result[key] = bounded
        .map((item) => {
          if (item == null) return item;
          if (typeof item === "string") {
            return item.length > MAX_STRING_LENGTH
              ? item.slice(0, MAX_STRING_LENGTH)
              : item;
          }
          if (typeof item === "boolean" || typeof item === "number")
            return item;
          if (typeof item === "object" && !Array.isArray(item)) {
            return sanitizeShallowObject(item as Record<string, unknown>);
          }
          return undefined;
        })
        .filter((v) => v !== undefined);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeShallowObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    if (typeof value === "boolean" || typeof value === "number") {
      result[key] = value;
    } else if (typeof value === "string") {
      result[key] =
        value.length > MAX_STRING_LENGTH
          ? value.slice(0, MAX_STRING_LENGTH)
          : value;
    }
  }
  return result;
}

export function projectEvidenceForModel(
  evidence: Evidence[],
  classificationMap?: Map<string, string>,
): {
  id: string;
  type: string;
  status: string;
  summary: string;
  details?: Record<string, unknown>;
  investigatedClassification?: string;
}[] {
  return evidence.map((e) => {
    const sanitized = sanitizeEvidenceDetails(e.details);
    return {
      id: e.id,
      type: e.type,
      status: e.status,
      summary: e.summary,
      ...(sanitized != null ? { details: sanitized } : {}),
      ...(classificationMap?.has(e.id)
        ? { investigatedClassification: classificationMap.get(e.id)! }
        : {}),
    };
  });
}
