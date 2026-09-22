import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { AgentMessage } from "omk-agent-core";
import type { Message, TextContent } from "omk-ai";

export interface SessionHeader {
	type: "session";
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}
export interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}
export interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	message: AgentMessage;
}
export interface SessionInfoEntry extends SessionEntryBase {
	type: "session_info";
	name?: string;
}
export interface SessionMetadata {
	path: string;
	id: string;
	/** Working directory; empty for older transcripts. */
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
}
export interface SessionInfo extends SessionMetadata {
	allMessagesText: string;
}
export interface SessionListEntry extends SessionMetadata {
	/** Absent in metadata-only listings, never an empty-text substitute. */
	allMessagesText?: string;
}

function isMessageWithContent(message: AgentMessage): message is Message {
	return typeof (message as Message).role === "string" && "content" in message;
}
function extractTextContent(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join(" ");
}
function getMessageActivityTime(entry: SessionMessageEntry): number | undefined {
	const message = entry.message;
	if (!isMessageWithContent(message) || (message.role !== "user" && message.role !== "assistant")) return undefined;
	const timestamp = (message as { timestamp?: number }).timestamp;
	if (typeof timestamp === "number") return timestamp;
	const value = new Date(entry.timestamp).getTime();
	return Number.isNaN(value) ? undefined : value;
}

export function readSessionInfo(
	path: string,
	options: { metadataOnly: true; signal?: AbortSignal },
): Promise<SessionMetadata | null>;
export function readSessionInfo(
	path: string,
	options?: { metadataOnly?: false; signal?: AbortSignal },
): Promise<SessionInfo | null>;
/** Read-only listing projection. Durable append/repair and branch reconstruction are unchanged. */
export async function readSessionInfo(
	filePath: string,
	options: { metadataOnly?: boolean; signal?: AbortSignal } = {},
): Promise<SessionListEntry | null> {
	try {
		if (options.signal?.aborted) return null;
		const stats = await stat(filePath);
		let header: SessionHeader | null = null;
		let messageCount = 0;
		let firstMessage = "";
		const allMessages: string[] = [];
		let name: string | undefined;
		let lastActivityTime: number | undefined;
		const stream = createReadStream(filePath, { encoding: "utf8", signal: options.signal });
		const lines = createInterface({ input: stream, crlfDelay: Infinity });
		try {
			for await (const line of lines) {
				if (!line.trim()) continue;
				let entry: SessionHeader | SessionMessageEntry | SessionInfoEntry | null;
				try {
					entry = JSON.parse(line) as typeof entry;
				} catch {
					continue;
				} // Preserve listing's existing malformed-line/tail behavior.
				if (!entry) continue;
				if (!header) {
					if (entry.type !== "session") return null;
					header = entry;
					continue;
				}
				if (entry.type === "session_info") name = entry.name?.trim() || undefined;
				if (entry.type !== "message") continue;
				messageCount++;
				const activity = getMessageActivityTime(entry);
				if (typeof activity === "number") lastActivityTime = Math.max(lastActivityTime ?? 0, activity);
				const message = entry.message;
				if (!isMessageWithContent(message) || (message.role !== "user" && message.role !== "assistant")) continue;
				if (options.metadataOnly && (firstMessage || message.role !== "user")) continue;
				const text = extractTextContent(message);
				if (!text) continue;
				if (!options.metadataOnly) allMessages.push(text);
				if (!firstMessage && message.role === "user") firstMessage = text;
			}
		} finally {
			lines.close();
			stream.destroy();
			if (!stream.closed) await new Promise<void>((resolve) => stream.once("close", resolve));
		}
		if (!header || options.signal?.aborted) return null;
		const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
		const modified =
			typeof lastActivityTime === "number" && lastActivityTime > 0
				? new Date(lastActivityTime)
				: !Number.isNaN(headerTime)
					? new Date(headerTime)
					: stats.mtime;
		const metadata: SessionMetadata = {
			path: filePath,
			id: header.id,
			cwd: typeof header.cwd === "string" ? header.cwd : "",
			name,
			parentSessionPath: header.parentSession,
			created: new Date(header.timestamp),
			modified,
			messageCount,
			firstMessage: firstMessage || "(no messages)",
		};
		return options.metadataOnly ? metadata : { ...metadata, allMessagesText: allMessages.join(" ") };
	} catch {
		return null; // Missing/unreadable/cancelled sources cannot authorize a search result.
	}
}
