import { createServer } from "node:net";
import { promisify } from "node:util";

/**
 * Ask the OS for a genuinely free TCP port by binding to port 0 and
 * releasing it. Deterministic in the sense that the port is verified
 * free at allocation time — unlike fixed random ranges, which collide
 * when several test files spawn servers concurrently.
 *
 * There is an inherent small race between release and re-bind by the
 * caller, but this is the standard, non-circumventing approach for
 * integration fixtures and removes the systematic collision failures.
 */
export async function getFreePort(): Promise<number> {
  const server = createServer();
  await promisify(server.listen.bind(server))(0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a free port");
  }
  await promisify(server.close.bind(server))();
  return address.port;
}
