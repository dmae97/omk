import type { Db } from "./db.js";
import { createUser, insertKey, revokeKey } from "./store.js";
import { generateToken, hashToken } from "./tokens.js";

export interface IssueOptions {
	userId?: string;
	label: string;
	plan: string;
	allowMaxEffort?: boolean;
	allowedModels?: string[] | null;
	capOverride?: number | null;
	expiresAt?: Date | null;
	now: Date;
}

/** Issues one token. Only the SHA-256 hash is stored; the plain token is returned ONCE to the caller. */
export async function issueKey(db: Db, o: IssueOptions): Promise<{ token: string; keyId: string; userId: string }> {
	const userId = o.userId ?? (await createUser(db, { label: o.label, plan: o.plan, allowMaxEffort: o.allowMaxEffort, allowedModels: o.allowedModels, capOverride: o.capOverride }));
	const token = generateToken();
	const keyId = await insertKey(db, { userId, tokenHash: hashToken(token), label: o.label, expiresAt: o.expiresAt ?? null, now: o.now });
	return { token, keyId, userId };
}

export async function revoke(db: Db, keyId: string, now: Date): Promise<boolean> {
	return revokeKey(db, keyId, now);
}
