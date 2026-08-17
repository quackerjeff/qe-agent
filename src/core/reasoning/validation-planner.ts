import type { ModelGateway, ModelResult } from "../../models/gateway/types.js";
import type {
  ValidationPlan,
  ValidationAction,
  RiskAssessment,
  DiscoveredCommand,
  ExecutionProfile,
} from "../../types/index.js";
import type { ReasoningContext } from "../orchestrator/context-builder.js";
import {
  buildValidationPlanTask,
  type ValidationPlanOutput,
} from "../../prompts/validation-plan/v1.js";

export async function planValidation(
  gateway: ModelGateway,
  ctx: ReasoningContext,
  riskAssessment: RiskAssessment,
  profile: ExecutionProfile,
  discoveredCommands: DiscoveredCommand[],
): Promise<{
  plan: ValidationPlan;
  modelResult: ModelResult<ValidationPlanOutput>;
}> {
  const task = buildValidationPlanTask(
    ctx,
    {
      level: riskAssessment.level,
      factors: riskAssessment.factors,
      summary: riskAssessment.summary,
    },
    profile,
  );

  const modelResult = await gateway.reason(task);
  const output = modelResult.data;

  const commandMap = new Map(discoveredCommands.map((c) => [c.id, c]));

  const plannedActions: ValidationAction[] = output.recommendedActions
    .filter((a) => {
      if (a.type === "BROWSER") return true;
      const cmd = a.commandId ? commandMap.get(a.commandId) : undefined;
      return cmd && cmd.executionSupport === "STRUCTURED" && cmd.executable;
    })
    .sort((a, b) => a.priority - b.priority)
    .map((a) => {
      if (a.type === "BROWSER") {
        const action: ValidationAction & {
          browserActions?: unknown[];
        } = {
          id: a.commandId ?? `browser-${Date.now()}`,
          type: a.type,
          purpose: a.purpose,
          riskAddressed: a.riskAddressed,
          requirementIds: a.requirementIds,
          priority: a.priority,
        };
        if (a.browserActions) {
          action.browserActions = a.browserActions;
        }
        return action as ValidationAction;
      }
      const cmd = commandMap.get(a.commandId!)!;
      return {
        id: `action-${a.commandId}`,
        type: a.type,
        purpose: a.purpose,
        riskAddressed: a.riskAddressed,
        requirementIds: a.requirementIds,
        command: {
          executable: cmd.executable!,
          args: cmd.args ?? [],
          workingDirectory: ctx.repositoryProfile.root,
          timeoutMs: 300_000,
          purpose: a.purpose,
        },
        priority: a.priority,
      };
    });

  const plan: ValidationPlan = {
    objectives: output.objectives,
    plannedActions,
    identifiedRisks: output.identifiedRisks,
    expectedCapabilities: output.expectedCapabilities,
  };

  return { plan, modelResult };
}

export function applyProfileLimits(
  actions: ValidationAction[],
  profile: ExecutionProfile,
): ValidationAction[] {
  const limits: Record<string, number> = {
    quick: 3,
    standard: 8,
    deep: 20,
  };
  const max = limits[profile] ?? 8;
  return actions.slice(0, max);
}
