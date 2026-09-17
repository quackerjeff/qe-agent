import { describe, it, expect } from "vitest";
import {
  buildOpenCodeReasoningPrompt,
  OpenCodeModelGateway,
} from "../src/models/gateway/opencode.js";

/**
 * OpenCode provider gateway tests. Event shapes reflect the real
 * `opencode run --format json` JSON-lines output (assistant text parts
 * across part/update/message events). No production fakes; extraction
 * is exercised through the public gateway path with captured shapes.
 */

describe("buildOpenCodeReasoningPrompt", () => {
  it("includes objective, context, schema, and constraints", () => {
    const prompt = buildOpenCodeReasoningPrompt(
      "Assess risk.",
      '{"repo":"python"}',
      '{"type":"object"}',
      ["Cite evidence."],
    );
    expect(prompt).toContain("JSON only");
    expect(prompt).toContain("## Objective\nAssess risk.");
    expect(prompt).toContain('## Context\n{"repo":"python"}');
    expect(prompt).toContain(
      '## Output schema (JSON Schema)\n{"type":"object"}',
    );
    expect(prompt).toContain("- Cite evidence.");
  });

  it("omits the constraints section when none are given", () => {
    const prompt = buildOpenCodeReasoningPrompt("o", "{}", "{}", []);
    expect(prompt).not.toContain("## Constraints");
  });
});

describe("OpenCodeModelGateway event extraction", () => {
  it("extracts assistant text from part events", () => {
    const gw = new OpenCodeModelGateway();
    const raw = [
      '{"type":"session.updated","part":{"type":"text","text":"{\\"level\\":"}}',
      '{"type":"session.updated","part":{"type":"text","text":"\\"HIGH\\"}"}}',
    ].join("\n");
    const extracted = (
      gw as unknown as { extractRunText(r: string): string }
    ).extractRunText(raw);
    expect(JSON.parse(extracted)).toEqual({ level: "HIGH" });
  });

  it("extracts assistant text from data.message content", () => {
    const gw = new OpenCodeModelGateway();
    const raw = [
      '{"data":{"message":{"role":"assistant","content":[{"type":"text","text":"{\\"ok\\":true}"}]}}}',
    ].join("\n");
    const extracted = (
      gw as unknown as { extractRunText(r: string): string }
    ).extractRunText(raw);
    expect(JSON.parse(extracted)).toEqual({ ok: true });
  });

  it("extracts only assistant text when user and assistant messages both exist", () => {
    const gw = new OpenCodeModelGateway();
    const raw = [
      '{"data":{"message":{"role":"user","content":[{"type":"text","text":"the prompt"}]}}}',
      '{"data":{"message":{"role":"assistant","content":[{"type":"text","text":"{\\"ok\\":true}"}]}}}',
    ].join("\n");
    const extracted = (
      gw as unknown as { extractRunText(r: string): string }
    ).extractRunText(raw);
    expect(JSON.parse(extracted)).toEqual({ ok: true });
    expect(extracted).not.toContain("the prompt");
  });

  it("falls back to raw text when no events parse", () => {
    const gw = new OpenCodeModelGateway();
    const raw = "not json lines at all";
    const extracted = (
      gw as unknown as { extractRunText(r: string): string }
    ).extractRunText(raw);
    expect(extracted).toBe("not json lines at all");
  });
});
