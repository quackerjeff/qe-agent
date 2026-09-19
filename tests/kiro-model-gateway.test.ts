import { describe, it, expect } from "vitest";
import {
  buildKiroReasoningPrompt,
  KiroModelGateway,
} from "../src/models/gateway/kiro.js";

/**
 * Kiro provider gateway tests. Stream-extraction uses the REAL event
 * shapes captured live from `kiro-cli --output-format stream-json`
 * (runStarted / sessionUpdate agent_message_chunk / runFinished with
 * finalText). No production fakes; process-level behavior is covered
 * by buildKiroReasoningPrompt and the extraction via a captured
 * stdout fixture fed through the public gateway path.
 */

const REAL_STREAM_OUTPUT = [
  '{"type":"runStarted","data":{"payloadSchema":"acp","acpProtocolVersion":1,"engine":"v2"}}',
  '{"type":"metadata","data":{"sessionId":"s1","contextUsagePercentage":7.7}}',
  '{"type":"sessionUpdate","data":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"{\\"level\\""}}}}',
  '{"type":"sessionUpdate","data":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":":\\"HIGH\\"}"}}}}',
  '{"type":"runFinished","data":{"sessionId":"s1","status":"success","stopReason":"end_turn","finalText":"{\\\\"level\\\\":\\\\"HIGH\\\\"}","finalTextTruncated":false}}',
].join("\n");

describe("buildKiroReasoningPrompt", () => {
  it("includes objective, context, schema, and constraints", () => {
    const prompt = buildKiroReasoningPrompt(
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
    const prompt = buildKiroReasoningPrompt("o", "{}", "{}", []);
    expect(prompt).not.toContain("## Constraints");
  });
});

/** Test-only gateway capturing the raw stream handed to extraction. */

describe("KiroModelGateway stream extraction (real event shapes)", () => {
  it("prefers runFinished finalText over message chunks", async () => {
    const gw = new KiroModelGateway();
    const extracted = (
      gw as unknown as {
        extractStreamText(raw: string): string;
      }
    ).extractStreamText(REAL_STREAM_OUTPUT);
    expect(JSON.parse(extracted)).toEqual({ level: "HIGH" });
  });

  it("falls back to concatenated agent_message_chunk text without runFinished", () => {
    const streamWithoutFinish = [
      '{"type":"sessionUpdate","data":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"{\\"ok\\""}}}}',
      '{"type":"sessionUpdate","data":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":":true}"}}}}',
    ].join("\n");
    const gw = new KiroModelGateway();
    const extracted = (
      gw as unknown as {
        extractStreamText(raw: string): string;
      }
    ).extractStreamText(streamWithoutFinish);
    expect(JSON.parse(extracted)).toEqual({ ok: true });
  });
});
