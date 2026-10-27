/**
 * Spec 118 D3 §3.3 flag-off G0 byte check. One fixed faux-model scenario that hits every D3 producer:
 * a truncated `read` (read-spill), a truncated `bash` tool call (tool-bash log) and a truncated
 * `AgentSession.executeBash` (executor `fullOutputPath`, excludeFromContext and not). Fixed clock, seeded
 * randomness, counter ids; UUIDs canonicalized by first appearance, repo and temp paths replaced. Prints the
 * normalized session hash, entry count and the type/disposition sequence. Imports only modules on main
 * (2f3747625c), so the same file runs on main and the branch; with OMK_EVIDENCE_LIFECYCLE unset both must match.
 *
 *   cd packages/coding-agent && OMK_BASH_SANDBOX=off npx tsx test/suite/g0-d3-session-hash.ts
 */
import nodeCrypto, { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";

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
let seed = 118;
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
const fixedUuid = (): `${string}-${string}-${string}-${string}-${string}` => {
	idCounter += 1;
	return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, "0")}`;
};
nodeCrypto.randomUUID = fixedUuid as typeof nodeCrypto.randomUUID;
nodeCrypto.randomBytes = ((size: number) =>
	Buffer.from(nextBytes(new Uint8Array(size)))) as typeof nodeCrypto.randomBytes;
syncBuiltinESMExports();
Object.defineProperty(globalThis.crypto, "randomUUID", { value: fixedUuid, configurable: true });

const { fauxAssistantMessage, fauxToolCall } = await import("omk-ai");
const { createBashTool } = await import("../../src/core/tools/bash.ts");
const { createReadTool } = await import("../../src/core/tools/read.ts");
const { createHarness } = await import("./harness.ts");

const work = "/tmp/omk-g0-d3-work";
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
writeFileSync(`${work}/big.txt`, Array.from({ length: 6000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n"));
const harness = await createHarness({ persistSession: true, tools: [createReadTool(work), createBashTool(work)] });
const big = "seq 1 40000";

try {
	harness.setResponses([
		fauxAssistantMessage(fauxToolCall("read", { path: "big.txt" }, { id: "g0-read-1" }), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxToolCall("bash", { command: big }, { id: "g0-bash-1" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	]);
	await harness.session.prompt("read and run");
	await harness.session.agent.waitForIdle();
	await harness.session.executeBash(big);
	await harness.session.executeBash(big, undefined, { excludeFromContext: true });
	harness.setResponses([fauxAssistantMessage("ok")]);
	await harness.session.prompt("again");
	await harness.session.agent.waitForIdle();
	const file = harness.sessionManager.getSessionFile();
	if (!file) throw new Error("no session file");
	const repoRoot = resolve(import.meta.dirname, "../../../..");
	const ids = new Map<string, string>();
	const canonical = (text: string) =>
		text
			.split(repoRoot)
			.join("<repo>")
			.replace(/\/tmp\/pi-suite-[A-Za-z0-9-]+/g, "<suite-dir>")
			.replace(/\/tmp\/omk-spill-[A-Za-z0-9]+/g, "<spill-dir>")
			.replace(/\/tmp\/omk-bash-[A-Za-z0-9-]+\.log/g, "<bash-log>")
			.replace(/\/tmp\/[A-Za-z0-9._-]*bash[A-Za-z0-9._-]*\.log/g, "<exec-log>")
			.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (uuid) => {
				const key = uuid.toLowerCase();
				if (!ids.has(key)) ids.set(key, `<id-${ids.size + 1}>`);
				return ids.get(key) as string;
			})
			.replace(/"faux:\d+:[a-z0-9]+"/g, '"faux:<api>"');
	type Msg = { role?: string; details?: { omk?: { disposition?: string } } };
	const session = canonical(readFileSync(file, "utf8"));
	const lines = session.split("\n").filter(Boolean);
	const types = lines.map((line) => {
		const entry = JSON.parse(line) as { type: string; message?: Msg; customType?: string };
		if (entry.type === "message") {
			const m = entry.message;
			return m?.role === "toolResult" ? `toolResult(${m.details?.omk?.disposition ?? "?"})` : (m?.role ?? "none");
		}
		return entry.customType ? `${entry.type}:${entry.customType}` : entry.type;
	});
	console.log(`session.jsonl sha256 ${createHash("sha256").update(session).digest("hex")} (${lines.length} entries)`);
	console.log(`session types ${types.join(",")}`);
	console.log(`info (not hashed): distinct ids ${ids.size}, repo path length ${repoRoot.length}`);
	if (process.env.G0_DUMP) writeFileSync(`${process.env.G0_DUMP}/session.jsonl`, session);
} finally {
	harness.cleanup();
	rmSync(work, { recursive: true, force: true });
}
