/**
 * Risk classifier — maps a browser action to a risk band (R0..R3).
 *
 * Intent-based: the action's facade `kind`, description, underlying Aside tool,
 * and stringifiable `asideArgs` metadata all contribute signals. Risk is the max
 * across signals; critical signals always win.
 *
 * Pure module — no I/O.
 */

import type { BrowserAction, RiskLevel } from "./types.ts";

/** Verbs that force an otherwise-lower action into a critical band. */
const R3_PHRASES = [
	"pay",
	"payment",
	"checkout",
	"purchase",
	"delete account",
	"account deletion",
	"close account",
	"transfer fund",
	"transfer funds",
	"wire transfer",
	"2fa",
	"two factor",
	"mfa",
	"disable security",
	"security setting",
	"security settings",
	"password",
	"passkey",
	"credential",
	"credential export",
	"api key",
	"copy api key",
	"export api key",
	"private key",
	"seed phrase",
	"recovery phrase",
	"secret token",
	"access token",
	"connect wallet",
	"wallet connect",
	"connect account",
	"oauth grant",
	"grant oauth",
	"broad permission grant",
	"install extension",
	"install app",
];

const R2_PHRASES = [
	"submit",
	"send",
	"post",
	"publish",
	"create issue",
	"open issue",
	"comment",
	"reply",
	"merge",
	"deploy",
	"approve",
	"grant",
	"change permission",
	"invite",
	"share",
	"follow",
	"like",
	"rate",
	"review submit",
	"enter in form",
	"enter form",
	"oauth",
	"sign in with",
	"authorize app",
];

const SENSITIVE_INPUT_PHRASES = [
	"password",
	"passcode",
	"passkey",
	"2fa",
	"two factor",
	"mfa",
	"otp",
	"one time password",
	"token",
	"api key",
	"private key",
	"secret",
	"seed phrase",
	"recovery phrase",
];

/** Kind → baseline risk band. Unknown kinds default to R1 (treat as mutating-ish, unknown). */
const KIND_BAND: Readonly<Record<string, RiskLevel>> = {
	open_page: "R1",
	navigate: "R1",
	read_text: "R0",
	read_dom: "R0",
	inspect: "R0",
	screenshot: "R0",
	take_screenshot: "R0",
	console_log: "R0",
	wait: "R0",
	download: "R1",
	fill_form: "R1",
	type: "R1",
	input: "R1",
	press_key: "R1",
	key_press: "R1",
	click_locator: "R1",
	click: "R1",
	scroll: "R0",
	hover: "R0",
	submit: "R2",
	send_message: "R2",
	create_issue: "R2",
	publish: "R2",
	comment: "R2",
	change_permission: "R2",
	delete: "R3",
	payment: "R3",
	pay: "R3",
	account_deletion: "R3",
	security_setting_change: "R3",
	credential_export: "R3",
};

const BAND_ORDER: readonly RiskLevel[] = ["R0", "R1", "R2", "R3"];

function maxBand(a: RiskLevel, b: RiskLevel): RiskLevel {
	return BAND_ORDER.indexOf(a) >= BAND_ORDER.indexOf(b) ? a : b;
}

function stringifyAsideArgs(args: Readonly<Record<string, unknown>> | undefined): string {
	if (!args) return "";
	try {
		return JSON.stringify(args, (_key: string, value: unknown) =>
			typeof value === "bigint" ? value.toString() : value,
		);
	} catch {
		return Object.keys(args).join(" ");
	}
}

function normalizeText(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.replace(/[_\-.]+/g, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeKind(value: string): string {
	return normalizeText(value).replace(/\s+/g, "_");
}

function containsPhrase(normalizedText: string, phrase: string): boolean {
	const normalizedPhrase = normalizeText(phrase);
	return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function containsAnyPhrase(normalizedText: string, phrases: readonly string[]): boolean {
	return phrases.some((phrase) => containsPhrase(normalizedText, phrase));
}

function isSensitiveTyping(action: BrowserAction, normalizedHaystack: string): boolean {
	const kind = normalizeKind(action.kind);
	if (kind !== "type" && kind !== "fill_form" && kind !== "input") return false;
	return containsAnyPhrase(normalizedHaystack, SENSITIVE_INPUT_PHRASES);
}

function isEnterInForm(normalizedHaystack: string): boolean {
	if (containsPhrase(normalizedHaystack, "enter in form") || containsPhrase(normalizedHaystack, "enter form"))
		return true;
	return (
		(containsPhrase(normalizedHaystack, "key enter") || containsPhrase(normalizedHaystack, "press enter")) &&
		(containsPhrase(normalizedHaystack, "form true") || containsPhrase(normalizedHaystack, "input form"))
	);
}

/**
 * Classify a browser action into a risk band.
 *
 * @example
 * classifyRisk({ kind: "screenshot", description: "" })          // "R0"
 * classifyRisk({ kind: "submit", description: "post comment" })   // "R2"
 * classifyRisk({ kind: "click", description: "Pay now" })         // "R3"
 */
export function classifyRisk(action: BrowserAction): RiskLevel {
	const baseline = KIND_BAND[normalizeKind(action.kind)] ?? "R1";
	const haystack = normalizeText(
		`${action.kind} ${action.description ?? ""} ${action.asideTool ?? ""} ${stringifyAsideArgs(action.asideArgs)}`,
	);
	if (isSensitiveTyping(action, haystack)) return "R3";
	if (containsAnyPhrase(haystack, R3_PHRASES)) return "R3";
	let risk = baseline;
	if (containsAnyPhrase(haystack, R2_PHRASES) || isEnterInForm(haystack)) risk = maxBand(risk, "R2");
	return risk;
}
