export class RunContractError extends Error {
	constructor(field: string) {
		super(`Invalid verified-run field: ${field}`);
		this.name = "RunContractError";
	}
}

export function runObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RunContractError("object");
	if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		throw new RunContractError("prototype");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(value).length !== keys.length) throw new RunContractError("fields");
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const descriptor = descriptors[key];
		if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new RunContractError(key);
		result[key] = descriptor.value;
	}
	return result;
}
export function runText(value: unknown, field: string, max = 4096): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000\ud800-\udfff]/u.test(value))
		throw new RunContractError(field);
	return value;
}
export function runId(value: unknown): string {
	const id = runText(value, "id", 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new RunContractError("id");
	return id;
}
export function runDigest(value: unknown): string {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new RunContractError("digest");
	return value;
}
export function runLimit(value: unknown, field: string, max = 2147483647): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > max)
		throw new RunContractError(field);
	return value;
}
export function runArray<T>(value: unknown, parse: (item: unknown) => T, max: number): readonly T[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > max) throw new RunContractError("array");
	const items: T[] = [];
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !("value" in descriptor)) throw new RunContractError("array item");
		items.push(parse(descriptor.value));
	}
	return Object.freeze(items);
}
export function runRelativePath(value: unknown): string {
	const path = runText(value, "path", 1024);
	if (
		/[\\\u0000-\u001f\u007f]/.test(path) ||
		path.split("/").some((part) => ["", ".", "..", ".git", ".omk"].includes(part))
	)
		throw new RunContractError("path");
	return path;
}
export function runAbsolutePath(value: unknown): string {
	const path = runText(value, "absolute path", 4096);
	if (
		!path.startsWith("/") ||
		path === "/" ||
		path
			.slice(1)
			.split("/")
			.some((part) => ["", ".", ".."].includes(part)) ||
		/[\\\u0000-\u001f\u007f]/.test(path)
	)
		throw new RunContractError("absolute path");
	return path;
}
export function runArgv(value: unknown): readonly string[] {
	const args = runArray(
		value,
		(item) => (typeof item === "string" && item.length === 0 ? "" : runText(item, "argv", 16384)),
		128,
	);
	runAbsolutePath(args[0]);
	return args;
}
