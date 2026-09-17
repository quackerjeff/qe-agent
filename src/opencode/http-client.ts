import type { MessageSendRequest, MessageSendResponse } from "./types.js";
import type { OpenCodeClient } from "./client.js";
import { OpenCodeApiError } from "./client.js";

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

export interface HttpRequestFn {
  (
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      timeoutMs?: number;
      maxResponseBytes?: number;
    },
  ): Promise<{ status: number; json(): Promise<unknown> }>;
}

async function nodeFetch(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
  },
): Promise<{ status: number; json(): Promise<unknown> }> {
  const https = await import("node:https");
  const http = await import("node:http");
  const { URL } = await import("node:url");

  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const reqModule = isHttps ? https : http;
    const req = reqModule.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: options.headers,
      },
      (res: import("node:http").IncomingMessage) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            res.destroy();
            req.destroy();
            reject(new Error(`Response body exceeded ${maxBytes} bytes limit`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            json: () => Promise.resolve(JSON.parse(body)),
          });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * HTTP client for the OpenCode server API (https://opencode.ai/docs/server).
 * Endpoints used:
 *   POST /session/:id/prompt_async     — send message without waiting
 *   POST /tui/show-toast               — desktop-style notification (TUI)
 */
export class HttpOpenCodeClient implements OpenCodeClient {
  private readonly baseUrl: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly httpRequest: HttpRequestFn;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(
    serverUrl: string,
    auth?: { username?: string; password?: string },
    httpRequest?: HttpRequestFn,
    timeoutMs?: number,
    maxResponseBytes?: number,
  ) {
    this.baseUrl = serverUrl.replace(/\/$/, "");
    this.username = auth?.username;
    this.password = auth?.password;
    this.httpRequest = httpRequest ?? nodeFetch;
    this.timeoutMs = timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    this.maxResponseBytes = maxResponseBytes ?? MAX_RESPONSE_BYTES;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "qe-agent",
    };
    if (this.password) {
      const creds = `${this.username ?? "opencode"}:${this.password}`;
      headers.Authorization = `Basic ${Buffer.from(creds).toString("base64")}`;
    }
    return headers;
  }

  private async request(
    url: string,
    method: string,
    body?: string,
  ): Promise<unknown> {
    try {
      const res = await this.httpRequest(url, {
        method,
        headers: this.headers(),
        body,
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
      });

      if (res.status === 403 || res.status === 429) {
        throw new OpenCodeApiError("API request rejected", res.status, true);
      }

      if (res.status < 200 || res.status >= 300) {
        throw new OpenCodeApiError(
          `OpenCode server request failed with status ${res.status}`,
          res.status,
          res.status >= 500,
        );
      }

      return await res.json();
    } catch (err) {
      if (err instanceof OpenCodeApiError) throw err;
      throw new OpenCodeApiError(
        err instanceof Error ? err.message : "HTTP request failed",
        0,
        false,
      );
    }
  }

  async sendMessage(request: MessageSendRequest): Promise<MessageSendResponse> {
    // Use prompt_async so QE delivery does not block on an LLM response.
    const body = JSON.stringify({
      parts: [{ type: "text", text: request.text }],
    });
    await this.request(
      `${this.baseUrl}/session/${encodeURIComponent(request.sessionId)}/prompt_async`,
      "POST",
      body,
    );
    return { messageId: "async", delivered: true };
  }

  async showToast(
    message: string,
    variant: "success" | "error",
  ): Promise<boolean> {
    const body = JSON.stringify({ message, variant });
    await this.request(`${this.baseUrl}/tui/show-toast`, "POST", body);
    return true;
  }
}
