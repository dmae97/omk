import { ArtifactManager } from "$c/session/artifacts";
import type { ToolSession } from "./index";

export interface TailBuffer {
	append(chunk: string): void;
	text(): string;
	bytes(): number;
}

export function createTailBuffer(maxBytes: number): TailBuffer {
	let buffer = "";
	let bufferBytes = 0;

	const append = (text: string) => {
		if (!text) return;
		const chunkBytes = Buffer.byteLength(text, "utf-8");
		buffer += text;
		bufferBytes += chunkBytes;

		if (bufferBytes > maxBytes) {
			const buf = Buffer.from(buffer, "utf-8");
			let start = Math.max(0, buf.length - maxBytes);
			while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
				start++;
			}
			buffer = buf.subarray(start).toString("utf-8");
			bufferBytes = Buffer.byteLength(buffer, "utf-8");
		}
	};

	return {
		append,
		text: () => buffer,
		bytes: () => bufferBytes,
	};
}

export function getArtifactManager(session: ToolSession): ArtifactManager | null {
	if (session.artifactManager) {
		return session.artifactManager;
	}
	const sessionFile = session.getSessionFile();
	if (!sessionFile) {
		return null;
	}
	const manager = new ArtifactManager(sessionFile);
	session.artifactManager = manager;
	return manager;
}

export async function allocateOutputArtifact(
	session: ToolSession,
	toolType: string,
): Promise<{ artifactPath?: string; artifactId?: string }> {
	const manager = getArtifactManager(session);
	if (!manager) return {};
	try {
		const allocation = await manager.allocatePath(toolType);
		return { artifactPath: allocation.path, artifactId: allocation.id };
	} catch {
		return {};
	}
}
