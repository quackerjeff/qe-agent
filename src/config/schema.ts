import { z } from "zod";

// Configuration schema per Technical Product Specification section 55.
// All sections defined here match the approved MVP configuration surface.
// Some sections (browser, github, memory, model) define configuration that
// is accepted and validated now but whose runtime behavior is implemented
// in later milestones. This is intentional — configuration may be present
// before the corresponding capability exists.
export const QEConfigSchema = z.object({
  version: z.literal(1),

  profile: z.enum(["quick", "standard", "deep"]).default("standard"),

  execution: z
    .object({
      mode: z.enum(["auto", "local", "docker"]).default("auto"),
      maxMinutes: z.number().positive().default(20),
      commandTimeoutSeconds: z.number().positive().default(300),
      maxOutputBytes: z.number().positive().default(1_048_576),
    })
    .default({}),

  tests: z
    .object({
      generation: z.boolean().default(true),
      commitPermanentTests: z.boolean().default(true),
    })
    .default({}),

  browser: z
    .object({
      enabled: z.union([z.literal("auto"), z.boolean()]).default("auto"),
      adapter: z.enum(["auto", "local", "mcp"]).default("auto"),
      mcpCommand: z.string().optional(),
      mcpArgs: z.array(z.string()).optional(),
      baseUrl: z.string().optional(),
      allowedOrigins: z.array(z.string()).optional(),
      headless: z.boolean().default(true),
    })
    .default({}),

  ci: z
    .object({
      failOn: z
        .array(
          z.enum([
            "PASS",
            "PASS_WITH_CONCERNS",
            "NEEDS_REVIEW",
            "FAIL",
            "BLOCKED",
          ]),
        )
        .default(["FAIL", "BLOCKED"]),
    })
    .default({}),

  github: z
    .object({
      checks: z
        .object({
          enabled: z.boolean().default(true),
        })
        .default({}),
      issues: z
        .object({
          enabled: z.boolean().default(false),
          minimumSeverity: z
            .enum([
              "BLOCKER",
              "CRITICAL",
              "HIGH",
              "MEDIUM",
              "LOW",
              "INFORMATIONAL",
            ])
            .default("HIGH"),
          minimumConfidence: z.number().min(0).max(1).default(0.8),
        })
        .default({}),
      dryRun: z.boolean().default(false),
    })
    .default({}),

  opencode: z
    .object({
      // Deliver QE summaries into an OpenCode session (ADR-011).
      messageEnabled: z.boolean().default(true),
      toastEnabled: z.boolean().default(true),
      dryRun: z.boolean().default(false),
    })
    .default({}),

  memory: z
    .object({
      enabled: z.boolean().default(true),
      historySummaries: z.boolean().default(true),
    })
    .default({}),

  model: z
    .object({
      provider: z.string().default("openai"),
      model: z.string().default("gpt-4o"),
      // OpenAI-compatible base URL (local llama.cpp/llama-swap, ollama,
      // vLLM, ...). When unset, the provider SDK default is used.
      baseUrl: z.string().url().optional(),
      tokenLimit: z.number().positive().optional(),
      tpmLimit: z.number().positive().optional(),
    })
    .default({}),

  reasoning: z
    .object({
      maxModelCalls: z.number().positive().default(12),
    })
    .default({}),
});

export type QEConfig = z.infer<typeof QEConfigSchema>;
