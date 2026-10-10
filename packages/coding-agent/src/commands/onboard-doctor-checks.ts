/**
 * Checks behind `omk doctor`. Every check is read-only: no file is created, no credential value is
 * printed or sent anywhere, and the network is touched only with `--online`.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findEnvKeys, getEnvApiKey, getProviders } from "omk-ai";
import { isBunBinary, VERSION } from "../config.ts";
import { linkAbortSignals } from "../core/abort-link.ts";
import { AuthStorage, type AuthStorageData } from "../core/auth-storage.ts";
import {
	credentialSourcePath,
	EXTERNAL_CREDENTIAL_SOURCE_LABELS,
	PROVIDER_CREDENTIAL_SOURCES,
} from "../core/external-credential-sources.ts";
import { ModelRegistry } from "../core/model-registry.ts";
import { findInitialModel } from "../core/model-resolver.ts";
import type { CheckNode, CheckResult } from "../core/onboarding/check-dag.ts";
import { AMBIENT_CREDENTIAL_PROVIDERS } from "../core/provider-default-models.ts";
import { detectSandboxBackend } from "../core/sandbox/backend.ts";
import { resolveBashSandboxMode } from "../core/sandbox/default-policy.ts";
import { getToolPath } from "../utils/tools-manager.ts";

export interface DoctorContext {
	readonly agentDir: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly online: boolean;
	/** Filled by the credentials check for the default-model check. */
	auth?: AuthStorage;
}

const MIN_NODE = [22, 19, 0] as const;

function readJsonObject(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error: unknown) {
		// V8 quotes up to ~20 characters of the input in parse errors, and auth.json holds credentials.
		if (error instanceof SyntaxError) throw new Error(`${path} is not valid JSON`);
		throw error;
	}
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: undefined;
}

function nodeVersionOk(version: string): boolean {
	const parts = version.split(".").map((part) => Number.parseInt(part, 10));
	for (let index = 0; index < MIN_NODE.length; index++) {
		if ((parts[index] ?? 0) !== MIN_NODE[index]) return (parts[index] ?? 0) > MIN_NODE[index];
	}
	return true;
}

const runtimeCheck: CheckNode<DoctorContext> = {
	id: "runtime",
	title: "runtime",
	deadlineMs: 500,
	run: () => {
		const engine = isBunBinary ? `standalone binary (bun ${process.versions.bun})` : `node ${process.versions.node}`;
		const summary = `OMK ${VERSION} · ${engine} · ${process.platform}-${process.arch}`;
		if (!isBunBinary && !nodeVersionOk(process.versions.node)) {
			return {
				status: "fail",
				summary: `${summary} is below the required node ${MIN_NODE.join(".")}`,
				fix: "Install Node.js 22.19 or newer, or use the standalone binary from the GitHub release (no Node required).",
			};
		}
		return { status: "pass", summary };
	},
};

const agentDirCheck: CheckNode<DoctorContext> = {
	id: "agent-dir",
	title: "agent dir",
	deadlineMs: 500,
	run: ({ agentDir }) => {
		let target = agentDir;
		while (!existsSync(target) && dirname(target) !== target) target = dirname(target);
		try {
			accessSync(target, constants.W_OK);
		} catch {
			return { status: "fail", summary: `${target} is not writable`, fix: `Fix the permissions of ${target}.` };
		}
		return {
			status: "pass",
			summary: existsSync(agentDir) ? `${agentDir} (writable)` : `${agentDir} (created on first run)`,
		};
	},
};

const credentialsCheck: CheckNode<DoctorContext> = {
	id: "credentials",
	title: "credentials",
	deps: ["agent-dir"],
	deadlineMs: 1500,
	run: (context) => {
		const stored = readJsonObject(join(context.agentDir, "auth.json")) ?? {};
		context.auth = AuthStorage.inMemory(stored as AuthStorageData);
		const storedProviders = Object.keys(stored).sort();
		const envProviders: string[] = [];
		const ambientProviders: string[] = [];
		for (const provider of getProviders()) {
			const keys = findEnvKeys(provider);
			if (keys?.length) envProviders.push(`${provider} (${keys[0]})`);
			else if (AMBIENT_CREDENTIAL_PROVIDERS.has(provider) && getEnvApiKey(provider)) ambientProviders.push(provider);
		}
		const adoptable: string[] = [];
		for (const [provider, sources] of Object.entries(PROVIDER_CREDENTIAL_SOURCES)) {
			for (const source of sources) {
				if (existsSync(credentialSourcePath(source, { env: context.env }))) {
					adoptable.push(`${EXTERNAL_CREDENTIAL_SOURCE_LABELS[source]} -> omk provider adopt ${provider}`);
				}
			}
		}
		const data = { stored: storedProviders, environment: envProviders, ambient: ambientProviders, adoptable };
		const parts = [
			storedProviders.length > 0 ? `stored: ${storedProviders.join(", ")}` : undefined,
			envProviders.length > 0 ? `env: ${envProviders.join(", ")}` : undefined,
			ambientProviders.length > 0 ? `ambient: ${ambientProviders.join(", ")}` : undefined,
		].filter((part): part is string => part !== undefined);
		if (storedProviders.length > 0 || envProviders.length > 0)
			return { status: "pass", summary: parts.join(" · "), data };
		const reuse = adoptable.length > 0 ? ` Or reuse an existing login: ${adoptable.join("; ")}.` : "";
		if (ambientProviders.length > 0) {
			return {
				status: "warn",
				summary: `only ambient cloud credentials (${ambientProviders.join(", ")})`,
				fix: `Confirm they are meant for OMK, or sign in with /login.${reuse}`,
				data,
			};
		}
		return {
			status: "fail",
			summary: "no provider credentials found",
			fix: `Run omk and finish /login, or export a provider key such as ANTHROPIC_API_KEY.${reuse}`,
			data,
		};
	},
};

