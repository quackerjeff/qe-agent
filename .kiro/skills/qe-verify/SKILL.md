---
name: qe-verify
description: Run the QE Agent verification against a requirements Markdown file and report an evidence-backed verdict. Use when asked to verify requirements, validate a repository against acceptance criteria, or produce a QE verdict.
---

## QE Verification Workflow

1. Locate the requirements file (ask the user if not specified).
2. Run the QE Agent CLI:

```bash
npx tsx src/cli/main.ts verify --requirements <requirements-file> --json
```

Options: `--repo <path>`, `--profile quick|standard|deep`.

3. Parse the JSON result and report:
   - **Verdict** and confidence (PASS, PASS_WITH_CONCERNS, NEEDS_REVIEW, FAIL, BLOCKED)
   - **Evidence**: which commands/tests actually executed and their status
   - **Findings**: severity, category, confidence per finding
   - **Requirements**: per-requirement status (VERIFIED, NOT_VERIFIED, ...)
   - **Remaining gaps**

## Rules

- Never fabricate or soften the verdict — report what the JSON says.
- A passing test suite alone does not verify a requirement the suite does not
  cover; QE reports this as NOT_VERIFIED and so should you.
- Do not modify the repository to make validation pass.
- If the run fails to start (missing model endpoint, broken environment),
  report the environmental failure honestly — do not guess a verdict.