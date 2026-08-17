const DANGEROUS_SCHEMES = new Set([
  "file:",
  "javascript:",
  "data:",
  "ftp:",
  "blob:",
  "vbscript:",
]);

const DEFAULT_ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
]);

export interface UrlPolicyResult {
  allowed: boolean;
  reason: string;
}

export function evaluateUrlPolicy(
  url: string,
  allowedOrigins: string[],
): UrlPolicyResult {
  if (!url || url.trim().length === 0) {
    return { allowed: false, reason: "Empty URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: `Malformed URL: ${url}` };
  }

  if (DANGEROUS_SCHEMES.has(parsed.protocol)) {
    return {
      allowed: false,
      reason: `Dangerous URL scheme denied: ${parsed.protocol}`,
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      allowed: false,
      reason: `Unsupported URL scheme: ${parsed.protocol}`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (DEFAULT_ALLOWED_HOSTS.has(hostname)) {
    return { allowed: true, reason: "Localhost origin allowed" };
  }

  for (const origin of allowedOrigins) {
    try {
      const allowedHost = new URL(origin).hostname.toLowerCase();
      if (hostname === allowedHost) {
        return {
          allowed: true,
          reason: `Origin explicitly allowed: ${hostname}`,
        };
      }
    } catch {
      if (hostname === origin.toLowerCase()) {
        return {
          allowed: true,
          reason: `Origin explicitly allowed: ${hostname}`,
        };
      }
    }
  }

  return {
    allowed: false,
    reason: `External origin denied: ${hostname} is not in allowed origins`,
  };
}

export function isDangerousScheme(url: string): boolean {
  try {
    const parsed = new URL(url);
    return DANGEROUS_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}
