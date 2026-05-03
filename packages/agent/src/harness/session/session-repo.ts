import { v7 as uuidv7 } from "uuid";
import type { Session, SessionMetadata, SessionStorage, SessionTreeEntry } from "../types.js";
import { DefaultSession } from "./session-tree.js";

export function createSessionId(): string {
	return uuidv7();
}

export function createTimestamp(): string {
	return new Date().toISOString();
}

export function toSession<TMetadata extends SessionMetadata>(storage: SessionStorage<TMetadata>): Session<TMetadata> {
	return new DefaultSession(storage);
}

export async function getPathEntriesToFork(
	storage: SessionStorage,
	entryId: string,
	position: "before" | "at",
): Promise<SessionTreeEntry[]> {
	const target = await storage.getEntry(entryId);
	if (!target) {
		throw new Error(`Entry ${entryId} not found`);
	}
	let effectiveLeafId: string | null;
	if (position === "at") {
		effectiveLeafId = target.id;
	} else {
		if (target.type !== "message" || target.message.role !== "user") {
			throw new Error(`Entry ${entryId} is not a user message`);
		}
		effectiveLeafId = target.parentId;
	}
	return storage.getPathToRoot(effectiveLeafId);
}
