import * as fs from "node:fs/promises";
import * as path from "node:path";
import { compile } from "tailwindcss";

// Clean dist
await fs.rm("./dist/client", { recursive: true, force: true });

// Build Tailwind CSS
console.log("Building Tailwind CSS...");
const sourceCss = await Bun.file("./src/client/styles.css").text();
const compiler = await compile(sourceCss, {
	base: path.resolve("./src/client"),
});
const tailwindOutput = compiler.build([]);
await Bun.write("./dist/client/styles.css", tailwindOutput);

// Build React app
const result = await Bun.build({
	entrypoints: ["./src/client/index.tsx"],
	outdir: "./dist/client",
	minify: true,
	naming: "[dir]/[name].[ext]",
});

if (!result.success) {
	console.error("Build failed");
	for (const message of result.logs) {
		console.error(message);
	}
	process.exit(1);
}

// Create index.html
const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Usage Statistics</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div id="root"></div>
    <script src="index.js" type="module"></script>
</body>
</html>`;

await Bun.write("./dist/client/index.html", indexHtml);

console.log("Build complete");
