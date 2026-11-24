import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AuthStorage } from "../../packages/coding-agent/src/core/auth-storage.ts";
import type { AuthStorageBackend } from "../../packages/coding-agent/src/core/auth-storage-backend.ts";
import { resolveConfigValue } from "../../packages/coding-agent/src/core/resolve-config-value.ts";

type Input = {
	config?: string;
	store?: string;
	loadError?: boolean;
	runtime?: string;
	environment?: string;
	fallback?: string;
	includeFallback?: boolean;
	env?: Record<string, string>;
};
const templates = [
	"", "faux-key", "SYN_KEY", "$SYN_KEY", "${SYN_KEY}", "prefix-$SYN_KEY/suffix",
	"${SYN_KEY}${SECOND}", "$SYN_KEY$SECOND", "$MISSING", "$EMPTY", "${MISSING}",
	"prefix-${MISSING}", "$$SYN_KEY", "$!literal", "$${SYN_KEY}", "$$$SYN_KEY",
	"${bad-name}", "${}", "${SYN_KEY", "$", "$9", "$-", "${SYN_KEY}tail",
	"$_KEY", "$SYN_KEY_suffix", "$SYN_KEY.tail", "한글-$SYN_KEY-🙂", "line\n$SYN_KEY\r\n",
	"${SYN_KEY}${bad-name}", "$é", "${é}", "$!$SYN_KEY", "\u0000$SYN_KEY",
];
const scenarios: { id: string; input: Input }[] = templates.map((config, i) => ({
	id: `template-${i}`, input: { config, env: { SYN_KEY: "faux-value", SECOND: "two", _KEY: "under", EMPTY: "" } },
}));
const stored = (key: string) => JSON.stringify({ anthropic: { type: "api_key", key } });
scenarios.push(
	{ id: "missing", input: {} },
	{ id: "environment", input: { environment: "faux-environment" } },
	{ id: "fallback", input: { fallback: "faux-fallback" } },
	{ id: "environment-before-fallback", input: { environment: "faux-environment", fallback: "faux-fallback" } },
	{ id: "stored-before-environment", input: { store: stored("faux-stored"), environment: "faux-environment" } },
	{ id: "runtime-before-stored", input: { runtime: "faux-runtime", store: stored("faux-stored") } },
	{ id: "runtime-not-interpolated", input: { runtime: "$SYN_KEY", env: { SYN_KEY: "faux-value" } } },
	{ id: "runtime-empty-ignored", input: { runtime: "", environment: "faux-environment" } },
	{ id: "stored-empty-stops-fallback", input: { store: stored(""), environment: "faux-environment" } },
	{ id: "stored-template", input: { store: stored("key-${SYN_KEY}"), env: { SYN_KEY: "faux-value" } } },
	{ id: "stored-unresolved-no-fallback", input: { store: stored("$MISSING"), environment: "faux-environment", fallback: "faux-fallback" } },
	{ id: "fallback-disabled", input: { fallback: "faux-fallback", includeFallback: false } },
	{ id: "fallback-empty", input: { fallback: "" } },
	{ id: "fallback-template", input: { fallback: "${SYN_KEY}", env: { SYN_KEY: "faux-value" } } },
	{ id: "unreadable-no-substitution", input: { loadError: true, environment: "faux-environment", fallback: "faux-fallback" } },
	{ id: "runtime-over-unreadable", input: { loadError: true, runtime: "faux-runtime" } },
	{ id: "malformed-no-substitution", input: { store: "{broken", environment: "faux-environment" } },
	{ id: "runtime-over-malformed", input: { store: "{broken", runtime: "faux-runtime" } },
	{ id: "other-provider-ignored", input: { store: '{"other":{"type":"api_key","key":"faux-other"}}', environment: "faux-environment" } },
);
const cases = [];
for (const scenario of scenarios) {
	for (const key of ["SYN_KEY", "SECOND", "_KEY", "EMPTY", "ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"]) delete process.env[key];
	Object.assign(process.env, scenario.input.env);
	if (scenario.input.environment !== undefined) process.env.ANTHROPIC_API_KEY = scenario.input.environment;
	let key: string | undefined;
	let blocked = false;
	if (scenario.input.config !== undefined) {
		key = resolveConfigValue(scenario.input.config);
	} else {
		const backend: AuthStorageBackend = {
			withLock(fn) {
				if (scenario.input.loadError) throw new Error("synthetic store unavailable");
				return fn(scenario.input.store).result;
			},
			async withLockAsync() { throw new Error("unexpected OAuth/storage write"); },
		};
		const auth = AuthStorage.fromStorage(backend);
		if (scenario.input.runtime !== undefined) auth.setRuntimeApiKey("anthropic", scenario.input.runtime);
		auth.setFallbackResolver(() => scenario.input.fallback === undefined ? undefined : resolveConfigValue(scenario.input.fallback));
		key = await auth.getApiKey("anthropic", { includeFallback: scenario.input.includeFallback });
		blocked = key === undefined && auth.drainErrors().length > 0;
	}
	cases.push({ ...scenario, expected: { key: key ?? null, blocked } });
}
const files = [
	"scripts/fixtures/auth-recorder.ts", "packages/coding-agent/src/core/auth-storage.ts",
	"packages/coding-agent/src/core/auth-storage-backend.ts", "packages/coding-agent/src/core/resolve-config-value.ts",
	"packages/ai/src/env-api-keys.ts",
];
console.log(JSON.stringify({
	schema: "omk.auth-resolution.v1",
	source: Object.fromEntries(files.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")])),
	projection: "API-key config templates and credential priority; supplied in-memory store and environment, no OAuth/commands/files/network",
	cases,
}, null, 2));
