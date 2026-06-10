import { classifyOmkRisk, type OmkDebloatRisk, type OmkRequestIntent } from "./omk-runtime-sidecar.ts";

export type OmkCommandKind =
	| "chat"
	| "run"
	| "status"
	| "model"
	| "memory"
	| "theme"
	| "doctor"
	| "slash"
	| "pipe"
	| "resume"
	| "system";
export type OmkCommandSource = "cli" | "stdin" | "api" | "hook";

export interface OmkCommandEnvelope {
	kind: OmkCommandKind;
	source: OmkCommandSource;
	rawText: string;
	providerPolicy?: string;
	debug?: boolean;
	timestamp?: string;
}

export interface OmkCommandEvent {
	type: string;
	timestamp: string;
	data?: unknown;
}

export interface OmkCommandBusResult {
	handled: boolean;
	events: readonly OmkCommandEvent[];
	output: string;
}

export type OmkCommandHandler = (envelope: OmkCommandEnvelope) => Promise<OmkCommandBusResult>;

export interface OmkCommandBus {
	dispatch(envelope: OmkCommandEnvelope): Promise<OmkCommandBusResult>;
	registerHandler(command: string, handler: OmkCommandHandler): void;
	listCommands(): readonly string[];
}

export function createOmkCommandBus(): OmkCommandBus {
	const handlers = new Map<string, OmkCommandHandler>();

	const dispatch = async (envelope: OmkCommandEnvelope): Promise<OmkCommandBusResult> => {
		const events: OmkCommandEvent[] = [];
		const text = envelope.rawText;
		events.push(emitEvent("command:received", { text: text.slice(0, 120) }));

		if (isSlashCommand(text)) {
			const command = extractSlashCommand(text);
			events.push(emitEvent("command:identified", { command, type: "slash" }));
			const handler = handlers.get(command);
			if (handler) {
				events.push(emitEvent("command:dispatching", { command }));
				const result = await handler(envelope);
				return { ...result, events: [...events, ...result.events] };
			}

			events.push(emitEvent("command:unhandled", { command }));
			return {
				handled: false,
				events,
				output: `Unknown command: /${command}. Use /help for available commands.`,
			};
		}

		const risk = resolveRisk("chat", text);
		events.push(emitEvent("command:fallback", { risk, intent: "chat" }));
		return { handled: false, events, output: "" };
	};

	const registerHandler = (command: string, handler: OmkCommandHandler): void => {
		handlers.set(command.toLowerCase(), handler);
	};

	const listCommands = (): readonly string[] => [...handlers.keys()];

	return { dispatch, registerHandler, listCommands };
}

function emitEvent(type: string, payload?: unknown): OmkCommandEvent {
	return { type, timestamp: new Date().toISOString(), data: payload };
}

function isSlashCommand(text: string): boolean {
	return text.trimStart().startsWith("/");
}

function extractSlashCommand(text: string): string {
	const match = text.trimStart().match(/^\/([a-zA-Z0-9_-]+)/);
	return match?.[1]?.toLowerCase() ?? "";
}

function resolveRisk(intent: OmkRequestIntent, raw: string): OmkDebloatRisk {
	return classifyOmkRisk(intent, raw);
}
