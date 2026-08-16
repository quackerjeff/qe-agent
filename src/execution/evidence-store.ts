import type { Evidence } from "../types/index.js";

export interface EvidenceStore {
  add(evidence: Evidence): Promise<void>;
  get(id: string): Promise<Evidence | undefined>;
  list(): Promise<Evidence[]>;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const val of Object.values(obj)) {
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val as object);
    }
  }
  return obj;
}

export class InMemoryEvidenceStore implements EvidenceStore {
  private readonly store = new Map<string, Readonly<Evidence>>();

  async add(evidence: Evidence): Promise<void> {
    if (this.store.has(evidence.id)) {
      throw new Error(
        `Evidence '${evidence.id}' already exists; evidence is immutable`,
      );
    }
    this.store.set(evidence.id, deepFreeze(deepClone(evidence)));
  }

  async get(id: string): Promise<Evidence | undefined> {
    const stored = this.store.get(id);
    if (!stored) return undefined;
    return deepClone(stored);
  }

  async list(): Promise<Evidence[]> {
    return [...this.store.values()].map((e) => deepClone(e));
  }
}
