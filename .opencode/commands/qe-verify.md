---
description: Run QE verification against the requirements file at $ARGUMENTS
agent: qe
subtask: true
---
Run QE Agent verification against the requirements file $ARGUMENTS
(a Markdown file with headings as requirement titles and bullets as
acceptance criteria):

!`npx tsx src/cli/main.ts verify --requirements $ARGUMENTS --json`

Report the verdict, confidence, per-requirement status, executed evidence,
findings, and remaining gaps. Do not modify any files.