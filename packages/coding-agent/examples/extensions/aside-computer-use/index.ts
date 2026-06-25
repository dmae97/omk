/**
 * OMK ↔ Aside computer-use bridge — extension entry point.
 *
 * Aside is a Chromium-based browser agent. This extension does NOT speak raw
 * CDP; it bridges to `aside mcp` over JSON-RPC stdio and gates every browser
 * action through an OMK-owned policy, risk classifier, origin allowlist, and
 * human approval gate. Web page content is treated as UNTRUSTED and never
 * expands authority; secrets are redacted before reaching the model.
 *
 * Safety defaults (override via ~/.omk/agent/extensions/aside-policy.json or
 * <cwd>/.omk/aside-policy.json):
 *   - mode: guard (Aside's own Allow/Ask/Deny is applied IN ADDITION to OMK's gate)
 *   - allowedOrigins: localhost / 127.0.0.1 only
 *   - deniedActions: credential_export, payment, security_setting_change, account_deletion
 *   - approvalRequiredActions: submit, send_message, publish, delete, change_permission
 *   - R0 auto-allow, R1 allow-on-origin, R2 human-approval, R3 default-deny
 *
 * The `aside` binary must be on PATH (Aside does the browser execution; OMK
 * does the planning, policy, approval, and evidence-gated completion).
 *
 * Usage: copy this directory to ~/.omk/agent/extensions/aside-computer-use/
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "open-multi-agent-kit";
import { AsideMcpClient } from "./mcp-client.ts";
import { loadPolicy } from "./policy.ts";
import { SessionBindingStore } from "./session-binding.ts";
import { registerAsideTools } from "./tools.ts";

export default function asideComputerUse(omk: ExtensionAPI) {
	const policy = loadPolicy(process.cwd());

	const evidenceDirectory = join(process.cwd(), ".omk", "aside-evidence");
	try {
		mkdirSync(evidenceDirectory, { recursive: true });
	} catch {
		// best-effort; tool will still report a path
	}

	const store = new SessionBindingStore();
	let client: AsideMcpClient | undefined;
	const getClient = (): AsideMcpClient => {
		if (!client) {
			client = new AsideMcpClient({ executable: policy.executable, requestTimeoutMs: 60_000 });
		}
		return client;
	};

	registerAsideTools(omk, { getClient, policy, evidenceDirectory });

	omk.registerCommand("aside", {
		description: "Show the active Aside bridge policy (mode, origins, denied actions)",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Aside: mode=${policy.defaultMode} | origins=${policy.allowedOrigins.join(", ") || "(none)"} | denied=${policy.deniedActions.join(", ")}`,
				"info",
			);
		},
	});

	omk.on("session_start", async () => {
		// Bindings are keyed lazily by account/profile; nothing to restore here.
	});

	omk.on("session_shutdown", async () => {
		// Graceful close of the aside process; never block shutdown.
		try {
			await client?.close();
		} catch {
			// ignore
		}
		store.clear();
	});
}
