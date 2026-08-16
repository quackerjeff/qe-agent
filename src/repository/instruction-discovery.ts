import type { FileInventory } from "./types.js";
import { filesMatching } from "../adapters/util.js";

export interface DiscoveredDocument {
  path: string;
  type: string;
}

export function discoverInstructions(
  inventory: FileInventory,
): DiscoveredDocument[] {
  const docs: DiscoveredDocument[] = [];

  const readmes = filesMatching(inventory, (f) =>
    /^README(\.[^/]+)?$/i.test(f),
  );
  for (const path of readmes) {
    docs.push({ path, type: "readme" });
  }

  const contributing = filesMatching(inventory, (f) =>
    /^CONTRIBUTING(\.[^/]+)?$/i.test(f),
  );
  for (const path of contributing) {
    docs.push({ path, type: "contributing" });
  }

  if (inventory.files.includes("AGENTS.md")) {
    docs.push({ path: "AGENTS.md", type: "agent-instructions" });
  }

  if (inventory.files.includes("CLAUDE.md")) {
    docs.push({ path: "CLAUDE.md", type: "agent-instructions" });
  }

  const docFiles = filesMatching(
    inventory,
    (f) => f.startsWith("docs/") && !f.includes("/", 5),
  );
  for (const path of docFiles) {
    docs.push({ path, type: "documentation" });
  }

  return docs;
}
