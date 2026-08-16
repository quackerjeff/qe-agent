# QE Agent — Evaluation Fixtures

This directory contains controlled fixture repositories used to evaluate QE Agent effectiveness.

## Purpose

Fixture repositories are small, self-contained projects with known behaviors and intentionally seeded defects. They serve as the evaluation suite for the QE Agent itself.

The QE Agent cannot improve reliably if its quality is evaluated only through anecdotes. These fixtures provide deterministic, repeatable evaluation targets.

## Planned Structure

Each fixture represents a specific ecosystem and scenario:

```
fixtures/
    node-good/           # Correct Node.js/TypeScript project
    node-regression/     # Node.js project with seeded regression
    python-good/         # Correct Python project
    python-regression/   # Python project with seeded defect
    dotnet-good/         # Correct .NET project
    dotnet-regression/   # .NET project with seeded defect
    browser-good/        # Correct browser application
    browser-regression/  # Browser app with seeded regression
```

## Evaluation Criteria

Each fixture should enable measurement of whether the QE Agent:

- detects the intended defect (true positive);
- avoids false positives;
- selects useful validation actions;
- generates valid tests when appropriate;
- correctly classifies risk;
- correctly determines a verdict;
- identifies important test gaps;
- stays within its execution budget.

## Adding Fixtures

When implementing a QE capability, add or update evaluation fixtures that exercise the new behavior. Each fixture should document:

1. what the project represents;
2. what defects or gaps are seeded;
3. what the expected QE Agent behavior is;
4. what verdict is expected.

Fixtures will be built incrementally alongside QE Agent milestones.
