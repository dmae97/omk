import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localPathLauncher, localPathTarget } from "../src/utils/open-local-path.ts";

let root: string;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "omk-open-")));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6v6EAAAAASUVORK5CYII=",
	"base64",
);

describe("/open local target", () => {
	it("keeps a complete Unicode path from tab completion and from a copied file URL", async () => {
		const name = "긴 폴더 # & %.".repeat(12);
		const folder = join(root, name);
		await mkdir(folder);
		const image = join(folder, "screen shot.png");
		await writeFile(image, png);
		expect(await localPathTarget(`"${image}"`, root)).toBe(image);
		expect(await localPathTarget(image, root)).toBe(image);
		expect(await localPathTarget(`(${pathToFileURL(image).href})`, root)).toBe(image);
		expect(await localPathTarget(name, root)).toBe(folder);
	});

	it.skipIf(process.platform !== "linux")("accepts a copied WSL URL only for the active distribution", async () => {
		const original = process.env.WSL_DISTRO_NAME;
		process.env.WSL_DISTRO_NAME = "OMK-Test";
		try {
			const folder = join(root, "한글 # folder");
			await mkdir(folder);
			const url = `file://wsl.localhost/OMK-Test${pathToFileURL(folder).pathname}`;
			expect(await localPathTarget(url, root)).toBe(folder);
			await expect(localPathTarget(url.replace("OMK-Test", "Foreign"), root)).rejects.toThrow(/local path/i);
		} finally {
			if (original === undefined) delete process.env.WSL_DISTRO_NAME;
			else process.env.WSL_DISTRO_NAME = original;
		}
	});

	it("reveals other file types without opening them as programs", async () => {
		await writeFile(join(root, "program.exe"), "not an image");
		await writeFile(join(root, "fake.png"), "not an image");
		expect(await localPathTarget("program.exe", root)).toBe(root);
		expect(await localPathTarget("fake.png", root)).toBe(root);
		await expect(localPathTarget("missing.png", root)).rejects.toThrow(/not found/i);
	});

	it.each([
		"https://example.invalid/image.png",
		"file://host/share/image.png",
		"\\\\host\\share\\image.png",
		"x\n.png",
	])("rejects a remote or malformed input %j", async (input) => {
		await expect(localPathTarget(input, root)).rejects.toThrow(/local path/i);
	});
});

describe("host open dispatch", () => {
	it("passes the macOS path as one argument", () => {
		const path = "/Users/test/한글 # & %.png";
		expect(localPathLauncher(path, "darwin", {})).toEqual({ command: "/usr/bin/open", args: [path] });
	});

	it.each([
		["win32", "C:\\Users\\test\\한글 # & %.png", {}, "C:\\Users\\test\\한글 # & %.png"],
		[
			"linux",
			"/home/test/한글 # & %.png",
			{ WSL_DISTRO_NAME: "Ubuntu" },
			"\\\\wsl.localhost\\Ubuntu\\home\\test\\한글 # & %.png",
		],
		["linux", "/mnt/c/Users/test/한글 # & %.png", { WSL_DISTRO_NAME: "Ubuntu" }, "C:\\Users\\test\\한글 # & %.png"],
	] as const)(
		"passes the exact Windows path without shell interpolation (%s, %s)",
		(platform, path, env, expected) => {
			const { command, args } = localPathLauncher(path, platform, env);
			expect(command).toMatch(/WindowsPowerShell.*powershell\.exe$/i);
			const script = Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le");
			const encodedPath = script.match(/FromBase64String\('([^']+)'\)/)?.[1] ?? "";
			expect(Buffer.from(encodedPath, "base64").toString("utf8")).toBe(expected);
			expect(script).not.toContain(expected);
		},
	);

	it("keeps a remote WSL session from opening a window on the Windows host", () => {
		expect(() =>
			localPathLauncher("/home/test", "linux", { WSL_DISTRO_NAME: "Ubuntu", SSH_TTY: "/dev/pts/1" }),
		).toThrow(/local desktop/i);
	});
});
