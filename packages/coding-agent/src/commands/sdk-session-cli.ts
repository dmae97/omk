/**
 * `omk sdk session` — inspect and append to persisted sessions without starting TUI.
 */
import { resolve } from "node:path";
import { redactSensitiveTextForced } from "../core/redaction.ts";
import { requestSessionControl } from "../core/session-control-client.ts";
import {
	type SessionEntry,
	type SessionInfo,
	SessionManager,
	type SessionMessageEntry,
} from "../core/session-manager.ts";

import { parseSdkSessionArgs as parseArgs, SDK_SESSION_USAGE as USAGE } from "./sdk-session-args.ts";

export interface SdkSessionCliOverrides {
	readonly cwd?: string;
	readonly writeLine?: (line: string) => void;
	readonly listSessions?: (cwd: string, sessionDir?: string) => Promise<SessionInfo[]>;
	readonly openSession?: (path: string) => SessionHandle;
}

export interface SdkSessionCliOutcome {
	readonly handled: boolean;
	readonly exitCode: 0 | 1 | 2;
}

export interface SessionHandle {
	readonly getSessionId: () => string;
	readonly getSessionFile: () => string | undefined;
	readonly getCwd: () => string;
	readonly getEntries: () => readonly SessionEntry[];
	readonly appendMessage: (message: { role: "user"; content: string; timestamp: number }) => string;
}

function summarizeSession(session: SessionInfo) {
	return {
		id: session.id,
		path: session.path,
		cwd: session.cwd,
		name: session.name,
		modified: session.modified.toISOString(),
		messageCount: session.messageCount,
		firstMessage: redactSensitiveTextForced(session.firstMessage),
	};
}

function renderStatus(sessions: readonly SessionInfo[]): string[] {
	if (sessions.length === 0) return ["No sessions found."];
	return sessions.map((session) => {
		const name = session.name ? ` ${session.name}` : "";
		return `${session.id}${name}  ${session.messageCount} msgs  ${session.modified.toISOString()}  ${redactSensitiveTextForced(session.firstMessage)}`;
	});
}

function messageText(message: SessionMessageEntry["message"]): string {
	if (!("content" in message)) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (typeof block === "object" && block !== null && "text" in block ? String(block.text) : ""))
		.filter((text) => text.length > 0)
		.join("\n");
}

function entryPreview(entry: SessionEntry): Record<string, unknown> {
	if (entry.type === "message") {
		return {
			id: entry.id,
			type: entry.type,
			role: entry.message.role,
			timestamp: entry.timestamp,
			text: redactSensitiveTextForced(messageText(entry.message)).slice(0, 400),
		};
	}
	return { id: entry.id, type: entry.type, timestamp: entry.timestamp };
}

type TargetResolution =
	| { readonly kind: "found"; readonly target: SessionInfo }
	| { readonly kind: "missing" }
	| { readonly kind: "ambiguous" };

function resolveTarget(id: string | undefined, sessions: readonly SessionInfo[]): TargetResolution {
	if (id === undefined) {
		const target = sessions[0];
		return target ? { kind: "found", target } : { kind: "missing" };
	}
	const exact = sessions.filter((session) => session.id === id || session.path === id);
	if (exact.length === 1 && exact[0]) return { kind: "found", target: exact[0] };
	if (exact.length > 1) return { kind: "ambiguous" };
	const partial = sessions.filter((session) => session.id.startsWith(id) || session.path.endsWith(id));
	if (partial.length === 1 && partial[0]) return { kind: "found", target: partial[0] };
	return partial.length > 1 ? { kind: "ambiguous" } : { kind: "missing" };
}

