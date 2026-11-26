import type { EventBus } from "../../event-bus.ts";
import {
	createHerdrTransport,
	extractHerdrSessionRef,
	type HerdrAgentState,
	type HerdrBlockedEvent,
	type HerdrSessionRef,
	resolveHerdrConfig,
} from "../../herdr-client.ts";
import type { ExtensionFactory, ExtensionMode, ExtensionUIContext } from "../types.ts";

function parseBlockedEvent(data: unknown): HerdrBlockedEvent {
	if (typeof data !== "object" || data === null) return {};
	const record = data as Record<string, unknown>;
	return {
		active: typeof record.active === "boolean" ? record.active : undefined,
		label: typeof record.label === "string" && record.label.trim().length > 0 ? record.label.trim() : undefined,
	};
}

export function createHerdrAgentStateExtension(): ExtensionFactory {
	return (omk) => {
		const config = resolveHerdrConfig();
		if (!config) return;

		const transport = createHerdrTransport(config);
		let rootSession = false;
		let agentActive = false;
		let blockedCount = 0;
		let blockedMessage: string | undefined;
		let lastState: HerdrAgentState | undefined;
		let lastMessage: string | undefined;
		let currentSessionRef: HerdrSessionRef | undefined;

		const desiredState = (): { state: HerdrAgentState; message: string | undefined } => {
			if (blockedCount > 0) return { state: "blocked", message: blockedMessage };
			if (agentActive) return { state: "working", message: undefined };
			return { state: "idle", message: undefined };
		};

		const publishState = (force = false) => {
			const next = desiredState();
			if (!force && next.state === lastState && next.message === lastMessage) return;
			lastState = next.state;
			lastMessage = next.message;
			transport.queueState(next.state, next.message, currentSessionRef);
		};

		omk.events.on("herdr:blocked", (raw) => {
			if (!rootSession) return;
			const data = parseBlockedEvent(raw);
			if (!data.active) {
				blockedCount = Math.max(0, blockedCount - 1);
				if (blockedCount === 0) blockedMessage = undefined;
				publishState();
				return;
			}
			blockedCount += 1;
			blockedMessage = data.label;
			publishState();
		});

		omk.on("session_start", (event, ctx) => {
			// TUI only: RPC/JSON/print modes have no Herdr-owned interactive pane.
			if (ctx.mode !== "tui") return;
			rootSession = true;
			currentSessionRef = extractHerdrSessionRef(ctx.sessionManager);
			agentActive = ctx.isIdle() === false;
			publishState(true);
			transport.reportSession(currentSessionRef, event.reason);
		});

		omk.on("agent_start", (_event, ctx) => {
			if (!rootSession) return;
			currentSessionRef = extractHerdrSessionRef(ctx.sessionManager);
			agentActive = true;
			publishState();
		});

		omk.on("agent_settled", (_event, ctx) => {
			if (!rootSession || ctx.isIdle() !== true) return;
			agentActive = false;
			publishState();
		});

		omk.on("session_shutdown", async (event) => {
			if (!rootSession || event.reason !== "quit") return;
			rootSession = false;
			await transport.release();
		});
	};
}

async function runWithHerdrBlocked<T>(
	bus: EventBus | undefined,
	label: string | undefined,
	run: () => Promise<T>,
): Promise<T> {
	if (!bus) return run();
	const firstLine = label?.split("\n")[0]?.trim();
	bus.emit("herdr:blocked", { active: true, label: firstLine || undefined });
	try {
		return await run();
	} finally {
		bus.emit("herdr:blocked", { active: false });
	}
}

export function wrapHerdrBlockedUI(
	ui: ExtensionUIContext | undefined,
	bus: EventBus | undefined,
	mode: ExtensionMode | undefined = "tui",
): ExtensionUIContext | undefined {
	if (!ui || !bus || mode !== "tui") return ui;
	return {
		...ui,
		select: (title, options, opts) =>
			opts?.signal?.aborted
				? ui.select(title, options, opts)
				: runWithHerdrBlocked(bus, title, () => ui.select(title, options, opts)),
		confirm: (title, message, opts) =>
			opts?.signal?.aborted
				? ui.confirm(title, message, opts)
				: runWithHerdrBlocked(bus, title, () => ui.confirm(title, message, opts)),
		input: (title, placeholder, opts) =>
			opts?.signal?.aborted
				? ui.input(title, placeholder, opts)
				: runWithHerdrBlocked(bus, title, () => ui.input(title, placeholder, opts)),
		editor: (title, prefill) => runWithHerdrBlocked(bus, title, () => ui.editor(title, prefill)),
		custom: (factory, options) => runWithHerdrBlocked(bus, undefined, () => ui.custom(factory, options)),
	};
}
