const REDACTED = "[REDACTED]";

export function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    while (result.includes(secret)) {
      result = result.replace(secret, REDACTED);
    }
  }
  return result;
}

export function redactArgs(args: string[], secrets: string[]): string[] {
  if (secrets.length === 0) return args;
  return args.map((arg) => redactSecrets(arg, secrets));
}

export function redactRecord(
  record: Record<string, string> | undefined,
  secrets: string[],
): Record<string, string> | undefined {
  if (!record || secrets.length === 0) return record;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(record)) {
    result[key] = redactSecrets(val, secrets);
  }
  return result;
}
