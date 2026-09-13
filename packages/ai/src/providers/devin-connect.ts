export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export function encodeFrame(payload: Uint8Array, flags = 0): Buffer {
	const header = Buffer.alloc(5);
	header[0] = flags;
	header.writeUInt32BE(payload.length, 1);
	return Buffer.concat([header, payload]);
}

export async function readUnary(response: Response): Promise<Uint8Array> {
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Devin request failed (HTTP ${response.status})`);
	}
	if (!response.body) throw new Error("Devin returned an empty response");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > MAX_FRAME_BYTES) throw new Error("Devin response exceeds size limit");
			chunks.push(value);
		}
		return Buffer.concat(chunks);
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}
