import { trackLoadedExtensions } from "./internal-loaded-extensions.ts";
import type { ExtensionActions, ExtensionRuntime } from "./types.ts";

/** Shared action slots are rebound by ExtensionRunner.bindCore(). */
export function createExtensionRuntime(): ExtensionRuntime {
	const state: { staleMessage?: string } = {};
	const assertActive = () => {
		if (state.staleMessage !== undefined) throw new Error(state.staleMessage);
	};
	const unavailable = () => {
		assertActive();
		throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
	};
	const inactiveActions: ExtensionActions = {
		sendMessage: unavailable,
		sendUserMessage: unavailable,
		appendEntry: unavailable,
		setSessionName: unavailable,
		getSessionName: unavailable,
		setLabel: unavailable,
		getActiveTools: unavailable,
		getAllTools: unavailable,
		setActiveTools: unavailable,
		refreshTools: unavailable,
		getCommands: unavailable,
		setModel: async () => {
			assertActive();
			throw new Error("Extension runtime not initialized");
		},
		getThinkingLevel: unavailable,
		setThinkingLevel: unavailable,
		callMcpTool: undefined,
	};
	const runtime: ExtensionRuntime = {
		...inactiveActions,
		// Tool registration is allowed before the runner binds refreshTools.
		refreshTools: () => {},
		flagValues: new Map(),
		pendingProviderRegistrations: [],
		providerOwners: new Map(),
		assertActive,
		invalidate: (message) => {
			state.staleMessage ??=
				message ??
				"This extension ctx is stale after session replacement or reload. Do not use a captured extension API or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().";
			// Retained APIs must not keep the retired session's bound closures or inventory alive.
			Object.assign(runtime, inactiveActions);
			runtime.registerProvider = unavailable;
			runtime.unregisterProvider = unavailable;
			runtime.pendingProviderRegistrations.length = 0;
			runtime.flagValues.clear();
			runtime.providerOwners.clear();
			trackLoadedExtensions(runtime, []);
		},
		registerProvider: (name, config, extensionPath = "<unknown>") => {
			runtime.pendingProviderRegistrations.push({ name, config, extensionPath });
		},
		unregisterProvider: (name) => {
			runtime.pendingProviderRegistrations = runtime.pendingProviderRegistrations.filter((r) => r.name !== name);
		},
	};
	return runtime;
}
