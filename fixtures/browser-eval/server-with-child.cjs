// Fixture: server that spawns a child process (for process tree cleanup tests)
const http = require("node:http");
const { fork } = require("node:child_process");
const path = require("node:path");

const PORT = parseInt(process.env.PORT ?? "3100", 10);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html><head><title>Parent App</title></head><body>
<h1 data-testid="status">running with child</h1>
</body></html>`);
});

// Spawn a child worker that stays alive
const child = fork(
  path.join(__dirname, "worker-child.cjs"),
  [],
  { detached: false, stdio: "pipe" },
);

child.on("error", () => {});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Parent server on port ${PORT}, child PID: ${child.pid}`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    try { child.kill("SIGTERM"); } catch {}
    process.exit(0);
  });
});
process.on("SIGINT", () => {
  server.close(() => {
    try { child.kill("SIGTERM"); } catch {}
    process.exit(0);
  });
});
