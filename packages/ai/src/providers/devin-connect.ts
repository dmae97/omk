export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export function encodeFrame(payload: Uint8Array, flags = 0): Buffer {
	const header = Buffer.alloc(5);
	header[0] = flags;
	header.writeUInt32BE(payload.length, 1);
	return Buffer.concat([header, payload]);
}

function isGzip(bytes: Uint8Array): boolean {
	return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Gunzip without `node:zlib`: `DecompressionStream` exists in Node 18+ and in
 * browsers, so the unary path stays off the Node-only static import surface
 * (the browser smoke bundle cannot resolve `node:zlib`).
 */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new DecompressionStream("gzip");
	const writer = stream.writable.getWriter();
	await writer.write(bytes);
	await writer.close();
	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = stream.readable.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				total += value.byteLength;
				if (total > MAX_FRAME_BYTES) throw new Error("Devin response exceeds size limit");
				chunks.push(value);
			}
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	if (chunks.length === 1) return chunks[0];
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
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
		const body = Buffer.concat(chunks);
		// CLI /usage unary bodies are sometimes gzip without HTTP Content-Encoding.
		return isGzip(body) ? gunzip(body) : body;
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}
