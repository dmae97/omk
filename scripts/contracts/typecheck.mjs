import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, writeArtifacts } from "./artifacts.mjs";
import ts from "typescript";
function literal(node) {
	if (ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
	if (ts.isStringLiteral(node)) return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (node.kind === ts.SyntaxKind.NullKeyword) return null;
	if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
	if (ts.isObjectLiteralExpression(node))
		return Object.fromEntries(
			node.properties.map((p) => {
				if (!ts.isPropertyAssignment(p)) throw Error("non-literal RPC test input");
				return [p.name.text, literal(p.initializer)];
			}),
		);
	throw Error("unsupported RPC test literal");
}
function commandSamples() {
	const source = ts.createSourceFile(
		"rpc-input.test.ts",
		readFileSync(ROOT + "packages/coding-agent/test/rpc-input.test.ts", "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	let result;
	function visit(node) {
		if (ts.isVariableDeclaration(node) && node.name.getText(source) === "commands")
			result = literal(node.initializer);
		ts.forEachChild(node, visit);
	}
	visit(source);
	if (!Array.isArray(result) || result.length !== 29) throw Error("RPC command sample inventory changed");
	return result;
}

export function checkDeclarationTypes(artifacts) {
	const dir = mkdtempSync(join(tmpdir(), "omk-contract-types-"));
	try {
		writeArtifacts(join(dir, "generated"), artifacts);
		writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
		const imports = [
			'import type * as session from "./generated/session.ts";',
			'import type * as messages from "./generated/session-message.ts";',
			'import type * as rpc from "./generated/rpc.ts";',
			'import type * as ui from "./generated/rpc-ui.ts";',
			'import type * as host from "./generated/host-wire.ts";',
		];
		const samples = [...imports];
		let positiveSamples = 0;
		const add = (type, value) => {
			samples.push(`const positive${positiveSamples++}: ${type} = ${JSON.stringify(value)};`);
		};
		const fixture = ROOT + "native/omk-contract/tests/fixtures/";
		for (const line of readFileSync(fixture + "g0/session.jsonl", "utf8")
			.trimEnd()
			.split("\n"))
			add("session.FileEntry", JSON.parse(line));
		for (const line of readFileSync(fixture + "rpc-transcript.jsonl", "utf8")
			.trimEnd()
			.split("\n")) {
			const row = JSON.parse(line);
			add(row.direction === "in" ? "rpc.RpcInput" : "rpc.RpcOutput", row.message);
		}
		for (const command of commandSamples()) add("rpc.RpcInput", command);
		add("rpc.RpcOutput", { type: "response", command: "cycle_model", success: true, data: null });
		add("ui.RpcUiResponse", { type: "extension_ui_response", id: "ui", confirmed: false });
		add("ui.RpcUiResponse", { type: "extension_ui_response", id: "ui", value: "" });
		add("ui.RpcUiResponse", { type: "extension_ui_response", id: "ui", cancelled: true });
		const base = { id: "e", parentId: null, timestamp: "iso" };
		for (const value of [
			{ type: "thinking_level_change", thinkingLevel: "off" },
			{ type: "model_change", provider: "faux", modelId: "m" },
			{ type: "compaction", summary: "synthetic", firstKeptEntryId: "e", tokensBefore: 1 },
			{ type: "branch_summary", fromId: "e", summary: "synthetic", details: null },
			{ type: "custom_message", customType: "test", content: "synthetic", display: false },
			{ type: "label", targetId: "e" },
			{ type: "session_info", name: "synthetic" },
		])
			add("session.FileEntry", { ...base, ...value });
		add("host.CoreFrame", { type: "ready", wire_version: 1 });
		add("host.HostFrame", { type: "hello", wire_version: 1, node_version: "22.19.0" });
		const negative = [
			'const bad0: rpc.RpcInput = {type:"prompt"};',
			'const bad1: rpc.RpcInput = {type:"set_model",provider:"x"};',
			'const bad2: rpc.RpcInput = {type:"set_thinking_level",level:"bogus"};',
			'const bad3: ui.RpcUiResponse = {type:"extension_ui_response",id:"x",cancelled:false};',
			'const bad4: ui.RpcUiResponse = {type:"extension_ui_response",id:"x"};',
			'const bad5: rpc.RpcOutput = {type:"response",command:"cycle_model",success:true};',
			'const bad6: host.HostFrame = {type:"hello",wire_version:"1",node_version:"22"};',
			'const bad7: session.SessionEntryBase = {id:"x",timestamp:"iso"};',
			'const bad8: messages.KnownMessage = {role:"assistant",content:[],timestamp:0};',
			"const bad9: session.Usage = {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0},cacheWriteUnknown:false};",
		];
		for (const test of negative) samples.push("// @ts-expect-error invalid wire shape\n" + test);
		writeFileSync(join(dir, "samples.ts"), samples.join("\n") + "\n");
		writeFileSync(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					noEmit: true,
					strict: true,
					exactOptionalPropertyTypes: true,
					skipLibCheck: false,
					target: "ES2022",
					module: "NodeNext",
					moduleResolution: "NodeNext",
					types: [],
					allowImportingTsExtensions: true,
				},
				include: ["**/*.ts"],
			}),
		);
		const result = spawnSync(
			process.execPath,
			[ROOT + "node_modules/typescript/bin/tsc", "-p", join(dir, "tsconfig.json")],
			{ encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
		);
		return {
			status: result.status,
			output: (result.stdout ?? "") + (result.stderr ?? "") + (result.error?.message ?? ""),
			positiveSamples,
			negativeSamples: negative.length,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
