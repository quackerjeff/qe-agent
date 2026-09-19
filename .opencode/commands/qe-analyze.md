---
description: Run QE Agent analysis of the repository and report capabilities
agent: qe
subtask: true
---
Run the QE Agent repository analysis:

!`npx tsx src/cli/main.ts analyze --json`

Report the detected languages, frameworks, test frameworks, available
commands, and QE capabilities. Do not modify any files.