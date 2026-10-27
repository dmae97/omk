/**
 * Spec 119 G0 byte check. Runs one fixed faux-model scenario (an edit abort, a write abort, one RPC
 * AgentSession.steer(), /goal setup, one bash tool call that times out, the goal loop to its round limit)
 * with a fixed clock, seeded randomness and counter ids, then prints sha256 of the session JSONL and of the provider request contexts. Imports only modules that exist on main
 * (a4bfeb5a97), so the same file runs on main and on a branch; with OMK_GOAL_AUTONOMY unset both must match.
 * OMK_PACKAGE_DIR points at a per-run symlink <mkdtemp(os.tmpdir()/omk-g0-XXXXXX)>/pkg, removed on exit; that path
 * is replaced by the fixed token <pkg> in the bytes before hashing, so hashes match across checkout paths and
 * the symlink no longer blocks concurrent runs. Still run one at a time: harness.ts derives its temp dir from the
 * fixed clock and seeded randomness, so concurrent runs collide on the session lease, and that dir (under
 * os.tmpdir(), i.e. TMPDIR) is in the hashed bytes, so keep TMPDIR the same across compared runs.
 * Run one G0 at a time with the same TMPDIR: concurrent runs collide on the harness session lease
 * (SessionOwnerLeaseHeldError), and a different TMPDIR changes the hashed bytes.
 * PR G0 comparisons must run this same script on the main build too (copy it into the main checkout).
 *
 *   cd packages/coding-agent && OMK_BASH_SANDBOX=off npx tsx test/suite/g0-session-hash.ts
 */
