import { describe, it, expect } from "vitest";
import { z } from "zod";
import { FakeModelGateway } from "../src/models/gateway/index.js";
import type { ReasoningTask } from "../src/models/gateway/index.js";

describe("FakeModelGateway", () => {
  it("returns configured response for matching role", async () => {
    const outputSchema = z.object({
      level: z.enum(["LOW", "HIGH"]),
      summary: z.string(),
    });

    const gateway = new FakeModelGateway((task) => {
      if (task.role === "risk_analyst") {
        return { level: "HIGH", summary: "High risk detected" };
      }
      return undefined;
    });

    const task: ReasoningTask<z.infer<typeof outputSchema>> = {
      role: "risk_analyst",
      objective: "Assess change risk",
      context: { files: ["auth.ts"] },
      outputSchema,
    };

    const result = await gateway.reason(task);
    expect(result.data.level).toBe("HIGH");
    expect(result.data.summary).toBe("High risk detected");
    expect(result.model).toBe("fake");
  });

  it("throws when no response configured", async () => {
    const gateway = new FakeModelGateway();

    const task: ReasoningTask<string> = {
      role: "unknown",
      objective: "Do something",
      context: {},
      outputSchema: z.string(),
    };

    await expect(gateway.reason(task)).rejects.toThrow(
      'no response configured for role="unknown"',
    );
  });

  it("records all calls", async () => {
    const gateway = new FakeModelGateway(() => "ok");

    const task: ReasoningTask<string> = {
      role: "test",
      objective: "Test call",
      context: { key: "value" },
      outputSchema: z.string(),
    };

    await gateway.reason(task);
    await gateway.reason(task);

    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[0].role).toBe("test");
  });

  it("validates response against schema", async () => {
    const schema = z.object({ count: z.number().positive() });

    const gateway = new FakeModelGateway(() => ({ count: -1 }));

    const task: ReasoningTask<z.infer<typeof schema>> = {
      role: "test",
      objective: "Test validation",
      context: {},
      outputSchema: schema,
    };

    await expect(gateway.reason(task)).rejects.toThrow();
  });

  it("returns zero usage for fake provider", async () => {
    const gateway = new FakeModelGateway(() => "result");

    const result = await gateway.reason({
      role: "test",
      objective: "Check usage",
      context: {},
      outputSchema: z.string(),
    });

    expect(result.usage.totalTokens).toBe(0);
    expect(result.durationMs).toBe(0);
  });
});
