import { z } from "zod";

export const Mutability = z.enum([
  "READ_ONLY",
  "TEST_ARTIFACTS",
  "REPOSITORY_WRITE",
]);
export type Mutability = z.infer<typeof Mutability>;

export const NetworkPolicy = z.enum(["NONE", "RESTRICTED", "ALLOWED"]);
export type NetworkPolicy = z.infer<typeof NetworkPolicy>;

export const TerminationReason = z.enum([
  "COMPLETED",
  "TIMED_OUT",
  "POLICY_DENIED",
  "SPAWN_FAILED",
  "TERMINATED",
]);
export type TerminationReason = z.infer<typeof TerminationReason>;

export const PolicyOutcome = z.enum(["ALLOWED", "DENIED", "REQUIRES_APPROVAL"]);
export type PolicyOutcome = z.infer<typeof PolicyOutcome>;

export const ExecutorType = z.enum(["local", "docker"]);
export type ExecutorType = z.infer<typeof ExecutorType>;

export const ExecutionMode = z.enum(["local", "docker", "auto"]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const CommandProposalSchema = z.object({
  executable: z.string().min(1),
  args: z.array(z.string()),
  workingDirectory: z.string().min(1),
  environment: z.record(z.string()).optional(),
  timeoutMs: z.number().positive(),
  purpose: z.string().min(1),
  mutability: Mutability,
  network: NetworkPolicy,
});
export type CommandProposal = z.infer<typeof CommandProposalSchema>;

export const ExecutionContextSchema = z.object({
  repositoryRoot: z.string().min(1),
  executionMode: ExecutionMode,
  secrets: z.array(z.string()).default([]),
  maxOutputBytes: z.number().positive().default(1_048_576),
  dockerImage: z.string().optional(),
});
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

export const TruncationInfoSchema = z.object({
  stdout: z.boolean(),
  stderr: z.boolean(),
});

export const ExecutionResultSchema = z.object({
  executionId: z.string().min(1),
  command: z.object({
    executable: z.string(),
    args: z.array(z.string()),
    workingDirectory: z.string(),
  }),
  executor: ExecutorType,
  startTime: z.string(),
  endTime: z.string(),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().nullable(),
  terminationReason: TerminationReason,
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  policyOutcome: PolicyOutcome,
  truncated: TruncationInfoSchema,
  secretsRedacted: z.boolean(),
  networkPolicy: NetworkPolicy,
  networkPolicyEnforced: z.boolean(),
  purpose: z.string(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export interface Executor {
  readonly type: ExecutorType;
  execute(
    proposal: CommandProposal,
    context: ExecutionContext,
  ): Promise<ExecutionResult>;
  available(): Promise<boolean>;
}

export interface PolicyResult {
  outcome: PolicyOutcome;
  reason: string;
}
