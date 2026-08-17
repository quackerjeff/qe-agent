// Fixture: server that starts but never listens on the port (Scenario F)
const PORT = parseInt(process.env.PORT ?? "3100", 10);
console.log(`Starting up on port ${PORT}...`);
// Intentionally never calls http.createServer().listen()
// Process stays alive but never becomes ready
setInterval(() => {}, 60_000);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
