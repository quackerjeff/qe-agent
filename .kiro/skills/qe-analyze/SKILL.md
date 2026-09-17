---
name: qe-analyze
description: Run the QE Agent repository analysis and report detected languages, frameworks, test frameworks, commands, and capabilities. Use when asked to analyze a repository's structure or QE capabilities.
---

## QE Repository Analysis Workflow

1. Run the QE Agent CLI:

```bash
npx tsx src/cli/main.ts analyze --repo <path> --json
```

2. Parse the JSON result and report:
   - **Detected ecosystems**: languages, frameworks, package managers with confidence
   - **Test frameworks** and discovered commands (with execution support)
   - **Capabilities** available to the QE Agent
   - Any nested projects detected

## Rules

- Analysis is read-only; report the JSON as-is.
- Do not modify any files.