import nodeCrypto, { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { createG0PackageDir } from "./g0-package-dir.ts";

const FIXED_MS = Date.UTC(2026, 9, 24, 0, 0, 0);
const RealDate = Date;
class FixedDate extends RealDate {
	constructor(...args: unknown[]) {
		if (args.length === 0) super(FIXED_MS);
		else super(...(args as [string]));
	}
	static override now(): number {
		return FIXED_MS;
	}
}
globalThis.Date = FixedDate as DateConstructor;

let seed = 119;
Math.random = () => {
	seed = (seed * 1103515245 + 12345) % 2147483648;
	return seed / 2147483648;
};
let idCounter = 0;
const nextBytes = (bytes: Uint8Array): Uint8Array => {
	for (let i = 0; i < bytes.length; i++) bytes[i] = (idCounter * 31 + i * 7) & 0xff;
	idCounter += 1;
	return bytes;
};
let uuidCalls = 0;
const fixedUuid = (): `${string}-${string}-${string}-${string}-${string}` => {
	idCounter += 1;
	uuidCalls += 1;
	const hex = idCounter.toString(16).padStart(12, "0");
	return `00000000-0000-4000-8000-${hex}`;
};
nodeCrypto.randomUUID = fixedUuid as typeof nodeCrypto.randomUUID;
nodeCrypto.randomBytes = ((size: number) =>
	Buffer.from(nextBytes(new Uint8Array(size)))) as typeof nodeCrypto.randomBytes;
syncBuiltinESMExports();
Object.defineProperty(globalThis.crypto, "randomUUID", { value: fixedUuid, configurable: true });
Object.defineProperty(globalThis.crypto, "getRandomValues", {
	value: <T extends ArrayBufferView | null>(array: T): T => {
		if (array) nextBytes(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
		return array;
	},
	configurable: true,
});

// The system prompt links the package README/docs/examples via getPackageDir(), which checks OMK_PACKAGE_DIR first.
// Point it at a per-run symlink and normalize its path to <pkg> before hashing.
const packageRoot = resolve(import.meta.dirname, "../..");
// G0_PACKAGE_LINK_TARGET exists only to demonstrate the assert failing; never set it for real measurements.
const { packageDir: fixedPackageDir, cleanup: removeLinkDir } = createG0PackageDir(
	packageRoot,
	process.env.G0_PACKAGE_LINK_TARGET || packageRoot,
);
process.on("exit", removeLinkDir);
process.env.OMK_PACKAGE_DIR = fixedPackageDir;

const { fauxAssistantMessage, fauxToolCall } = await import("omk-ai");
const { default: goalController } = await import("../../src/core/extensions/builtin/goal-controller.ts");
const { createBashTool } = await import("../../src/core/tools/bash.ts");
const { createEditTool } = await import("../../src/core/tools/edit.ts");
const { createWriteTool } = await import("../../src/core/tools/write.ts");
const { createHarness } = await import("./harness.ts");

const requests: string[] = [];
// In-memory file operations that abort the run mid-call (after the tool started), so edit and write each
// hit their own abort check with no filesystem or timing dependence.
const abortRun = (): void => {
	void harness.session.abort();
};
const files = new Map<string, string>([["/g0/notes.txt", "draft\n"]]);
const editTool = createEditTool("/g0", {
	operations: {
		access: async () => abortRun(),
		readFile: async (path) => Buffer.from(files.get(path) ?? ""),
		writeFile: async (path, content) => {
			files.set(path, content);
		},
	},
});
const writeTool = createWriteTool("/g0", {
	operations: {
		mkdir: async () => abortRun(),
		writeFile: async (path, content) => {
			files.set(path, content);
		},
	},
});
const harness = await createHarness({
	persistSession: true,
	tools: [createBashTool("/tmp"), editTool, writeTool],
	extensionFactories: [goalController],
});
// The faux provider has no wire payload; the request it receives is the full provider Context
// (system prompt, messages, tools), serialized here byte for byte.
const recorded = (message: ReturnType<typeof fauxAssistantMessage>) => (context: unknown) => {
	requests.push(JSON.stringify(context));
	return message;
};

async function idle(): Promise<void> {
	for (let i = 0; i < 600; i++) {
		await harness.session.agent.waitForIdle();
		if (!harness.session.isStreaming) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			if (!harness.session.isStreaming) return;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("session did not settle");
}

try {
	// 1. edit abort, 2. write abort (each ends its run), 3. one RPC steer() mid-run.
	harness.setResponses(
		[
			fauxAssistantMessage(
				fauxToolCall(
					"edit",
					{ path: "notes.txt", edits: [{ oldText: "draft", newText: "final" }] },
					{ id: "g0-edit-1" },
				),
				{ stopReason: "toolUse" },
			),
		].map(recorded),
	);
	await harness.session.prompt("edit the notes").catch(() => undefined);
	await idle();
	harness.setResponses(
		[
			fauxAssistantMessage(
				fauxToolCall("write", { path: "out/report.txt", content: "report" }, { id: "g0-write-1" }),
				{
					stopReason: "toolUse",
				},
			),
		].map(recorded),
	);
	await harness.session.prompt("write the report").catch(() => undefined);
	await idle();
	harness.setResponses([
		async (context: unknown) => {
			requests.push(JSON.stringify(context));
			await harness.session.steer("RPC steer: keep it short");
			return fauxAssistantMessage("noted");
		},
		recorded(fauxAssistantMessage("short it is")),
	]);
	await harness.session.prompt("summarize");
	await idle();

	await harness.session.prompt("/goal Write the report");
	harness.setResponses(
		[
			fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 3", timeout: 1 }, { id: "g0-bash-1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("timed out; moving on"),
			...Array.from({ length: 10 }, (_, i) => fauxAssistantMessage(`round ${i + 1}`)),
		].map(recorded),
	);
	await harness.session.prompt("go");
	await idle();
	const file = harness.sessionManager.getSessionFile();
	if (!file) throw new Error("no session file");
	const sha = (data: string) => createHash("sha256").update(data).digest("hex");
	// Ids come from a call counter shared with randomBytes, so their values shift by one or two with timing
	// (Tech Lead's #268 finding). Canonicalize every UUID by first appearance, and the faux api's random suffix.
	const ids = new Map<string, string>();
	const canonical = (text: string) =>
		text
			.split(fixedPackageDir)
			.join("<pkg>")
			.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (uuid) => {
				const key = uuid.toLowerCase();
				if (!ids.has(key)) ids.set(key, `<id-${ids.size + 1}>`);
				return ids.get(key) as string;
			})
			.replace(/"faux:\d+:[a-z0-9]+"/g, '"faux:<api>"');
	type Msg = { role?: string; details?: { omk?: { disposition?: string } } };
	const label = (m: Msg | undefined) =>
		m?.role === "toolResult" ? `toolResult(${m.details?.omk?.disposition ?? "?"})` : (m?.role ?? "none");
	const session = canonical(readFileSync(file, "utf8"));
	const lines = session.split("\n").filter(Boolean);
	const sessionTypes = lines.map((line) => {
		const entry = JSON.parse(line) as { type: string; message?: Msg; customType?: string };
		if (entry.type === "message") return label(entry.message);
		return entry.customType ? `${entry.type}:${entry.customType}` : entry.type;
	});
	const requestText = canonical(requests.join("\n"));
	const requestTypes = requests.map((r) => {
		const messages = (JSON.parse(r) as { messages?: Msg[] }).messages ?? [];
		return `${messages.length}:${label(messages.at(-1))}`;
	});
	console.log(`session.jsonl sha256 ${sha(session)} (${lines.length} entries)`);
	console.log(`session types ${sessionTypes.join(",")}`);
	console.log(`provider requests sha256 ${sha(requestText)} (${requests.length} requests)`);
	console.log(`request types ${requestTypes.join(",")}`);
	console.log(
		`info (not hashed): randomUUID calls ${uuidCalls}, distinct ids ${ids.size}, OMK_PACKAGE_DIR ${fixedPackageDir} -> ${packageRoot}`,
	);
	// G0_DUMP=<dir> writes the canonical bytes for a diff when the hashes differ.
	const dump = process.env.G0_DUMP;
	if (dump) {
		writeFileSync(`${dump}/session.jsonl`, session);
		writeFileSync(`${dump}/requests.jsonl`, `${requestText}\n`);
	}
} finally {
	harness.cleanup();
	removeLinkDir();
}
