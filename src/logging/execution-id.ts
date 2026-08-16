import { randomUUID } from "node:crypto";

export function createExecutionId(): string {
  return randomUUID();
}
