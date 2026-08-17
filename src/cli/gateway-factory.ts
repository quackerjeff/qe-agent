import type { QEConfig } from "../config/index.js";
import type { ModelGateway } from "../models/gateway/types.js";
import { OpenAIModelGateway } from "../models/gateway/openai.js";

export function createModelGateway(config: QEConfig): ModelGateway {
  const provider = config.model.provider;
  const model = config.model.model;

  switch (provider) {
    case "openai":
    case "default":
      return new OpenAIModelGateway({
        model,
        apiKey: process.env.OPENAI_API_KEY,
      });
    default:
      throw new Error(
        `Unsupported model provider '${provider}'. Currently supported: openai`,
      );
  }
}
