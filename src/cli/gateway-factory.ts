import type { QEConfig } from "../config/index.js";
import type { ModelGateway } from "../models/gateway/types.js";
import { OpenAIModelGateway } from "../models/gateway/openai.js";

const KNOWN_MODEL_TOKEN_LIMITS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
};

export function createModelGateway(config: QEConfig): ModelGateway {
  const provider = config.model.provider;
  const model = config.model.model;

  switch (provider) {
    case "openai":
    case "default":
      return new OpenAIModelGateway({
        model,
        apiKey: process.env.OPENAI_API_KEY ?? "local",
        baseURL: config.model.baseUrl,
      });
    default:
      throw new Error(
        `Unsupported model provider '${provider}'. Currently supported: openai`,
      );
  }
}

export function resolveModelTokenLimit(config: QEConfig): number | undefined {
  if (config.model.tokenLimit) {
    return config.model.tokenLimit;
  }
  return KNOWN_MODEL_TOKEN_LIMITS[config.model.model];
}

export function resolveModelTpmLimit(config: QEConfig): number | undefined {
  return config.model.tpmLimit;
}
