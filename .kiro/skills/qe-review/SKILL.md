---
name: qe-review
description: Run the QE Agent change review against a Git baseline and report an evidence-backed verdict with failure classifications. Use when asked to review changes, review a branch, or compare against a baseline.
---

## QE Change Review Workflow

1. Identify the baseline ref (default: main).
2. Run the QE Agent CLI:

```bash
npx tsx src/cli/main.ts review --base <baseline-ref> --json
```

Options: `--target <ref>`, `--repo <path>`, `--profile quick|standard|deep`.

3. Parse the JSON result and report:
   - **Verdict** and confidence
   - **Change analysis**: what changed and the risk assessment
   - **Evidence**: which validations actually executed and their status
   - **Failure classifications**: INTRODUCED, PRE_EXISTING, or UNKNOWN per failure
   - **Findings** and **remaining gaps**

## Rules

- Never fabricate or soften the verdict — report what the JSON says.
- Do not modify the repository to make validation pass.