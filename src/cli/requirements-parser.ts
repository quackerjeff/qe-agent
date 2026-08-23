import { readFile } from "node:fs/promises";
import type { Requirement } from "../types/index.js";

export async function parseRequirementsFile(
  filePath: string,
): Promise<Requirement[]> {
  const content = await readFile(filePath, "utf-8");
  return parseRequirementsText(content);
}

const FR_HEADING_PATTERN = /^##\s+(FR-\d+[A-Z]?)\s+(.+)/;

function hasStructuredRequirements(text: string): boolean {
  return text.split("\n").some((line) => FR_HEADING_PATTERN.test(line.trim()));
}

export function parseRequirementsText(text: string): Requirement[] {
  if (hasStructuredRequirements(text)) {
    return parseStructuredRequirements(text);
  }
  return parseSimpleRequirements(text);
}

function parseStructuredRequirements(text: string): Requirement[] {
  const requirements: Requirement[] = [];
  const lines = text.split("\n");

  let currentReq: Partial<Requirement> | null = null;
  let currentCriteria: { id: string; description: string }[] = [];
  let insideFR = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const frMatch = trimmed.match(FR_HEADING_PATTERN);
    if (frMatch) {
      if (currentReq && currentReq.id && currentReq.description) {
        requirements.push({
          id: currentReq.id,
          description: currentReq.description,
          acceptanceCriteria:
            currentCriteria.length > 0 ? currentCriteria : undefined,
          priority: currentReq.priority,
        });
      }

      currentReq = {
        id: frMatch[1],
        description: `${frMatch[1]} ${frMatch[2]}`,
      };
      currentCriteria = [];
      insideFR = true;
      continue;
    }

    const headerMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      if (insideFR && currentReq) {
        currentCriteria.push({
          id: `${currentReq.id}-ac-${currentCriteria.length + 1}`,
          description: headerMatch[1],
        });
      } else {
        insideFR = false;
      }
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch && currentReq && insideFR) {
      const bulletText = bulletMatch[1];
      const priorityMatch = bulletText.match(
        /\[priority:\s*(low|medium|high|critical)\]/i,
      );
      if (priorityMatch) {
        currentReq.priority =
          priorityMatch[1].toLowerCase() as Requirement["priority"];
      }

      currentCriteria.push({
        id: `${currentReq.id}-ac-${currentCriteria.length + 1}`,
        description: bulletText.replace(/\[priority:\s*\w+\]/i, "").trim(),
      });
      continue;
    }
  }

  if (currentReq && currentReq.id && currentReq.description) {
    requirements.push({
      id: currentReq.id,
      description: currentReq.description,
      acceptanceCriteria:
        currentCriteria.length > 0 ? currentCriteria : undefined,
      priority: currentReq.priority,
    });
  }

  return requirements;
}

function parseSimpleRequirements(text: string): Requirement[] {
  const requirements: Requirement[] = [];
  const lines = text.split("\n");

  let currentReq: Partial<Requirement> | null = null;
  let currentCriteria: { id: string; description: string }[] = [];
  let reqIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      if (currentReq && currentReq.id && currentReq.description) {
        requirements.push({
          id: currentReq.id,
          description: currentReq.description,
          acceptanceCriteria:
            currentCriteria.length > 0 ? currentCriteria : undefined,
          priority: currentReq.priority,
        });
      }

      reqIndex++;
      currentReq = {
        id: `req-${reqIndex}`,
        description: headerMatch[1],
      };
      currentCriteria = [];
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch && currentReq) {
      const text = bulletMatch[1];
      const priorityMatch = text.match(
        /\[priority:\s*(low|medium|high|critical)\]/i,
      );
      if (priorityMatch) {
        currentReq.priority =
          priorityMatch[1].toLowerCase() as Requirement["priority"];
      }

      currentCriteria.push({
        id: `${currentReq.id}-ac-${currentCriteria.length + 1}`,
        description: text.replace(/\[priority:\s*\w+\]/i, "").trim(),
      });
      continue;
    }

    if (!currentReq) {
      reqIndex++;
      currentReq = {
        id: `req-${reqIndex}`,
        description: trimmed,
      };
      currentCriteria = [];
    }
  }

  if (currentReq && currentReq.id && currentReq.description) {
    requirements.push({
      id: currentReq.id,
      description: currentReq.description,
      acceptanceCriteria:
        currentCriteria.length > 0 ? currentCriteria : undefined,
      priority: currentReq.priority,
    });
  }

  return requirements;
}

export function parseInlineRequirements(requirements: string[]): Requirement[] {
  return requirements.map((desc, i) => ({
    id: `req-${i + 1}`,
    description: desc,
  }));
}
