/**
 * Virtual modules for compiled Bun binaries — the extension-facing view of the
 * bundled package namespaces.
 *
 * Extracted from loader.ts: the table resolves the bundled
 * `open-multi-agent-kit` namespace that the binary entry registers at startup
 * (src/bun/register-bundled-coding-agent.ts). loader.ts itself must not import
 * `../../index.ts` — that edge put it inside the index↔core import cycle
 * (scripts/check-import-cycles.mjs).
 */

// Static imports of packages that extensions may use.
// These MUST be static so Bun bundles them into the compiled binary.
// The virtualModules option then makes them available to extensions.
import * as _bundledOmkAgentCore from "omk-agent-core";
import * as _bundledOmkAgentCoreNode from "omk-agent-core/node";
import * as _bundledOmkAi from "omk-ai";
import * as _bundledOmkAiOauth from "omk-ai/oauth";
import * as _bundledOmkTui from "omk-tui";
import * as _bundledTypebox from "typebox";
import * as _bundledTypeboxCompile from "typebox/compile";
import * as _bundledTypeboxValue from "typebox/value";
import { LEGACY_PI_RUNTIME_ALIASES, type PiCompatibilityTarget } from "../pi-compat.ts";

/**
 * The compiled-binary entry registers the bundled package namespace here before
 * any extension resolves. loader.ts cannot import `../../index.ts` directly
 * (cycle), so this module is the injection point instead.
 */
let _bundledCodingAgentNamespace: unknown;

/** Registration point for the compiled binary's bundled `open-multi-agent-kit` namespace. */
export function registerBundledCodingAgentNamespace(namespace: unknown): void {
	_bundledCodingAgentNamespace = namespace;
}

const LEGACY_PI_VIRTUAL_TARGETS: Record<Exclude<PiCompatibilityTarget, "coding-agent">, unknown> = {
	"agent-core": _bundledOmkAgentCore,
	"agent-core-node": _bundledOmkAgentCoreNode,
	ai: _bundledOmkAi,
	"ai-oauth": _bundledOmkAiOauth,
	tui: _bundledOmkTui,
};

/** Modules available to extensions via virtualModules (compiled Bun binary only). */
export function buildVirtualModules(): Record<string, unknown> {
	const bundledCodingAgent = _bundledCodingAgentNamespace;
	const legacyTargets: Record<PiCompatibilityTarget, unknown> = {
		...LEGACY_PI_VIRTUAL_TARGETS,
		"coding-agent": bundledCodingAgent,
	};
	return {
		...Object.fromEntries(
			Object.entries(LEGACY_PI_RUNTIME_ALIASES).map(([specifier, target]) => [specifier, legacyTargets[target]]),
		),
		typebox: _bundledTypebox,
		"typebox/compile": _bundledTypeboxCompile,
		"typebox/value": _bundledTypeboxValue,
		"@sinclair/typebox": _bundledTypebox,
		"@sinclair/typebox/compile": _bundledTypeboxCompile,
		"@sinclair/typebox/value": _bundledTypeboxValue,
		"omk-agent-core": _bundledOmkAgentCore,
		"omk-agent-core/node": _bundledOmkAgentCoreNode,
		"omk-tui": _bundledOmkTui,
		"omk-ai": _bundledOmkAi,
		"omk-ai/oauth": _bundledOmkAiOauth,
		"open-multi-agent-kit": bundledCodingAgent,
	};
}
