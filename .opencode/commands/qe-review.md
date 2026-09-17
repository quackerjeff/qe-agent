---
description: Run QE change review against the Git baseline at $ARGUMENTS (default: main)
agent: qe
subtask: true
---
Run QE Agent change review against the baseline $ARGUMENTS:

!`npx tsx src/cli/main.ts review --base $ARGUMENTS --json`

Report the verdict, change analysis, failure classifications
(INTRODUCED, PRE_EXISTING, UNKNOWN), findings, and remaining gaps.
Do not modify any files.