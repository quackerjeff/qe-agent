import type {
  RepositoryProfile,
  DiscoveredCommand,
} from "../../types/index.js";

export interface FocusedTestResolution {
  status: "SUPPORTED" | "UNSUPPORTED";
  executable?: string;
  args?: string[];
  framework?: string;
  reason: string;
}

const FRAMEWORK_RESOLVERS: {
  match: (profile: RepositoryProfile, commands: DiscoveredCommand[]) => boolean;
  framework: string;
  resolve: (
    testFilePath: string,
    commands: DiscoveredCommand[],
  ) => FocusedTestResolution;
}[] = [
  {
    match: (profile, commands) =>
      profile.testFrameworks.some((tf) => tf.id === "vitest") ||
      commands.some(
        (c) => c.command.includes("vitest") || c.id.includes("vitest"),
      ),
    framework: "vitest",
    resolve: (testFilePath) => ({
      status: "SUPPORTED",
      executable: "npx",
      args: ["vitest", "run", testFilePath],
      framework: "vitest",
      reason: "Vitest supports direct file targeting",
    }),
  },
  {
    match: (profile, commands) =>
      profile.testFrameworks.some((tf) => tf.id === "jest") ||
      commands.some((c) => c.command.includes("jest") || c.id.includes("jest")),
    framework: "jest",
    resolve: (testFilePath) => ({
      status: "SUPPORTED",
      executable: "npx",
      args: ["jest", "--no-coverage", testFilePath],
      framework: "jest",
      reason: "Jest supports direct file targeting",
    }),
  },
  {
    match: (profile) => profile.testFrameworks.some((tf) => tf.id === "pytest"),
    framework: "pytest",
    resolve: (testFilePath) => ({
      status: "SUPPORTED",
      executable: "pytest",
      args: [testFilePath, "-v"],
      framework: "pytest",
      reason: "pytest supports direct file targeting",
    }),
  },
  {
    match: (profile) =>
      profile.testFrameworks.some(
        (tf) => tf.id === "xunit" || tf.id === "nunit" || tf.id === "mstest",
      ),
    framework: "dotnet",
    resolve: (_testFilePath, commands) => {
      const testCmd = commands.find(
        (c) => c.category === "TEST" && c.executable === "dotnet",
      );
      return {
        status: "UNSUPPORTED",
        reason:
          "dotnet test does not support direct file targeting; use suite-level execution",
        framework: testCmd ? "dotnet" : undefined,
      };
    },
  },
  {
    match: (profile) => profile.testFrameworks.some((tf) => tf.id === "mocha"),
    framework: "mocha",
    resolve: (testFilePath) => ({
      status: "SUPPORTED",
      executable: "npx",
      args: ["mocha", testFilePath],
      framework: "mocha",
      reason: "Mocha supports direct file targeting",
    }),
  },
];

export function resolveFocusedTestCommand(
  generatedTestPath: string,
  profile: RepositoryProfile,
  discoveredCommands: DiscoveredCommand[],
): FocusedTestResolution {
  for (const resolver of FRAMEWORK_RESOLVERS) {
    if (resolver.match(profile, discoveredCommands)) {
      return resolver.resolve(generatedTestPath, discoveredCommands);
    }
  }

  return {
    status: "UNSUPPORTED",
    reason: "No recognized test framework for focused execution",
  };
}
