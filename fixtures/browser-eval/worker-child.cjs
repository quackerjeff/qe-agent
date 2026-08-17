// Child worker fixture — stays alive until killed
setInterval(() => {}, 60_000);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
