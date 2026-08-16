import type { RepositoryProfile, DetectedTechnology } from "../types/index.js";

export function renderReport(profile: RepositoryProfile): string {
  const lines: string[] = [];

  lines.push("QE Repository Analysis");
  lines.push("");

  lines.push("Repository");
  lines.push("----------");
  lines.push(profile.root);
  lines.push("");

  lines.push("Git");
  lines.push("---");
  if (profile.git.detected) {
    lines.push("Detected");
    if (profile.git.branch) lines.push(`Branch: ${profile.git.branch}`);
  } else {
    lines.push("Not detected");
  }
  lines.push("");

  if (profile.languages.length > 0) {
    lines.push("Detected Ecosystems");
    lines.push("-------------------");
    for (const lang of profile.languages) {
      lines.push(
        `${lang.name}${pad(lang.name, 24)}${confidenceLabel(lang.confidence)}`,
      );
    }
    lines.push("");
  }

  if (profile.frameworks.length > 0) {
    lines.push("Frameworks");
    lines.push("----------");
    for (const fw of profile.frameworks) {
      const ver = fw.version ? ` ${fw.version}` : "";
      lines.push(
        `${fw.name}${ver}${pad(fw.name + ver, 24)}${confidenceLabel(fw.confidence)}`,
      );
    }
    lines.push("");
  }

  if (profile.packageManagers.length > 0) {
    lines.push("Package Manager");
    lines.push("---------------");
    for (const pm of profile.packageManagers) {
      lines.push(
        `${pm.name}${pad(pm.name, 24)}${confidenceLabel(pm.confidence)}`,
      );
    }
    lines.push("");
  }

  if (profile.buildSystems.length > 0) {
    lines.push("Build");
    lines.push("-----");
    for (const bs of profile.buildSystems) {
      lines.push(
        `${bs.name}${pad(bs.name, 24)}${confidenceLabel(bs.confidence)}`,
      );
    }
    lines.push("");
  }

  const testCommands = profile.commands.filter((c) => c.category === "TEST");
  if (profile.testFrameworks.length > 0) {
    lines.push("Tests");
    lines.push("-----");
    for (const tf of profile.testFrameworks) {
      lines.push(tf.name);
      const cmd = testCommands.find((c) =>
        c.command.toLowerCase().includes(tf.id.toLowerCase()),
      );
      if (cmd) lines.push(`  Command: ${cmd.command}`);
      lines.push(`  Source: ${formatEvidence(tf)}`);
    }
    lines.push("");
  }

  const browserTfs = profile.testFrameworks.filter(
    (tf) => tf.id === "playwright",
  );
  if (browserTfs.length > 0) {
    lines.push("Browser Testing");
    lines.push("---------------");
    for (const bt of browserTfs) {
      lines.push(`${bt.name} detected`);
      const cmd = profile.commands.find((c) => c.category === "BROWSER");
      if (cmd) lines.push(`  Command: ${cmd.command}`);
    }
    lines.push("");
  }

  if (profile.ciSystems.length > 0) {
    lines.push("CI");
    lines.push("--");
    for (const ci of profile.ciSystems) {
      lines.push(ci.name);
    }
    lines.push("");
  }

  if (profile.documentation.length > 0) {
    lines.push("Project Instructions");
    lines.push("--------------------");
    for (const doc of profile.documentation) {
      lines.push(doc.path);
    }
    lines.push("");
  }

  if (profile.commands.length > 0) {
    lines.push("Discovered Commands");
    lines.push("-------------------");
    for (const cmd of profile.commands) {
      lines.push(`[${cmd.category}] ${cmd.command}`);
      lines.push(`  Source: ${cmd.source}`);
    }
    lines.push("");
  }

  if (profile.capabilities.length > 0) {
    lines.push("Capabilities");
    lines.push("------------");
    for (const cap of profile.capabilities) {
      const marker = cap.available ? "✓" : "✗";
      lines.push(`${marker} ${cap.id}`);
    }
    lines.push("");
  }

  lines.push("Analysis Confidence");
  lines.push("-------------------");
  lines.push(confidenceLabel(profile.confidence));
  lines.push("");

  return lines.join("\n");
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "HIGH";
  if (confidence >= 0.5) return "MEDIUM";
  return "LOW";
}

function pad(text: string, width: number): string {
  const spaces = Math.max(1, width - text.length);
  return " ".repeat(spaces);
}

function formatEvidence(tech: DetectedTechnology): string {
  return tech.evidence.map((e) => e.source).join(", ");
}
