import type {
  DetectedTechnology,
  DiscoveredCommand,
  ApplicationProfile,
  Capability,
} from "../types/index.js";

export interface FileInventory {
  root: string;
  files: string[];
}

export interface AdapterResult {
  languages: DetectedTechnology[];
  frameworks: DetectedTechnology[];
  packageManagers: DetectedTechnology[];
  buildSystems: DetectedTechnology[];
  testFrameworks: DetectedTechnology[];
  ciSystems: DetectedTechnology[];
  commands: DiscoveredCommand[];
  applications: ApplicationProfile[];
  capabilities: Capability[];
}

export interface EcosystemAdapter {
  readonly id: string;
  readonly name: string;
  detect(inventory: FileInventory): Promise<boolean>;
  analyze(inventory: FileInventory): Promise<AdapterResult>;
}

export function emptyAdapterResult(): AdapterResult {
  return {
    languages: [],
    frameworks: [],
    packageManagers: [],
    buildSystems: [],
    testFrameworks: [],
    ciSystems: [],
    commands: [],
    applications: [],
    capabilities: [],
  };
}
