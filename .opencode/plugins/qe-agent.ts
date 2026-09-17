import type { Plugin } from "@opencode-ai/plugin"

/**
 * QE Agent plugin for OpenCode (ADR-011: OpenCode is an invocation
 * mechanism, not part of the QE core).
 *
 * Exposes QE Agent operations as custom tools so the harness model can
 * invoke deterministic QE execution instead of improvising its own
 * validation.
 */
export const QEAgentPlugin: Plugin = async ({ directory }) => {
  return {
    tool: {
      qe_analyze: {
        description:
          "Run QE Agent repository analysis. Returns detected languages, " +
          "frameworks, test frameworks, available commands, and capabilities " +
          "as JSON. Read-only; does not modify the repository.",
        args: {
          type: "object",
          properties: {
            repo: {
              type: "string",
              description:
                "Repository path (defaults to the current project directory)",
            },
          },
        },
        async execute(args) {
          const repo = (args as { repo?: string }).repo ?? directory
          const proc = Bun.spawnSync({
            cmd: [
              "npx",
              "tsx",
              "src/cli/main.ts",
              "analyze",
              "--repo",
              repo,
              "--json",
            ],
            cwd: directory,
            stdout: "pipe",
            stderr: "pipe",
          })
          const stdout = proc.stdout.toString()
          const stderr = proc.stderr.toString()
          if (proc.exitCode !== 0) {
            return `QE analyze failed (exit ${proc.exitCode}):\n${stderr || stdout}`
          }
          return stdout
        },
      },
      qe_verify: {
        description:
          "Run QE Agent verification against a requirements Markdown file. " +
          "Executes available validation commands, generates tests when " +
          "justified, and returns an evidence-backed QE verdict as JSON. " +
          "Requires OPENAI_API_KEY. Only writes within the QE test/QE boundary.",
        args: {
          type: "object",
          properties: {
            requirements: {
              type: "string",
              description: "Path to the requirements Markdown file",
            },
            repo: {
              type: "string",
              description:
                "Repository path (defaults to the current project directory)",
            },
            profile: {
              type: "string",
              enum: ["quick", "standard", "deep"],
              description: "Execution profile (default: standard)",
            },
          },
          required: ["requirements"],
        },
        async execute(args) {
          const a = args as {
            requirements: string
            repo?: string
            profile?: string
          }
          const cmd = [
            "npx",
            "tsx",
            "src/cli/main.ts",
            "verify",
            "--requirements",
            a.requirements,
            "--json",
          ]
          if (a.repo) cmd.push("--repo", a.repo)
          if (a.profile) cmd.push("--profile", a.profile)
          const proc = Bun.spawnSync({
            cmd,
            cwd: directory,
            stdout: "pipe",
            stderr: "pipe",
          })
          const stdout = proc.stdout.toString()
          const stderr = proc.stderr.toString()
          if (proc.exitCode !== 0) {
            return `QE verify failed (exit ${proc.exitCode}):\n${stderr || stdout}`
          }
          return stdout
        },
      },
      qe_review: {
        description:
          "Run QE Agent change review against a Git baseline. Collects the " +
          "diff, assesses risk, executes validation, and returns an " +
          "evidence-backed verdict with failure classifications as JSON. " +
          "Requires OPENAI_API_KEY. Only writes within the QE test/QE boundary.",
        args: {
          type: "object",
          properties: {
            base: {
              type: "string",
              description: "Baseline Git ref (e.g. main)",
            },
            target: {
              type: "string",
              description: "Target Git ref (defaults to HEAD)",
            },
            repo: {
              type: "string",
              description:
                "Repository path (defaults to the current project directory)",
            },
            profile: {
              type: "string",
              enum: ["quick", "standard", "deep"],
              description: "Execution profile (default: standard)",
            },
          },
          required: ["base"],
        },
        async execute(args) {
          const a = args as {
            base: string
            target?: string
            repo?: string
            profile?: string
          }
          const cmd = [
            "npx",
            "tsx",
            "src/cli/main.ts",
            "review",
            "--base",
            a.base,
            "--json",
          ]
          if (a.target) cmd.push("--target", a.target)
          if (a.repo) cmd.push("--repo", a.repo)
          if (a.profile) cmd.push("--profile", a.profile)
          const proc = Bun.spawnSync({
            cmd,
            cwd: directory,
            stdout: "pipe",
            stderr: "pipe",
          })
          const stdout = proc.stdout.toString()
          const stderr = proc.stderr.toString()
          if (proc.exitCode !== 0) {
            return `QE review failed (exit ${proc.exitCode}):\n${stderr || stdout}`
          }
          return stdout
        },
      },
      qe_opencode_publish: {
        description:
          "Deliver a completed QE result JSON into an OpenCode session as a " +
          "markdown verdict message, and persist it under .qe/runs/. " +
          "Use after qe_verify or qe_review produced a result file.",
        args: {
          type: "object",
          properties: {
            result: {
              type: "string",
              description: "Path to the QE result JSON file",
            },
            session: {
              type: "string",
              description: "OpenCode session ID to deliver into",
            },
          },
          required: ["result"],
        },
        async execute(args) {
          const a = args as { result: string; session?: string }
          const cmd = [
            "npx",
            "tsx",
            "src/cli/main.ts",
            "opencode",
            "publish",
            "--result",
            a.result,
            "--json",
          ]
          if (a.session) cmd.push("--session", a.session)
          const proc = Bun.spawnSync({
            cmd,
            cwd: directory,
            stdout: "pipe",
            stderr: "pipe",
          })
          const stdout = proc.stdout.toString()
          const stderr = proc.stderr.toString()
          if (proc.exitCode !== 0) {
            return `QE opencode publish failed (exit ${proc.exitCode}):\n${stderr || stdout}`
          }
          return stdout
        },
      },
    },
  }
}