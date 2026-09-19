import type { EnvironmentSource } from "../../src/opencode/environment.js";
import type { OpenCodeClient } from "../../src/opencode/client.js";
import type {
  MessageSendRequest,
  MessageSendResponse,
} from "../../src/opencode/types.js";
import { OpenCodeApiError } from "../../src/opencode/client.js";

/**
 * Test-only stubs for the OpenCode integration. These live outside
 * production code — the shipped CLI uses only the real
 * HttpOpenCodeClient against a running OpenCode server.
 */

export class StubEnvironmentSource implements EnvironmentSource {
  constructor(private readonly vars: Record<string, string> = {}) {}

  get(key: string): string | undefined {
    return this.vars[key];
  }
}

export interface StubRecordedMessage {
  request: MessageSendRequest;
  response: MessageSendResponse;
}

export interface StubRecordedToast {
  message: string;
  variant: "success" | "error";
}

export class StubOpenCodeClient implements OpenCodeClient {
  public messages: StubRecordedMessage[] = [];
  public toasts: StubRecordedToast[] = [];
  public sendAttempts = 0;
  public shouldFailMessage = false;
  public failWithServerError = false;
  public failureError?: Error;

  async sendMessage(request: MessageSendRequest): Promise<MessageSendResponse> {
    this.sendAttempts++;
    if (this.shouldFailMessage) {
      throw (
        this.failureError ??
        new OpenCodeApiError(
          "Message send failed",
          this.failWithServerError ? 500 : 400,
          this.failWithServerError,
        )
      );
    }

    const response: MessageSendResponse = {
      messageId: `msg-stub-${this.sendAttempts}`,
      delivered: true,
    };
    this.messages.push({ request, response });
    return response;
  }

  async showToast(
    message: string,
    variant: "success" | "error",
  ): Promise<boolean> {
    this.toasts.push({ message, variant });
    return true;
  }
}
