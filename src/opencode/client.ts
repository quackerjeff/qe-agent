import type { MessageSendRequest, MessageSendResponse } from "./types.js";

export interface OpenCodeClient {
  sendMessage(request: MessageSendRequest): Promise<MessageSendResponse>;
  showToast(message: string, variant: "success" | "error"): Promise<boolean>;
}

export interface RecordedMessage {
  request: MessageSendRequest;
  response: MessageSendResponse;
}

export interface RecordedToast {
  message: string;
  variant: "success" | "error";
}

export class OpenCodeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly isServerError: boolean,
  ) {
    super(message);
    this.name = "OpenCodeApiError";
  }
}

export class FakeOpenCodeClient implements OpenCodeClient {
  public messages: RecordedMessage[] = [];
  public toasts: RecordedToast[] = [];
  public sendAttempts = 0;
  public shouldFailMessage = false;
  public failureError?: Error;

  async sendMessage(request: MessageSendRequest): Promise<MessageSendResponse> {
    this.sendAttempts++;
    if (this.shouldFailMessage) {
      throw (
        this.failureError ??
        new OpenCodeApiError("Message send failed", 500, true)
      );
    }

    const response: MessageSendResponse = {
      messageId: `msg-fake-${this.sendAttempts}`,
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
