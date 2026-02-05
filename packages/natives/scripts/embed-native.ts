import * as path from "node:path";

const reset = process.argv.includes("--reset");

const outputPath = path.join(import.meta.dir, "../src/embedded-addon.ts");
const packageJsonPath = path.join(import.meta.dir, "../package.json");

const stubContent = "export interface EmbeddedAddon {\n\tplatform: string;\n\tversion: string;\n\tfilePath: string;\n}\n\nexport const embeddedAddon: EmbeddedAddon | null = null;\n";

if (reset) {
	await Bun.write(outputPath, stubContent);
	process.exit(0);
}

const targetPlatform = Bun.env.TARGET_PLATFORM || process.platform;
const targetArch = Bun.env.TARGET_ARCH || process.arch;
const platformTag = `${targetPlatform}-${targetArch}`;
const addonFilename = `pi_natives.${platformTag}.node`;

const packageJson = (await Bun.file(packageJsonPath).json()) as { version: string };

const content = `import addonPath from ${JSON.stringify("../native/" + addonFilename)} with { type: \"file\" };\n\nexport interface EmbeddedAddon {\n\tplatform: string;\n\tversion: string;\n\tfilePath: string;\n}\n\nexport const embeddedAddon: EmbeddedAddon | null = {\n\tplatform: ${JSON.stringify(platformTag)},\n\tversion: ${JSON.stringify(packageJson.version)},\n\tfilePath: addonPath,\n};\n`;

await Bun.write(outputPath, content);
