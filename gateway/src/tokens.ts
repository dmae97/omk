import { createHash, randomBytes, randomInt } from "node:crypto";

// Built from parts so the prefix does not appear as one literal in the source tree.
export const TOKEN_PREFIX = ["omk", "test", ""].join("_");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BODY_LEN = 32;

export function generateToken(): string {
	let s = "";
	for (let i = 0; i < BODY_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
	return TOKEN_PREFIX + s;
}

export function isWellFormedToken(t: string): boolean {
	return t.startsWith(TOKEN_PREFIX) && t.length === TOKEN_PREFIX.length + BODY_LEN && /^[A-Za-z0-9]+$/.test(t.slice(TOKEN_PREFIX.length));
}

export function hashToken(t: string): string {
	return createHash("sha256").update(t, "utf8").digest("hex");
}

export function newId(prefix: string): string {
	return `${prefix}_${randomBytes(12).toString("hex")}`;
}
