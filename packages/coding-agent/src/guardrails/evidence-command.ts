import type { CommandHmacBinding, EvidenceCommandDescriptor, Sha256Hex } from "../types/evidence.ts";

const KEY_ID_HEX = /^[0-9a-f]{16}$/;
const NONCE_HEX = /^[0-9a-f]{32}$/;
const MAC_HEX = /^[0-9a-f]{64}$/;

/** Structural evidence-command errors never echo command data. */
export class EvidenceCommandError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EvidenceCommandError";
	}
}

function exactObject(
	value: unknown,
	label: string,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[] = [],
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new EvidenceCommandError(`${label} must be an object`);
	}
	const record = value as Record<string, unknown>;
	const descriptors = Object.getOwnPropertyDescriptors(record);
	const actual = Object.entries(descriptors)
		.filter(([, descriptor]) => descriptor.enumerable)
		.map(([key]) => key)
		.sort();
	const allowed = new Set([...requiredKeys, ...optionalKeys]);
	const isOwnEnumerableDataProperty = (key: string): boolean => {
		const descriptor = descriptors[key];
		return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor;
	};
	if (
		actual.some((key) => !allowed.has(key)) ||
		requiredKeys.some((key) => !isOwnEnumerableDataProperty(key)) ||
		optionalKeys.some((key) => key in record && !isOwnEnumerableDataProperty(key))
	) {
		throw new EvidenceCommandError(`${label} has an invalid key set`);
	}
	const snapshot: Record<string, unknown> = {};
	for (const key of actual) {
		const descriptor = descriptors[key];
		if (descriptor === undefined || !("value" in descriptor)) {
			throw new EvidenceCommandError(`${label} has an invalid key set`);
		}
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

function exactArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new EvidenceCommandError(`${label} must be an array`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const lengthDescriptor = descriptors.length as PropertyDescriptor | undefined;
	if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
		throw new EvidenceCommandError(`${label} has invalid index properties`);
	}
	const rawLength = lengthDescriptor.value;
	if (!Number.isSafeInteger(rawLength) || (rawLength as number) < 0) {
		throw new EvidenceCommandError(`${label} has invalid index properties`);
	}
	const length = rawLength as number;
	const snapshot: unknown[] = [];
	for (let index = 0; index < length; index++) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
			throw new EvidenceCommandError(`${label} must use own enumerable data index properties`);
		}
		snapshot.push(descriptor.value);
	}
	const enumerableKeys = Object.entries(descriptors)
		.filter(([, descriptor]) => descriptor.enumerable)
		.map(([key]) => key);
	if (enumerableKeys.length !== length || enumerableKeys.some((key, index) => key !== String(index))) {
		throw new EvidenceCommandError(`${label} must use own enumerable data index properties`);
	}
	return snapshot;
}

function ownEnumerableDataProperty(record: Record<string, unknown>, label: string, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
		throw new EvidenceCommandError(`${label} has an invalid key set`);
	}
	return descriptor.value;
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
		throw new EvidenceCommandError(`${label} must be a non-empty string without NUL bytes`);
	}
	return value;
}

function stringWithoutNul(value: unknown, label: string): string {
	if (typeof value !== "string" || value.includes("\0")) {
		throw new EvidenceCommandError(`${label} must be a string without NUL bytes`);
	}
	return value;
}

/** Parse the legacy HMAC binding retained in old v3 receipts. */
export function parseLegacyCommandBinding(value: unknown): CommandHmacBinding {
	const raw = exactObject(value, "commandBinding", ["algorithm", "keyId", "nonce", "mac"]);
	if (raw.algorithm !== "hmac-sha256") throw new EvidenceCommandError("commandBinding algorithm must be hmac-sha256");
	if (typeof raw.keyId !== "string" || !KEY_ID_HEX.test(raw.keyId)) {
		throw new EvidenceCommandError("commandBinding keyId is invalid");
	}
	if (typeof raw.nonce !== "string" || !NONCE_HEX.test(raw.nonce)) {
		throw new EvidenceCommandError("commandBinding nonce is invalid");
	}
	if (typeof raw.mac !== "string" || !MAC_HEX.test(raw.mac)) {
		throw new EvidenceCommandError("commandBinding mac is invalid");
	}
	return Object.freeze({ algorithm: "hmac-sha256", keyId: raw.keyId, nonce: raw.nonce, mac: raw.mac as Sha256Hex });
}

/** Structure-only parse of a command descriptor; performs no credential policy checks. */
export function parseEvidenceCommandShape(value: unknown): EvidenceCommandDescriptor {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new EvidenceCommandError("receipt core command must be an object");
	}
	const candidate = value as Record<string, unknown>;
	const kind = ownEnumerableDataProperty(candidate, "command descriptor", "kind");
	if (kind === "argv") {
		const raw = exactObject(value, "argv command descriptor", ["kind", "executable", "argv"]);
		const rawArgv = exactArray(raw.argv, "argv command descriptor argv");
		if (!rawArgv.every((argument) => typeof argument === "string")) {
			throw new EvidenceCommandError("argv command descriptor argv must be a string array");
		}
		const executable = nonEmptyString(raw.executable, "argv command executable");
		const argv = rawArgv.map((argument, index) => stringWithoutNul(argument, `argv[${index}]`));
		return Object.freeze({ kind: "argv", executable, argv: Object.freeze(argv) });
	}
	if (kind === "shell") {
		const raw = exactObject(value, "shell command descriptor", ["kind", "shell", "script"]);
		return Object.freeze({
			kind: "shell",
			shell: nonEmptyString(raw.shell, "shell command identity"),
			script: nonEmptyString(raw.script, "shell command script"),
		});
	}
	throw new EvidenceCommandError("receipt command kind must be argv or shell");
}
