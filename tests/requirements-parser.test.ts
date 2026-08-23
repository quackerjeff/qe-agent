import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  parseRequirementsText,
  parseRequirementsFile,
  parseInlineRequirements,
} from "../src/cli/requirements-parser.js";

describe("Requirements Parser — Structured Document Mode", () => {
  it("FR-001 heading becomes a requirement", () => {
    const text = `
# 7. Functional Requirements

## FR-001 Repository Detection

The system SHALL automatically inspect an unfamiliar repository.

- Must identify languages
- Must identify frameworks
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("FR-001");
    expect(reqs[0].description).toBe("FR-001 Repository Detection");
    expect(reqs[0].acceptanceCriteria).toHaveLength(2);
    expect(reqs[0].acceptanceCriteria![0].id).toBe("FR-001-ac-1");
    expect(reqs[0].acceptanceCriteria![0].description).toBe(
      "Must identify languages",
    );
  });

  it("FR-035A heading becomes a requirement", () => {
    const text = `
## FR-035 Execution Budgets

- Must enforce time limits

## FR-035A Token and Cost Telemetry

- Must track token usage
- Must report cost metrics
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe("FR-035");
    expect(reqs[1].id).toBe("FR-035A");
    expect(reqs[1].description).toBe("FR-035A Token and Cost Telemetry");
    expect(reqs[1].acceptanceCriteria).toHaveLength(2);
  });

  it("section title does not become a requirement", () => {
    const text = `
# 1. Executive Summary

The QE Agent is an autonomous system.

- understands the application;
- identifies quality risks;

# 7. Functional Requirements

## FR-001 Repository Detection

- Must identify languages
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("FR-001");
  });

  it("subsection title does not become a requirement", () => {
    const text = `
# 3. Product Principles

## 3.1 Quality is more than test execution

Running an existing test suite is only one source of quality evidence.

## 3.2 Risk determines effort

- authentication changes;
- financial calculations;

## FR-001 Repository Detection

- Must identify languages
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("FR-001");
  });

  it("### PASS does not become a requirement", () => {
    const text = `
## FR-028 Quality Verdict

The system SHALL produce a QE verdict.

### PASS

Strong evidence supports expected behavior.

### PASS WITH CONCERNS

Tests pass but material concerns remain.

### FAIL

A material defect has been demonstrated.

## FR-029 GitHub Pull Request Integration

- Must support PR-oriented execution
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe("FR-028");
    expect(reqs[1].id).toBe("FR-029");
  });

  it("bullets beneath an FR become acceptance criteria", () => {
    const text = `
## FR-003 Existing Test Discovery

The system SHALL locate existing:

- unit tests;
- integration tests;
- end-to-end tests;
- API tests;

The system SHALL determine how each test category is normally executed.
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].acceptanceCriteria).toHaveLength(4);
    expect(reqs[0].acceptanceCriteria![0].description).toBe("unit tests;");
  });

  it("nested ### headings beneath an FR become acceptance criteria, not top-level requirements", () => {
    const text = `
## FR-028 Quality Verdict

The system SHALL produce a QE verdict.

### PASS

Strong evidence supports the expected behavior.

### BLOCKED

The agent could not obtain enough evidence.

## FR-029 GitHub Pull Request Integration

- Must support PR execution
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(2);

    expect(reqs[0].id).toBe("FR-028");
    expect(reqs[0].acceptanceCriteria).toBeDefined();
    const acDescs = reqs[0].acceptanceCriteria!.map((ac) => ac.description);
    expect(acDescs).toContain("PASS");
    expect(acDescs).toContain("BLOCKED");

    expect(reqs[1].id).toBe("FR-029");
  });

  it("parsing the QE Agent PRD yields 38 FR requirements", async () => {
    const prdPath = resolve(
      "docs/Automated QE Agent — Product & Functional Requirements.md",
    );
    const reqs = await parseRequirementsFile(prdPath);

    expect(reqs).toHaveLength(38);

    expect(reqs[0].id).toBe("FR-001");
    expect(reqs[0].description).toBe("FR-001 Repository Detection");

    const fr035a = reqs.find((r) => r.id === "FR-035A");
    expect(fr035a).toBeDefined();
    expect(fr035a!.description).toBe("FR-035A Token and Cost Telemetry");

    const fr037 = reqs.find((r) => r.id === "FR-037");
    expect(fr037).toBeDefined();

    const nonFR = reqs.filter((r) => !r.id.startsWith("FR-"));
    expect(nonFR).toHaveLength(0);

    const sectionTitle = reqs.find(
      (r) => r.description === "1. Executive Summary",
    );
    expect(sectionTitle).toBeUndefined();

    const principle = reqs.find(
      (r) =>
        r.description === "3.1 Quality is more than test execution" ||
        r.description.includes("Quality is more than"),
    );
    expect(principle).toBeUndefined();

    const verdictState = reqs.find(
      (r) => r.description === "PASS" || r.description === "BLOCKED",
    );
    expect(verdictState).toBeUndefined();
  });

  it("FR-028 nested headings become acceptance criteria", async () => {
    const prdPath = resolve(
      "docs/Automated QE Agent — Product & Functional Requirements.md",
    );
    const reqs = await parseRequirementsFile(prdPath);
    const fr028 = reqs.find((r) => r.id === "FR-028");
    expect(fr028).toBeDefined();
    expect(fr028!.acceptanceCriteria).toBeDefined();

    const acDescs = fr028!.acceptanceCriteria!.map((ac) => ac.description);
    expect(acDescs).toContain("PASS");
    expect(acDescs).toContain("BLOCKED");
    expect(acDescs).toContain("FAIL");
  });

  it("preserves priority annotations in structured mode", () => {
    const text = `
## FR-001 Repository Detection

- Must identify languages [priority: high]
- Must identify frameworks
`;
    const reqs = parseRequirementsText(text);
    expect(reqs[0].priority).toBe("high");
  });

  it("bullets under non-FR headings are ignored", () => {
    const text = `
# 3. Product Principles

## 3.2 Risk determines effort

- authentication changes;
- financial calculations;
- data migrations;

## FR-001 Repository Detection

- Must identify languages
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("FR-001");
    expect(reqs[0].acceptanceCriteria).toHaveLength(1);
  });

  it("multiple FR requirements are parsed in order", () => {
    const text = `
# 7. Functional Requirements

## FR-001 Repository Detection

- Identify languages

## FR-002 Project Instruction Discovery

- Read README files

## FR-003 Existing Test Discovery

- Locate unit tests
- Locate integration tests
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(3);
    expect(reqs[0].id).toBe("FR-001");
    expect(reqs[1].id).toBe("FR-002");
    expect(reqs[2].id).toBe("FR-003");
    expect(reqs[2].acceptanceCriteria).toHaveLength(2);
  });
});

describe("Requirements Parser — Simple Document Mode (backward compatibility)", () => {
  it("parses simple markdown with # headings as requirements", () => {
    const text = `
# User Authentication
- Users must log in with email and password
- Password must be at least 8 characters

# Data Export
- Users can export data as CSV
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe("req-1");
    expect(reqs[0].description).toBe("User Authentication");
    expect(reqs[0].acceptanceCriteria).toHaveLength(2);
    expect(reqs[1].id).toBe("req-2");
    expect(reqs[1].description).toBe("Data Export");
  });

  it("parses ## headings in simple mode", () => {
    const text = `
## API must respond in under 200ms
- GET /users returns 200
- POST /users returns 201

## Error responses include codes
`;
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe("req-1");
    expect(reqs[1].id).toBe("req-2");
  });

  it("handles priority annotations in simple mode", () => {
    const text = `
# Feature
- Must be fast [priority: high]
`;
    const reqs = parseRequirementsText(text);
    expect(reqs[0].priority).toBe("high");
  });

  it("inline requirements still work", () => {
    const reqs = parseInlineRequirements([
      "Users must be able to log in",
      "Admin panel requires authentication",
    ]);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe("req-1");
    expect(reqs[1].id).toBe("req-2");
  });

  it("plain text without headings becomes a requirement in simple mode", () => {
    const text = "The system must handle errors gracefully";
    const reqs = parseRequirementsText(text);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].description).toBe(
      "The system must handle errors gracefully",
    );
  });
});
