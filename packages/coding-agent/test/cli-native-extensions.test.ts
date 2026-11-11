import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const tsx = resolve(packageRoot, "../../node_modules/tsx/dist/loader.mjs");
let root: string;
let cwd: string;
let agentDir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-cli-native-"));
	cwd = join(root, "project");
	agentDir = join(root, "agent");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(join(cwd, ".git"));
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [], quietStartup: true }));
	writeFileSync(
		join(root, "network-guard.mjs"),
		`
		import { writeFileSync } from "node:fs";
		import net from "node:net";
		let attempts = 0;
		const deny = () => { attempts++; throw new Error("Unexpected network attempt in native CLI fixture"); };
		globalThis.fetch = deny;
		net.Socket.prototype.connect = deny;
		process.on("exit", () => writeFileSync(${JSON.stringify(join(root, "network.json"))}, JSON.stringify({ attempts })));
	`,
	);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function runCli(args: string[]) {
	const result = spawnSync(
		process.execPath,
		["--import", tsx, "--import", join(root, "network-guard.mjs"), join(packageRoot, "src/cli.ts"), ...args],
		{
			cwd,
			env: {
				PATH: process.env.PATH,
				HOME: root,
				OMK_CODING_AGENT_DIR: agentDir,
				OMK_PACKAGE_DIR: packageRoot,
				OMK_OFFLINE: "1",
				OMK_TRUST_PROJECT: "1",
				OMK_SKIP_VERSION_CHECK: "1",
				NO_COLOR: "1",
				TSX_TSCONFIG_PATH: resolve(packageRoot, "../../tsconfig.json"),
			},
			input: "",
			encoding: "utf8",
			timeout: 30_000,
		},
	);
	expect(JSON.parse(readFileSync(join(root, "network.json"), "utf8"))).toEqual({ attempts: 0 });
	return result;
}

function executableFixture(installedDependency: boolean): string {
	const dependency = join(cwd, "node_modules", "@earendil-works", "pi-ai");
	if (installedDependency) {
		mkdirSync(dependency, { recursive: true });
		writeFileSync(
			join(dependency, "package.json"),
			JSON.stringify({ name: "@earendil-works/pi-ai", exports: { "./identity": "./index.cjs" } }),
		);
		writeFileSync(join(dependency, "index.cjs"), 'exports.identity = "user-installed-identity";');
	}
	const extension = join(cwd, "executable.ts");
	writeFileSync(
		extension,
		`
		import { writeFileSync } from "node:fs";
		import { Type } from "typebox";
		import { createAssistantMessageEventStream } from "omk-ai";
		${installedDependency ? 'import { identity } from "@earendil-works/pi-ai/identity";' : 'import { getModels } from "@earendil-works/pi-ai"; const identity = getModels("openai").length > 0 ? "compatibility-alias" : "missing";'}
		export default function(api) {
			api.registerTool({ name: "native_receipt", label: "Native receipt", description: "Increment a fixture value",
				parameters: Type.Object({ value: Type.Number() }),
				execute: async (_id, args, _signal, _update, ctx) => {
					const receipt = { args, result: args.value + 1, identity, cwd: ctx.cwd, mode: ctx.mode };
					writeFileSync(${JSON.stringify(join(cwd, "tool.json"))}, JSON.stringify(receipt));
					return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
				}
			});
			api.registerProvider("native-cli-fixture", { api: "native-cli-fixture", baseUrl: "https://example.invalid", apiKey: "fixture-only",
				models: [{ id: "offline", name: "Offline fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024 }],
				streamSimple(model, context) {
					const result = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "native_receipt");
					const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
						content: result ? [{ type: "text", text: "offline native receipt complete" }] : [{ type: "toolCall", id: "native-call", name: "native_receipt", arguments: { value: 41 } }],
						stopReason: result ? "stop" : "toolUse", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
					const stream = createAssistantMessageEventStream();
					stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); return stream;
				}
			});
			api.on("session_start", (_event, ctx) => writeFileSync(${JSON.stringify(join(cwd, "start.json"))}, JSON.stringify({ mode: ctx.mode, trusted: ctx.isProjectTrusted() })));
			api.on("session_shutdown", event => writeFileSync(${JSON.stringify(join(cwd, "shutdown.json"))}, JSON.stringify({ reason: event.reason })));
		}
	`,
	);
	return extension;
}