const defaultModelCheck: CheckNode<DoctorContext> = {
	id: "default-model",
	title: "default model",
	deps: ["credentials"],
	deadlineMs: 3000,
	run: async (context): Promise<CheckResult> => {
		const auth = context.auth ?? AuthStorage.inMemory();
		const registry = ModelRegistry.createReadOnly(auth, join(context.agentDir, "models.json"));
		const settings = readJsonObject(join(context.agentDir, "settings.json")) ?? {};
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			defaultProvider: typeof settings.defaultProvider === "string" ? settings.defaultProvider : undefined,
			defaultModelId: typeof settings.defaultModel === "string" ? settings.defaultModel : undefined,
			modelRegistry: registry,
		});
		const model = result.model;
		if (!model)
			return { status: "fail", summary: "no usable model", fix: "Configure credentials first (see above)." };
		const ambient = AMBIENT_CREDENTIAL_PROVIDERS.has(model.provider);
		const source = auth.getAuthStatus(model.provider).source ?? (ambient ? "ambient" : "environment");
		const summary = `${model.provider}/${model.id} (credential: ${source})`;
		if (ambient && source !== "stored" && source !== "runtime") {
			return {
				status: "warn",
				summary: `${summary} chosen from ambient cloud credentials`,
				fix: "If those credentials are not meant for OMK, pick another provider with /login or /model.",
			};
		}
		return { status: "pass", summary };
	},
};

const sandboxCheck: CheckNode<DoctorContext> = {
	id: "sandbox",
	title: "bash sandbox",
	deadlineMs: 4000,
	run: ({ env }) => {
		const mode = resolveBashSandboxMode(env);
		if (mode === "off") return { status: "warn", summary: "disabled by OMK_BASH_SANDBOX=off" };
		const started = performance.now();
		const backend = detectSandboxBackend();
		const elapsed = Math.round(performance.now() - started);
		if (backend.backendAvailable)
			return { status: "pass", summary: `${backend.platform} backend ready (${mode}, ${elapsed} ms probe)` };
		const reason = backend.unavailableReason ?? "no sandbox backend";
		const [summary, fix] = reason.split(" Fix: ");
		if (mode === "audit") return { status: "warn", summary: `audit mode without isolation: ${summary}` };
		return { status: "fail", summary: `shell is blocked: ${summary}`, ...(fix ? { fix } : {}) };
	},
};

const toolsCheck: CheckNode<DoctorContext> = {
	id: "tools",
	title: "search tools",
	deadlineMs: 2000,
	run: () => {
		const missing = (["fd", "rg"] as const).filter((tool) => !getToolPath(tool));
		if (missing.length === 0) return { status: "pass", summary: "fd and rg found" };
		return {
			status: "warn",
			summary: `${missing.join(", ")} missing`,
			fix: "OMK fetches them in the background on interactive start; to install yourself: apt install fd-find ripgrep / brew install fd ripgrep.",
		};
	},
};

const networkCheck: CheckNode<DoctorContext> = {
	id: "network",
	title: "network",
	deadlineMs: 6000,
	run: async ({ online }, signal): Promise<CheckResult> => {
		if (!online) return { status: "skip", summary: "not run (use --online)" };
		const targets = ["https://api.github.com", "https://api.anthropic.com", "https://api.openai.com"];
		const outcomes = await Promise.all(
			targets.map(async (url) => {
				const started = performance.now();
				const link = linkAbortSignals(signal, AbortSignal.timeout(5000));
				try {
					await fetch(url, { method: "HEAD", signal: link.signal });
					return `${new URL(url).host} ${Math.round(performance.now() - started)} ms`;
				} catch (error: unknown) {
					return `${new URL(url).host} unreachable (${error instanceof Error ? error.message : String(error)})`;
				} finally {
					link.dispose();
				}
			}),
		);
		const failed = outcomes.filter((line) => line.includes("unreachable"));
		return {
			status: failed.length === 0 ? "pass" : "warn",
			summary: outcomes.join(" · "),
			...(failed.length > 0
				? { fix: "Check the proxy (HTTPS_PROXY) or firewall; OMK_OFFLINE=1 skips startup network calls." }
				: {}),
		};
	},
};

export const DOCTOR_CHECKS: readonly CheckNode<DoctorContext>[] = [
	runtimeCheck,
	agentDirCheck,
	credentialsCheck,
	defaultModelCheck,
	sandboxCheck,
	toolsCheck,
	networkCheck,
];
