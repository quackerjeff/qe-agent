import type { EcosystemAdapter } from "../repository/types.js";
import { JavaScriptAdapter } from "./javascript/adapter.js";
import { PythonAdapter } from "./python/adapter.js";
import { DotNetAdapter } from "./dotnet/adapter.js";
import { GenericAdapter } from "./generic/adapter.js";
import { BrowserAdapter } from "./browser/adapter.js";

export { JavaScriptAdapter } from "./javascript/adapter.js";
export { PythonAdapter } from "./python/adapter.js";
export { DotNetAdapter } from "./dotnet/adapter.js";
export { GenericAdapter } from "./generic/adapter.js";
export { BrowserAdapter } from "./browser/adapter.js";

export function createDefaultAdapters(): EcosystemAdapter[] {
  return [
    new JavaScriptAdapter(),
    new PythonAdapter(),
    new DotNetAdapter(),
    new BrowserAdapter(),
    new GenericAdapter(),
  ];
}
