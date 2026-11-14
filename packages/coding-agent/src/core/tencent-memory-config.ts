import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const identity = Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:@-]*$" });
const schema = Type.Object(
	{
		endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
		serviceId: identity,
		teamId: identity,
		agentId: identity,
		userId: identity,
		apiKeyEnv: Type.Optional(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$", maxLength: 128 })),
		allowWrites: Type.Optional(Type.Boolean()),
		timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 30_000 })),
	},
	{ additionalProperties: false },
);
export type TencentMemoryConfig = Static<typeof schema>;

export function readTencentMemoryConfig(agentDir: string): TencentMemoryConfig | undefined {
	let fd: number;
	try {
		fd = openSync(join(agentDir, "tencent-memory.json"), constants.O_RDONLY | constants.O_NONBLOCK);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw new Error("Cannot read agent-directory tencent-memory.json");
	}
	let value: unknown;
	try {
		if (!fstatSync(fd).isFile()) throw new Error("Not a regular configuration file");
		const buffer = Buffer.alloc(16_385);
		const bytes = readSync(fd, buffer);
		if (bytes > 16_384) throw new Error("Configuration exceeds 16 KiB");
		value = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
	} catch {
		throw new Error("Invalid tencent-memory.json: expected a regular JSON file of at most 16 KiB");
	} finally {
		closeSync(fd);
	}
	if (!Check(schema, value)) {
		throw new Error(
			"Invalid tencent-memory.json: endpoint/serviceId/teamId/agentId/userId are required; check optional fields",
		);
	}
	let url: URL;
	try {
		url = new URL(value.endpoint);
	} catch {
		throw new Error("TencentDB memory endpoint must be an absolute HTTPS URL (HTTP only on loopback)");
	}
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username ||
		url.password ||
		value.endpoint.includes("?") ||
		value.endpoint.includes("#")
	) {
		throw new Error(
			"TencentDB memory endpoint requires HTTPS except loopback; credentials/query/fragment are forbidden",
		);
	}
	return { ...value, endpoint: url.href.replace(/\/+$/, "") };
}

export function tencentMemoryCredential(config: TencentMemoryConfig): string | undefined {
	const key = process.env[config.apiKeyEnv ?? "TENCENTDB_MEMORY_API_KEY"];
	if (!key) return undefined;
	if (key.length > 16_384 || !/^[\x21-\x7e]+$/.test(key)) {
		throw new Error("Invalid TencentDB memory credential format in configured environment variable");
	}
	return key;
}
