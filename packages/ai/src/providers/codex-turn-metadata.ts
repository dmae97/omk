import type { ResponseInput, ResponseInputItem } from "openai/resources/responses/responses.js";
import { shortHash } from "../utils/hash.ts";

/**
 * `client_metadata` field the Codex CLI uses to carry native turn identity. Loopback bridges
 * written for Codex (codex-chatgpt-web) bind a browser session to `thread_id`/`turn_id` and refuse
 * a turn that lacks them.
 */
export const CODEX_TURN_METADATA_FIELD = "x-codex-turn-metadata";

export interface CodexTurnMetadata {
	readonly thread_id?: string;
	readonly turn_id: string;
	readonly sandbox?: "workspace-write";
	readonly workspaces?: Readonly<Record<string, Readonly<Record<string, never>>>>;
}

interface CodexTurnParams {
	readonly input?: string | ResponseInput;
	readonly client_metadata?: Readonly<Record<string, string>>;
}

/** Role-bearing message items with content (user, developer, system, assistant); excludes tool-list items. */
type RoleItem = Extract<ResponseInputItem, { role: unknown; content: unknown }>;

interface CurrentTurn {
	readonly metadata: CodexTurnMetadata;
	readonly userIndex: number;
	readonly userItem: RoleItem;
}

interface CodexWorkspaceContext {
	readonly cwd: string;
	readonly xml: string;
}

interface CodexWireMessageFields {
	readonly id: string;
	readonly internal_chat_message_metadata_passthrough: { readonly turn_id: string };
}

type CodexWireMessage = RoleItem & CodexWireMessageFields;

function isUserMessageItem(item: ResponseInputItem): item is RoleItem {
	return "role" in item && item.role === "user" && "content" in item && (!("type" in item) || item.type === "message");
}

function workspaceContext(cwd: string | undefined): CodexWorkspaceContext | undefined {
	const windows = typeof process !== "undefined" && process.platform === "win32";
	if (!cwd || !(cwd.startsWith("/") || (windows && /^(?:[a-z]:[\\/]|\\)/i.test(cwd)))) return undefined;
	const escaped = cwd.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return {
		cwd,
		xml: `<environment_context>
  <cwd>${escaped}</cwd>
  <filesystem><workspace_roots><root>${escaped}</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry><entry access="write"><path>${escaped}</path></entry><entry access="write"><special>:slash_tmp</special></entry><entry access="write"><special>:tmpdir</special></entry></file_system></permission_profile></filesystem>
  <network_access>enabled</network_access>
</environment_context>`,
	};
}

/**
 * One Codex turn spans a user message and every tool round until the next user message. Hashing
 * the thread, the position, and the content of the latest user item keeps the id stable across
 * tool rounds and rotates it when the next prompt (or a compaction that rewrites history) arrives.
 */
function deriveCodexTurnMetadata(input: ResponseInput, threadId: string | undefined): CurrentTurn | undefined {
	for (let userIndex = input.length - 1; userIndex >= 0; userIndex -= 1) {
		const userItem = input[userIndex];
		if (!isUserMessageItem(userItem)) continue;
		const turnId = `turn_${shortHash(JSON.stringify([threadId ?? "", userIndex, userItem]))}`;
		return {
			metadata: { ...(threadId === undefined ? {} : { thread_id: threadId }), turn_id: turnId },
			userIndex,
			userItem,
		};
	}
	return undefined;
}

function isConnectionRefused(error: unknown, depth = 0): boolean {
	if (!(error instanceof Error) || depth > 5) return false;
	if ("code" in error && error.code === "ECONNREFUSED") return true;
	return isConnectionRefused(error.cause, depth + 1);
}

/**
 * A Codex loopback bridge is a desktop launcher, so the usual failure is that it is not running.
 * Name that cause for a refused connection; every other error keeps the provider's own message.
 */
export function describeCodexBridgeConnectionError(error: unknown, baseUrl: string | undefined): string | undefined {
	if (!isConnectionRefused(error)) return undefined;
	return `codex-chatgpt-web bridge at ${baseUrl ?? "the configured baseUrl"} refused the connection. Start the Codex Web GPT launcher (it hosts the signed-in ChatGPT Web session and the local bridge), then retry.`;
}

/**
 * Return a copy carrying Codex-native turn identity. A trusted absolute cwd additionally creates
 * the adjacent workspace environment envelope required for Full harness tool dispatch.
 * Requests without a user item are returned unchanged.
 */
export function withCodexTurnMetadata<T extends CodexTurnParams>(
	params: T,
	threadId: string | undefined,
	cwd?: string,
): T {
	if (!Array.isArray(params.input)) return params;
	const turn = deriveCodexTurnMetadata(params.input, threadId);
	if (!turn) return params;
	const workspace = workspaceContext(cwd);
	const metadata: CodexTurnMetadata = workspace
		? { ...turn.metadata, sandbox: "workspace-write", workspaces: { [workspace.cwd]: {} } }
		: turn.metadata;
	const turnStamp = { turn_id: metadata.turn_id };
	const existingId = "id" in turn.userItem && typeof turn.userItem.id === "string" ? turn.userItem.id : undefined;
	const stamped: CodexWireMessage = {
		...turn.userItem,
		id: existingId ?? `msg_${shortHash(`${metadata.turn_id}:user`)}`,
		type: "message" as const,
		internal_chat_message_metadata_passthrough: turnStamp,
	};
	const environment: CodexWireMessage | undefined = workspace
		? {
				id: `msg_${shortHash(`${metadata.turn_id}:environment:${workspace.cwd}`)}`,
				type: "message" as const,
				role: "user" as const,
				content: [{ type: "input_text" as const, text: workspace.xml }],
				internal_chat_message_metadata_passthrough: turnStamp,
			}
		: undefined;
	const input: ResponseInput = params.input.flatMap((item, index) => {
		if (index !== turn.userIndex) return [item];
		return environment ? [environment, stamped] : [stamped];
	});
	return {
		...params,
		input,
		client_metadata: {
			...params.client_metadata,
			[CODEX_TURN_METADATA_FIELD]: JSON.stringify(metadata),
		},
	};
}
