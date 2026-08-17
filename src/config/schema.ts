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
      baseUrl: z.string().optional(),
      allowedOrigins: z.array(z.string()).optional(),
      headless: z.boolean().default(true),
    })
    .default({}),

  github: z
    .object({
      blockOnFail: z.boolean().default(true),
      createIssues: z.boolean().default(true),
    })
    .default({}),

  memory: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({}),

  model: z
    .object({
      provider: z.string().default("openai"),
      model: z.string().default("gpt-4o"),
    })
    .default({}),

  reasoning: z
    .object({
      maxModelCalls: z.number().positive().default(12),
    })
    .default({}),
});

export type QEConfig = z.infer<typeof QEConfigSchema>;
