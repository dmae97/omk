/**
 * Wire types for the terminal-browser claude-bridge HTTP API.
 * Ported from https://github.com/zenbu-labs/terminal-browser (MIT, zenbu-labs).
 * Kept dependency-free: extensions cannot assume node_modules availability.
 */

export type Placed = { imageId: number; cols: number; rows: number };

export type BridgeState = {
	placed: Placed | null;
	title: string;
	url: string | null;
	alive: boolean;
	error: string | null;
	inbox: number;
};

export type LaunchReport = { port: number; token: string } | { error: string; code: "tty" | "start" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const isBridgeState = (value: unknown): value is BridgeState =>
	isRecord(value) && typeof value.alive === "boolean" && "placed" in value;

export const isLaunchReport = (value: unknown): value is LaunchReport =>
	isRecord(value) && (typeof value.port === "number" || typeof value.error === "string");

export const takenTexts = (value: unknown): string[] =>
	isRecord(value) && Array.isArray(value.texts) ? value.texts.filter((t): t is string => typeof t === "string") : [];