describe("package manifest dialect CLI validation", () => {
	it.each([
		["--package-manifest-dialect"],
		["--package-manifest-dialect="],
		["--package-manifest-dialect", ""],
		["--package-manifest-dialect", "native"],
		["--package-manifest-dialect=OMK"],
		["--package-manifest-dialect", "--offline"],
		["--package-manifest-dialect=omk", "--package-manifest-dialect=omk+pi"],
		["--package-manifest-dialect=bad", "--package-manifest-dialect=omk"],
	])("rejects invalid or repeated selection %j before extension evaluation", (...flags) => {
		const marker = join(cwd, "evaluated");
		const extension = join(cwd, "extension.ts");
		writeFileSync(
			extension,
			`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "bad"); export default () => {};`,
		);
		const result = runCli(["-p", "--no-session", "-e", extension, ...flags]);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("--package-manifest-dialect");
		expect(existsSync(marker)).toBe(false);
		const parsed = parseArgs(flags);
		expect(parsed.diagnostics).toContainEqual({
			type: "error",
			message: expect.stringContaining("--package-manifest-dialect"),
		});
		expect(parsed.unknownFlags.has("package-manifest-dialect")).toBe(false);
	});

	it("reports explicit missing Pi imports as native load errors rather than model or unknown-flag errors", () => {
		const extension = join(cwd, "missing.ts");
		writeFileSync(
			extension,
			'import { getModels } from "@earendil-works/pi-ai"; export default () => { getModels("unused"); };',
		);
		const result = runCli([
			"-p",
			"--no-session",
			"--no-extensions",
			"-e",
			extension,
			"--package-manifest-dialect",
			"omk",
		]);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Failed to load extension");
		expect(result.stderr).toContain("@earendil-works/pi-ai");
		expect(result.stderr).not.toMatch(/Unknown option|No models available|No API key/);
	});

	it("does not select a dialect on omission or after the option terminator", () => {
		expect(parseArgs([])).not.toHaveProperty("packageManifestDialect");
		expect(parseArgs(["--", "--package-manifest-dialect=omk"]).messages).toEqual(["--package-manifest-dialect=omk"]);
	});

	it.each([["--package-manifest-dialect", "omk"], ["--package-manifest-dialect=omk"]])(
		"executes a native tool with its ordinary installed dependency via %j",
		(...flags) => {
			const extension = executableFixture(true);
			const result = runCli([
				"-p",
				"--no-session",
				"--no-extensions",
				"--no-builtin-tools",
				"-e",
				extension,
				"--model",
				"native-cli-fixture/offline",
				...flags,
				"run the fixture",
			]);
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toContain("offline native receipt complete");
			expect(JSON.parse(readFileSync(join(cwd, "tool.json"), "utf8"))).toEqual({
				args: { value: 41 },
				result: 42,
				identity: "user-installed-identity",
				cwd,
				mode: "print",
			});
			expect(JSON.parse(readFileSync(join(cwd, "start.json"), "utf8"))).toEqual({ mode: "print", trusted: true });
			expect(JSON.parse(readFileSync(join(cwd, "shutdown.json"), "utf8"))).toEqual({ reason: "quit" });
		},
	);

	it("fails a legacy alias import by default with a migration hint (OMK 2.0 native default)", () => {
		const extension = executableFixture(false);
		const result = runCli([
			"-p",
			"--no-session",
			"--no-extensions",
			"--no-builtin-tools",
			"-e",
			extension,
			"--model",
			"native-cli-fixture/offline",
			"run the fixture",
		]);
		expect(result.error).toBeUndefined();
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("--package-manifest-dialect omk+pi");
		expect(existsSync(join(cwd, "tool.json"))).toBe(false);
	});

	it.each([{ flags: ["--package-manifest-dialect=omk+pi"] }])(
		"keeps supported legacy alias execution with compatibility $flags",
		({ flags }) => {
			const extension = executableFixture(false);
			const result = runCli([
				"-p",
				"--no-session",
				"--no-extensions",
				"--no-builtin-tools",
				"-e",
				extension,
				"--model",
				"native-cli-fixture/offline",
				...flags,
				"run the fixture",
			]);
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(0);
			expect(JSON.parse(readFileSync(join(cwd, "tool.json"), "utf8"))).toMatchObject({
				result: 42,
				identity: "compatibility-alias",
			});
		},
	);

	it("keeps discovered native load failures as warnings while a discovered fixture executes", () => {
		const extension = executableFixture(true);
		const discovered = join(cwd, ".omk", "extensions");
		mkdirSync(discovered, { recursive: true });
		writeFileSync(join(discovered, "native.ts"), readFileSync(extension));
		writeFileSync(join(discovered, "missing.ts"), 'import { Key } from "@earendil-works/pi-tui"; void Key;');
		const result = runCli([
			"-p",
			"--no-session",
			"--no-builtin-tools",
			"--model",
			"native-cli-fixture/offline",
			"--package-manifest-dialect=omk",
			"run the fixture",
		]);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).toContain("Warning: Failed to load extension");
		expect(result.stderr).toContain("@earendil-works/pi-tui");
		expect(JSON.parse(readFileSync(join(cwd, "tool.json"), "utf8"))).toMatchObject({ result: 42 });
	});
});
