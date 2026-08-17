// Fixture: server that crashes immediately on startup (Scenario E)
console.error("FATAL: Missing required configuration");
process.exit(1);
