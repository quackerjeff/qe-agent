import type { MessageSendRequest, MessageSendResponse } from "./types.js";

export interface OpenCodeClient {
  sendMessage(request: MessageSendRequest): Promise<MessageSendResponse>;
  showToast(message: string, variant: "success" | "error"): Promise<boolean>;
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
