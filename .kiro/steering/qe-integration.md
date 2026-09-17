---
inclusion: always
---

# QE Agent Integration

This repository ships a QE Agent (autonomous Quality Engineering system) CLI.
When asked to validate, verify, or review code quality:

- Use the `qe` agent profile (`.kiro/agents/qe.md`) or run the CLI directly:
  `npx tsx src/cli/main.ts <command> --json`
- Available commands: `analyze`, `verify --requirements <file>`,
  `review --base <ref>`, `kiro publish --result <file>`.
- Verdicts are evidence-based and deterministic: PASS, PASS_WITH_CONCERNS,
  NEEDS_REVIEW, FAIL, BLOCKED.
- Never fabricate or soften a verdict; report the QE result as-is.
- Model endpoints and keys live in the git-ignored `.env` file — never commit
  addresses, keys, or model names.