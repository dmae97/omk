import type { TencentMemoryConfig } from "./tencent-memory-config.ts";

const MAX_RESPONSE_BYTES = 65_536;
type MemoryRoute =
	| "/v3/atomic/search"
	| "/v3/conversation/search"
	| "/v3/core/read"
	| "/v3/scenario/read"
	| "/v3/conversation/add";

class MemoryResponseError extends Error {}

function redactCredential(value: unknown, key: string, depth = 0): unknown {
	if (depth > 64) throw new MemoryResponseError("TencentDB memory response is too deeply nested");
	if (typeof value === "string") return value.split(key).join("[REDACTED]");
	if (Array.isArray(value)) return value.map((item) => redactCredential(item, key, depth + 1));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([name, item]) => [
				name.split(key).join("[REDACTED]"),
				redactCredential(item, key, depth + 1),
			]),
		);
	}
	return value;
}

async function readEnvelope(response: Response): Promise<Record<string, unknown>> {
	const reader = response.body?.getReader();
	if (!reader) throw new MemoryResponseError("TencentDB memory returned an invalid envelope");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_RESPONSE_BYTES)
				throw new MemoryResponseError("TencentDB memory response exceeds 64 KiB; narrow the request");
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
	} catch {
		throw new MemoryResponseError("TencentDB memory returned an invalid JSON envelope");
	}
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!("code" in value) ||
		!Number.isInteger(value.code)
	) {
		throw new MemoryResponseError("TencentDB memory returned an invalid envelope");
	}
	if (value.code !== 0) throw new MemoryResponseError(`TencentDB memory returned business code ${value.code}`);
	if (!("data" in value) || !value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
		throw new MemoryResponseError("TencentDB memory returned an invalid data envelope");
	}
	return value.data as Record<string, unknown>;
}

/** No automatic retries: an aborted/failed write may already have reached the server. */
export async function requestTencentMemory(
	config: TencentMemoryConfig,
	key: string,
	route: MemoryRoute,
	body: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	if (process.env.OMK_OFFLINE === "1")
		throw new MemoryResponseError("TencentDB memory is unavailable in offline mode");
	signal?.throwIfAborted();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
	const forwardAbort = () => controller.abort(signal?.reason);
	signal?.addEventListener("abort", forwardAbort, { once: true });
	try {
		let response: Response;
		try {
			response = await fetch(`${config.endpoint}${route}`, {
				method: "POST",
				redirect: "error",
				headers: {
					Authorization: `Bearer ${key}`,
					"Content-Type": "application/json",
					"x-tdai-service-id": config.serviceId,
				},
				body: JSON.stringify({ ...body, team_id: config.teamId, agent_id: config.agentId, user_id: config.userId }),
				signal: controller.signal,
			});
		} catch {
			throw new MemoryResponseError(
				"TencentDB memory request failed (network, TLS, redirect or cancellation); remote write outcome may be unknown",
			);
		}
		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			throw new MemoryResponseError(`TencentDB memory HTTP ${response.status}; remote write outcome may be unknown`);
		}
		const data = await readEnvelope(response);
		// Never reflect the configured gateway credential even if a server echoes it.
		return redactCredential(data, key) as Record<string, unknown>;
	} catch (error) {
		if (signal?.aborted)
			throw new MemoryResponseError("TencentDB memory request cancelled; remote write outcome may be unknown");
		if (controller.signal.aborted)
			throw new MemoryResponseError("TencentDB memory request timed out; remote write outcome may be unknown");
		if (error instanceof MemoryResponseError) throw error;
		throw new MemoryResponseError("TencentDB memory response failed; remote write outcome may be unknown");
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", forwardAbort);
	}
}
