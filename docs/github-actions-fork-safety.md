# GitHub Actions Fork Safety

## Recommended Workflow for QE Agent

Use the `pull_request` event (not `pull_request_target`) for running QE Agent on PRs from forks. This ensures QE execution runs in the fork's context without access to privileged secrets.

```yaml
name: QE Agent
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

jobs:
  qe-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npx qe review --base ${{ github.event.pull_request.base.sha }} --json --ci
```

## Why Not `pull_request_target`?

`pull_request_target` runs in the **base** branch context with write-capable `GITHUB_TOKEN` and access to repository secrets. If the workflow checks out the PR head (`actions/checkout` with `ref: ${{ github.event.pull_request.head.sha }}`), it executes untrusted code from the fork with elevated privileges. This is a well-known supply chain attack vector.

**Do not** combine:
- `pull_request_target` trigger
- Checkout of untrusted PR head
- Privileged write-capable token
- Execution of PR-controlled code (tests, build scripts)

## Fork PR Token Availability

Fork PRs using `pull_request` do not receive a write-capable `GITHUB_TOKEN`. QE Agent handles this gracefully:

- QE execution (analysis, test running) works without a token
- Check and issue publishing require a token; without one, publication is skipped or dry-run
- Local result and summary files are still written under `.qe/`
- `GITHUB_STEP_SUMMARY` is still written when available

## Publishing Results for Fork PRs

To publish check results for fork PRs, use a two-job workflow:

```yaml
name: QE Agent
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  qe-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx qe review --base ${{ github.event.pull_request.base.sha }} --json --output .qe/result.json
      - uses: actions/upload-artifact@v4
        with:
          name: qe-result
          path: .qe/result.json

  # Optional: publish results with write permissions (trusted context)
  qe-publish:
    needs: qe-review
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      checks: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: qe-result
          path: .qe/
      - run: npx qe github publish --result .qe/result.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The `qe-publish` job only runs for same-repo PRs (not forks) where the token has write access.

## Minimum Permissions

| Feature | Required Permission |
|---------|-------------------|
| QE execution only | `contents: read` |
| Check publishing | `checks: write` |
| Issue publishing | `issues: write` |

Only request the permissions you need. If issue publishing is disabled (`github.issues.enabled: false`), do not request `issues: write`.