export async function runSdkSessionCli(
	args: readonly string[],
	overrides: SdkSessionCliOverrides = {},
): Promise<SdkSessionCliOutcome> {
	const parsed = parseArgs(args);
	if (parsed.kind === "absent") return { handled: false, exitCode: 0 };
	const writeLine = overrides.writeLine ?? ((line: string) => console.log(line));
	if (parsed.kind === "help") {
		writeLine(USAGE);
		return { handled: true, exitCode: 0 };
	}
	if (parsed.kind === "error") {
		writeLine(JSON.stringify({ status: "refused", error: parsed.message, usage: USAGE }));
		return { handled: true, exitCode: 2 };
	}

	const cwd = resolve(parsed.cwd ?? overrides.cwd ?? process.cwd());
	const listSessions = overrides.listSessions ?? SessionManager.list.bind(SessionManager);
	const sessions = await listSessions(cwd, parsed.sessionDir);

	if (parsed.action === "status" && parsed.id === undefined) {
		if (parsed.json) writeLine(JSON.stringify({ status: "ok", sessions: sessions.map(summarizeSession) }));
		else for (const line of renderStatus(sessions)) writeLine(line);
		return { handled: true, exitCode: 0 };
	}

	const resolution = resolveTarget(parsed.id, sessions);
	if (resolution.kind === "ambiguous") {
		writeLine(JSON.stringify({ status: "refused", error: `session id is ambiguous: ${parsed.id}` }));
		return { handled: true, exitCode: 1 };
	}
	if (resolution.kind === "missing") {
		writeLine(
			JSON.stringify({ status: "refused", error: parsed.id ? `session not found: ${parsed.id}` : "no sessions" }),
		);
		return { handled: true, exitCode: 1 };
	}
	const target = resolution.target;
	if (parsed.live) {
		if (target.id !== parsed.id) {
			writeLine(JSON.stringify({ status: "refused", error: "live control requires an exact session id" }));
			return { handled: true, exitCode: 1 };
		}
		try {
			const result = await requestSessionControl(
				target.path,
				target.id,
				parsed.action === "send" ? parsed.delivery : parsed.action === "abort" ? "abort" : "status",
				parsed.text,
			);
			writeLine(JSON.stringify(result));
			return { handled: true, exitCode: result.status === "refused" ? 1 : 0 };
		} catch {
			writeLine(
				JSON.stringify({
					status: "refused",
					error: "live endpoint unavailable or outcome unknown; no transcript append or automatic retry",
				}),
			);
			return { handled: true, exitCode: 1 };
		}
	}
	if (parsed.action === "send" && target.id !== parsed.id) {
		writeLine(JSON.stringify({ status: "refused", error: `send requires an exact session id: ${parsed.id}` }));
		return { handled: true, exitCode: 1 };
	}

	if (parsed.action === "status") {
		if (parsed.json) writeLine(JSON.stringify({ status: "ok", session: summarizeSession(target) }));
		else for (const line of renderStatus([target])) writeLine(line);
		return { handled: true, exitCode: 0 };
	}

	const openSession = overrides.openSession ?? ((path: string) => SessionManager.open(path));
	let session: SessionHandle;
	try {
		session = openSession(target.path);
	} catch (error) {
		if (error instanceof Error && error.name === "SessionOwnerLeaseHeldError") {
			const message =
				parsed.action === "send"
					? `session is active; stop it before appending: ${target.id}`
					: `session is active; stop it before reading: ${target.id}`;
			writeLine(JSON.stringify({ status: "refused", error: message }));
			return { handled: true, exitCode: 1 };
		}
		throw error;
	}
	const entries = session.getEntries();
	if (parsed.action === "tail") {
		const tail = entries.slice(-parsed.limit).map(entryPreview);
		writeLine(
			JSON.stringify({ status: "ok", id: session.getSessionId(), path: session.getSessionFile(), entries: tail }),
		);
		return { handled: true, exitCode: 0 };
	}
	if (parsed.action === "inspect") {
		writeLine(
			JSON.stringify({
				status: "ok",
				session: summarizeSession(target),
				entryCount: entries.length,
				entries: entries.map(entryPreview),
			}),
		);
		return { handled: true, exitCode: 0 };
	}
	if (parsed.text === undefined) {
		writeLine(JSON.stringify({ status: "refused", error: "send requires message text", usage: USAGE }));
		return { handled: true, exitCode: 2 };
	}
	const entryId = session.appendMessage({ role: "user", content: parsed.text, timestamp: Date.now() });
	writeLine(JSON.stringify({ status: "ok", id: session.getSessionId(), path: session.getSessionFile(), entryId }));
	return { handled: true, exitCode: 0 };
}
