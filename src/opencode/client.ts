import type {
  MessageSendRequest,
  MessageSendResponse,
  SessionCreateResponse,
} from "./types.js";

export interface OpenCodeClient {
  createSession(title?: string): Promise<SessionCreateResponse>;
  sendMessage(request: MessageSendRequest): Promise<MessageSendResponse>;
  showToast(message: string, variant: "success" | "error"): Promise<boolean>;
}

export interface RecordedSessionCreate {
  title: string | undefined;
  response: SessionCreateResponse;
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
  public sessionCreations: RecordedSessionCreate[] = [];
  public messages: RecordedMessage[] = [];
  public toasts: RecordedToast[] = [];
  public sendAttempts = 0;
  public shouldFailMessage = false;
  public shouldFailSession = false;
  public failureError?: Error;

  private sessionCounter = 1;
  private messageCounter = 1;

  async createSession(title?: string): Promise<SessionCreateResponse> {
    if (this.shouldFailSession) {
      throw (
        this.failureError ??
        new OpenCodeApiError("Session creation failed", 500, true)
      );
    }

    const response: SessionCreateResponse = {
      sessionId: `sess-fake-${this.sessionCounter++}`,
      title: title ?? "Untitled",
    };
    this.sessionCreations.push({ title, response });
    return response;
  }

  async sendMessage(request: MessageSendRequest): Promise<MessageSendResponse> {
    this.sendAttempts++;
    if (this.shouldFailMessage) {
      throw (
        this.failureError ??
        new OpenCodeApiError("Message send failed", 500, true)
      );
    }

    const response: MessageSendResponse = {
      messageId: `msg-fake-${this.messageCounter++}`,
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
