import { createServer } from "node:net";

/**
 * Ask the OS for a genuinely free TCP port by binding to port 0 and
 * releasing it. Used when the orchestrator auto-starts an application
 * for browser validation so concurrent runs never collide on a fixed
 * random range.
 *
 * There is an inherent small race between release and re-bind by the
 * spawned process, but this is the standard approach and removes the
 * systematic collision failures of a fixed random range.
 */
export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a free port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
