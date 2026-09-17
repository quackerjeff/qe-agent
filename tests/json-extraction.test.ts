import { describe, it, expect } from "vitest";
import { extractJsonContent } from "../src/models/gateway/openai.js";

/**
 * Real reasoning/local model output formats observed live against an
 * OpenAI-compatible endpoint (ollama serving a GLM reasoning model):
 * models wrap JSON in fences, emit <think> blocks, or embed JSON in
 * prose even when instructed to output bare JSON.
 */
describe("extractJsonContent", () => {
  const obj = `{"level":"HIGH","factors":[],"confidence":0.8,"summary":"s"}`;

  it("returns bare JSON unchanged", () => {
    expect(extractJsonContent(obj)).toBe(obj);
  });

  it("returns bare JSON array unchanged", () => {
    const arr = `[{"a":1},{"b":2}]`;
    expect(extractJsonContent(arr)).toBe(arr);
  });

  it("extracts from a json code fence", () => {
    const input = "```json\n" + obj + "\n```";
    expect(JSON.parse(extractJsonContent(input))).toEqual(JSON.parse(obj));
  });

  it("extracts from a plain code fence", () => {
    const input = "```\n" + obj + "\n```";
    expect(JSON.parse(extractJsonContent(input))).toEqual(JSON.parse(obj));
  });

  it("strips a reasoning block before the JSON", () => {
    const input = `Let me think.\n\n${obj}`;
    expect(JSON.parse(extractJsonContent(input))).toEqual(JSON.parse(obj));
  });

  it("strips a <thinking> block before the JSON", () => {
    const input = `<thinking>assess risk first</thinking>\n${obj}`;
    expect(JSON.parse(extractJsonContent(input))).toEqual(JSON.parse(obj));
  });

  it("extracts the first balanced object from surrounding prose", () => {
    const input = `Here is my assessment:\n\n${obj}\n\nI hope this helps.`;
    expect(JSON.parse(extractJsonContent(input))).toEqual(JSON.parse(obj));
  });

  it("extracts from prose with braces inside strings", () => {
    const tricky = `Result: {"summary":"uses {nested} braces","ok":true} — done.`;
    expect(JSON.parse(extractJsonContent(tricky))).toEqual({
      summary: "uses {nested} braces",
      ok: true,
    });
  });

  it("handles escaped quotes inside strings during balance scan", () => {
    const input = `The answer is {"text":"she said \\"hi\\"", "n":1} truly.`;
    expect(JSON.parse(extractJsonContent(input))).toEqual({
      text: 'she said "hi"',
      n: 1,
    });
  });

  it("returns the original text when nothing extractable exists", () => {
    const input = "no json here at all";
    expect(extractJsonContent(input)).toBe(input);
  });

  it("returns empty string for whitespace-only input", () => {
    expect(extractJsonContent("   \n  ")).toBe("");
  });

  it("does not corrupt JSON whose strings contain fence markers", () => {
    const input = `{"note":"not a \`\`\`real\`\`\` fence","ok":1}`;
    expect(JSON.parse(extractJsonContent(input))).toEqual({
      note: "not a ```real``` fence",
      ok: 1,
    });
  });
});
