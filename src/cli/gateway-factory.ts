import type { QEConfig } from "../config/index.js";
import type { ModelGateway } from "../models/gateway/types.js";
import { OpenAIModelGateway } from "../models/gateway/openai.js";
import { OpenCodeModelGateway } from "../models/gateway/opencode.js";

const KNOWN_MODEL_TOKEN_LIMITS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
};

export function createModelGateway(config: QEConfig): ModelGateway {
  const provider = config.model.provider;

  // Secrets and environment-specific values (endpoints, model names) may
  // be supplied via environment variables so that committed .qe/config.yml
  // files never contain addresses, keys, or local model names:
  //   QE_MODEL_BASE_URL  — overrides model.baseUrl
  //   QE_MODEL           — overrides model.model
  //   OPENAI_API_KEY     — provider API key (already standard)
  const baseURL = process.env.QE_MODEL_BASE_URL ?? config.model.baseUrl;
  const model = process.env.QE_MODEL ?? config.model.model;

  switch (provider) {
    case "openai":
    case "default":
      return new OpenAIModelGateway({
        model,
        apiKey: process.env.OPENAI_API_KEY ?? "local",
        baseURL,
      });
    case "opencode":
      // OpenCode-harness invocations: QE reasoning runs through the real
      // opencode CLI (headless), using OpenCode's own configured model
      // and authentication. No endpoint or key configuration exists
      // here — OpenCode owns it.
      return new OpenCodeModelGateway({
        executable: process.env.QE_OPENCODE_CLI ?? "opencode",
      });
    default:
      throw new Error(
        `Unsupported model provider '${provider}'. Currently supported: openai, opencode`,
      );
  }
}

export function resolveModelTokenLimit(config: QEConfig): number | undefined {
  if (config.model.tokenLimit) {
    return config.model.tokenLimit;
  }
  return KNOWN_MODEL_TOKEN_LIMITS[process.env.QE_MODEL ?? config.model.model];
}

export function resolveModelTpmLimit(config: QEConfig): number | undefined {
  return config.model.tpmLimit;
}
