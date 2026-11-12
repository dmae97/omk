/**
 * Spec 120 K0 (T005): RPC transcript recorder driver.
 *
 * Runs the real `runRpcMode` against a faux-provider session from the existing
 * offline harness, with the same fixed clock and seeded randomness as the G0
 * suite. The parent process writes RPC commands to stdin and records stdout.
 * No provider call, no credential, no real session.
 */
import nodeCrypto from "node:crypto";
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

let seed = 120;
Math.random = () => {
	seed = (seed * 1103515245 + 12345) % 2147483648;
	return seed / 2147483648;
};
let idCounter = 0;
const fixedUuid = (): `${string}-${string}-${string}-${string}-${string}` => {
	idCounter += 1;
	const hex = idCounter.toString(16).padStart(12, "0");
	return `00000000-0000-4000-8000-${hex}`;
};
nodeCrypto.randomUUID = fixedUuid as typeof nodeCrypto.randomUUID;
nodeCrypto.randomBytes = ((size: number) => {
	const bytes = Buffer.alloc(size);
	for (let i = 0; i < size; i++) bytes[i] = (idCounter * 31 + i * 7) & 0xff;
	idCounter += 1;
	return bytes;
}) as typeof nodeCrypto.randomBytes;
syncBuiltinESMExports();
Object.defineProperty(globalThis.crypto, "randomUUID", { value: fixedUuid, configurable: true });

const packageRoot = resolve(import.meta.dirname, "../..");
process.env.OMK_PACKAGE_DIR = resolve(packageRoot, "packages/coding-agent");
process.env.OMK_BASH_SANDBOX = "off";

const { fauxAssistantMessage } = await import("omk-ai");
const { createHarness } = await import("../../packages/coding-agent/test/suite/harness.ts");
const { runRpcMode } = await import("../../packages/coding-agent/src/modes/rpc/rpc-mode.ts");

const harness = await createHarness({ persistSession: true });
harness.setResponses([fauxAssistantMessage("hello back"), fauxAssistantMessage("second answer")]);
// SAFETY: the fixture sends only get_state and prompt. This runRpcMode path uses
// session, setRebindSession and dispose; session replacement stubs always cancel.
const runtimeHost = {
	session: harness.session,
	newSession: async () => ({ cancelled: true }),
	switchSession: async () => ({ cancelled: true }),
	fork: async () => ({ cancelled: true, selectedText: "" }),
	dispose: async () => { harness.cleanup(); },
	setRebindSession: () => {},
};

// runRpcMode never returns; it reads stdin until EOF and then exits.
// SAFETY: only get_state/prompt/EOF are sent; their runtime fields exist above.
await runRpcMode(runtimeHost as unknown as Parameters<typeof runRpcMode>[0]);
