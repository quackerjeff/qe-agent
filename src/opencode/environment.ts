import { OpenCodeContextSchema, type OpenCodeContext } from "./types.js";

export interface EnvironmentSource {
  get(key: string): string | undefined;
}

export class ProcessEnvironmentSource implements EnvironmentSource {
  get(key: string): string | undefined {
    return process.env[key];
  }
}

/**
 * Detect whether QE Agent is running inside the OpenCode harness.
 * OpenCode exposes OPENCODE_SERVER_URL (server mode) and OPENCODE_BIN /
 * OPENCODE_CONFIG_DIR for its own processes.
 */
export function isOpenCodeHarness(env: EnvironmentSource): boolean {
  return (
    env.get("OPENCODE_SERVER_URL") !== undefined ||
    env.get("OPENCODE_BIN") !== undefined
  );
}

/**
 * Build an OpenCode context from the environment.
 * Requires an explicit target session ID (QE_OPENCODE_SESSION_ID) so QE
 * results are never delivered into an arbitrary session.
 */
export function parseOpenCodeContext(
  env: EnvironmentSource,
): OpenCodeContext | null {
  const sessionId = env.get("QE_OPENCODE_SESSION_ID");
  if (!sessionId) return null;

  const raw: Record<string, unknown> = { sessionId };

  const serverUrl = env.get("OPENCODE_SERVER_URL");
  if (serverUrl) raw.serverUrl = serverUrl;

  const username = env.get("OPENCODE_SERVER_USERNAME");
  if (username) raw.username = username;

  const password = env.get("OPENCODE_SERVER_PASSWORD");
  if (password) raw.password = password;

  const result = OpenCodeContextSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function getOpenCodeServerPassword(
  env: EnvironmentSource,
): string | undefined {
  return env.get("OPENCODE_SERVER_PASSWORD");
}
