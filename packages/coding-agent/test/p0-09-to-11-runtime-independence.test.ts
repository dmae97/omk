import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	probeRustRuntimeWire,
	RUST_WIRE_PROTOCOL_VERSION,
	resolveCoreRuntimeSelection,
} from "../src/core/rust-core-runtime-bridge.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("P0-09: zero Pi runtime dependency on default path with notices preserved", () => {
	it("has no required Pi packages in coding-agent dependencies and preserves NOTICE/LICENSE", () => {
		const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "packages/coding-agent/package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
		};
		const depNames = Object.keys(pkg.dependencies ?? {});
		const piDeps = depNames.filter((name) => /^@(mariozechner|earendil-works|oh-my-pi)\/|^pi-/.test(name));
		expect(piDeps).toEqual([]);
		expect(existsSync(resolve(REPO_ROOT, "LICENSE"))).toBe(true);
		expect(existsSync(resolve(REPO_ROOT, "NOTICE"))).toBe(true);
	});
});

describe("P0-10: embedded standalone single-file assets", () => {
	it("populates dist/bun/embedded-assets.js with current package version and built-in themes", async () => {
		const embeddedPath = resolve(REPO_ROOT, "packages/coding-agent/dist/bun/embedded-assets.js");
		expect(existsSync(embeddedPath)).toBe(true);
		const text = readFileSync(embeddedPath, "utf8");
		expect(text).toContain('"3.0.0"');
		expect(text).toContain('"dark.json"');
		expect(text).toContain('"omk-paper-dark.json"');
	});
});

describe("P0-11: Rust core runtime bridge, live IPC handshake, and fail-safe Node rollback", () => {
	const rustBin = resolve(REPO_ROOT, "native/omk-runtime/target/debug/omk-native-wire");

	it.skipIf(!existsSync(rustBin))(
		"completes a real stdin/stdout wire handshake with compiled Rust omk-native-wire",
		() => {
			const probe = probeRustRuntimeWire(rustBin);
			expect(probe.reachable).toBe(true);
			if (probe.reachable) {
				expect(probe.protocolVersion).toBe(RUST_WIRE_PROTOCOL_VERSION);
				expect(typeof probe.capabilities.offlineOnly).toBe("boolean");
			}

			const selected = resolveCoreRuntimeSelection({
				env: { OMK_CORE_RUNTIME: "rust" },
				binaryPath: rustBin,
				parity: { provider: true, tool: true, session: true, recovery: true },
			});
			expect(selected.active).toBe("rust");
			expect(selected.rolledBackToNode).toBe(false);
		},
	);

	it("rolls back cleanly to Node when parity is incomplete, binary is missing, or operator selects node", () => {
		const incompleteParity = resolveCoreRuntimeSelection({
			env: { OMK_CORE_RUNTIME: "rust" },
			binaryPath: rustBin,
			parity: { provider: true, tool: true, session: false, recovery: true },
		});
		expect(incompleteParity.active).toBe("node");
		expect(incompleteParity.rolledBackToNode).toBe(true);
		expect(incompleteParity.rollbackReason).toContain("session");

		const missingBinary = resolveCoreRuntimeSelection({
			env: { OMK_CORE_RUNTIME: "rust" },
			binaryPath: "/nonexistent/omk-native-wire",
			parity: { provider: true, tool: true, session: true, recovery: true },
		});
		expect(missingBinary.active).toBe("node");
		expect(missingBinary.rolledBackToNode).toBe(true);
		expect(missingBinary.rollbackReason).toContain("rust_binary_missing");

		const explicitNode = resolveCoreRuntimeSelection({
			env: { OMK_CORE_RUNTIME: "node" },
			binaryPath: rustBin,
			parity: { provider: true, tool: true, session: true, recovery: true },
		});
		expect(explicitNode.active).toBe("node");
		expect(explicitNode.rolledBackToNode).toBe(false);
		expect(explicitNode.rollbackReason).toBe("operator_forced_node");
	});

	it("separates standalone single-binary readiness from Rust core transition readiness and wires runtime selection into main.ts", async () => {
		const bridge = await import("../src/core/rust-core-runtime-bridge.ts");
		expect(typeof bridge.evaluateStandaloneBinaryReadiness).toBe("function");
		expect(typeof bridge.evaluateRustCoreTransitionReadiness).toBe("function");
		expect(typeof bridge.selectCoreRuntimeAtStartup).toBe("function");
		expect(typeof bridge.getActiveCoreRuntimeSelection).toBe("function");

		// Standalone binary passing MUST NOT imply Rust transition is complete
		const binReady = bridge.evaluateStandaloneBinaryReadiness({
			metadataEmbedded: true,
			themesBootstrapped: true,
			zeroExternalJsRuntime: true,
			cliSubcommandsVerified: ["version", "help", "doctor", "stats", "list-models", "print"],
			jsonModeVerified: true,
			ptyInteractiveVerified: true,
		});
		const rustReady = bridge.evaluateRustCoreTransitionReadiness({
			wireHandshakeReachable: true,
			providerParity: true,
			toolParity: true,
			sessionParity: false,
			recoveryParity: false,
			entryPointWired: true,
			failSafeNodeRollbackVerified: true,
		});
		expect(binReady.complete).toBe(true);
		expect(rustReady.complete).toBe(false);
		expect(rustReady.missing).toContain("sessionParity");

		// Real startup selector records active selection and rolls back cleanly when OMK_CORE_RUNTIME=rust cannot meet parity
		const sel = bridge.selectCoreRuntimeAtStartup({ OMK_CORE_RUNTIME: "rust" });
		expect(sel.requested).toBe("rust");
		expect(sel.active).toBe("node");
		expect(sel.rolledBackToNode).toBe(true);
		expect(bridge.getActiveCoreRuntimeSelection()).toEqual(sel);

		// Verify main.ts actually invokes selectCoreRuntimeAtStartup
		const mainSrc = readFileSync(resolve(REPO_ROOT, "packages/coding-agent/src/main.ts"), "utf8");
		expect(mainSrc).toContain("selectCoreRuntimeAtStartup");

		// Verify standalone-native-smoke.py exercises doctor, stats, --list-models, --mode json, and OMK_CORE_RUNTIME=rust rollback
		const smokeSrc = readFileSync(resolve(REPO_ROOT, "scripts/standalone-native-smoke.py"), "utf8");
		expect(smokeSrc).toContain("'doctor'");
		expect(smokeSrc).toContain("'stats'");
		expect(smokeSrc).toContain("'--list-models'");
		expect(smokeSrc).toContain("'json'");
		expect(smokeSrc).toContain("OMK_CORE_RUNTIME");
	});
});
