const mode = process.argv[2];
if (mode !== "success" && mode !== "wait") throw new Error("unknown fixture mode");

if (mode === "wait") {
	const keepAlive = setInterval(() => {}, 60_000);
	process.once("SIGTERM", () => {
		clearInterval(keepAlive);
		process.exitCode = 0;
	});
}
process.stdout.write(`READY ${process.pid}\n`);
